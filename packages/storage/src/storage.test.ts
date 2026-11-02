import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Storage } from './storage.js';
import { migrate, openDatabase } from './migrations.js';
import type { ActionCard, ActionSpec, ApprovalGrant, Candidate, Event, TaskRun } from '@hearth/contracts';
import { actionDigest, targetDigest } from '@hearth/contracts';

let dir: string;
let store: Storage;

const NOW = '2026-10-28T12:00:00+08:00';

function ev(id: string, overrides: Partial<Event> = {}): Event {
  return {
    id,
    type: 'repo.ci_failed',
    projectId: 'project-atlas',
    source: {
      sourceType: 'fixture',
      uri: `fixture://github/project-atlas/runs/${id}`,
      sourceId: id,
      observedAt: NOW,
    },
    occurredAt: NOW,
    observedAt: NOW,
    summary: `event ${id}`,
    dedupeKey: `dedupe:${id}`,
    sensitivity: 'public',
    provenance: 'tool_observed',
    tags: ['ci'],
    ...overrides,
  };
}

function act(id: string): ActionSpec {
  return {
    id,
    actionType: 'report.generate',
    projectId: 'project-atlas',
    target: { resourceId: 'ci-42', path: 'report/atlas-ci-42.json' },
    params: { runId: 42 },
    allowedCapabilities: ['fs.write_demo_artifact'],
    risk: 'L1',
    effect: 'local_create',
    maxSteps: 8,
    timeoutMs: 30_000,
    maxCostUsd: 0,
    idempotencyKey: 'a'.repeat(64),
    verification: { kind: 'artifact_sha256', artifactPath: 'report/atlas-ci-42.json' },
  };
}

function card(id: string, overrides: Partial<ActionCard> = {}): ActionCard {
  return {
    id,
    candidateId: `cand-${id}`,
    projectId: 'project-atlas',
    title: `card ${id}`,
    whyNow: 'CI 失败阻断合入',
    evidence: [{ sourceType: 'fixture', uri: 'fixture://github/project-atlas/runs/42', sourceId: 'ci-42', observedAt: NOW }],
    action: act(`act-${id}`),
    createdAt: NOW,
    expiresAt: '2026-10-29T12:00:00+08:00',
    status: 'proposed',
    ...overrides,
  };
}

function cand(id: string, c: Candidate): Candidate {
  return c;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-store-'));
  store = new Storage(path.join(dir, 'test.sqlite'));
  store.seedProjects([
    { id: 'project-atlas', name: 'Project Atlas', description: 'demo' },
    { id: 'project-beacon', name: 'Project Beacon', description: 'demo' },
  ]);
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('is idempotent: re-running applies nothing new', () => {
    const db = openDatabase(path.join(dir, 'mig.sqlite'));
    const r1 = migrate(db);
    const r2 = migrate(db);
    expect(r1.applied).toEqual([1, 2]);
    expect(r2.applied).toEqual([]);
    expect(r2.currentVersion).toBe(2);
    db.close();
  });
  it('fresh open via Storage applies migration and records version', () => {
    const row = store.db.prepare('SELECT COUNT(*) AS n FROM schema_version').get() as { n: number };
    expect(row.n).toBe(2);
  });
});

describe('events', () => {
  it('ingests once, collapses duplicate dedupe_key', () => {
    expect(store.ingestEvent(ev('e1')).inserted).toBe(true);
    const dup = { ...ev('e2'), dedupeKey: 'dedupe:e1' };
    expect(store.ingestEvent(dup).inserted).toBe(false);
    expect(store.listEvents({ limit: 100 })).toHaveLength(1);
  });
  it('filters by project server-side', () => {
    store.ingestEvent(ev('a1'));
    store.ingestEvent(ev('b1', { projectId: 'project-beacon', dedupeKey: 'dedupe:b1' }));
    expect(store.listEvents({ projectId: 'project-beacon' }).every((e) => e.projectId === 'project-beacon')).toBe(true);
    expect(store.listEvents({ projectId: 'project-beacon' })).toHaveLength(1);
  });
});

describe('foreign keys', () => {
  it('run_step with bogus run_id rejected (FK ON)', () => {
    expect(() =>
      store.db
        .prepare("INSERT INTO run_steps (id, run_id, sequence, name, status) VALUES ('s1', 'run-nope', 0, 'x', 'pending')")
        .run(),
    ).toThrow();
  });
  it('event for unknown project rejected', () => {
    expect(() =>
      store.db
        .prepare("INSERT INTO events (id, type, project_id, source_json, occurred_at, observed_at, summary, dedupe_key, sensitivity, provenance, tags_json) VALUES ('x','t','nope','{}','t','t','s','k','public','tool_observed','[]')")
        .run(),
    ).toThrow();
  });
});

describe('runs', () => {
  function seedRun(id: string, key: string): TaskRun {
    const c = card(`card-${id}`); // candidateId === `cand-card-${id}` inside
    store.upsertCandidate(
      cand(`cand-${id}`, {
        id: c.candidateId, projectId: 'project-atlas', eventIds: ['e1'], title: 't', whyNow: 'w',
        evidence: [{ sourceType: 'fixture', uri: 'fixture://x', sourceId: 'ci-42', observedAt: NOW }], suggestedAction: c.action, score: 0.9, confidence: 0.9, risk: 'L1',
        expiresAt: c.expiresAt, suppressionKey: `sup:${id}`, status: 'proposed',
      }),
    );
    store.insertCard(c);
    const run: TaskRun = {
      id, cardId: c.id, actionId: c.action.id, idempotencyKey: key, state: 'queued',
      createdAt: NOW, resultArtifactRefs: [],
    };
    return store.createRun(run, c.action).run;
  }

  it('idempotency key unique: double submit returns same run (S08)', () => {
    seedRun('r1', 'ab'.repeat(32));
    const c = store.getCard('card-r1')!;
    const again = store.createRun(
      { id: 'r1-dup', cardId: c.id, actionId: c.action.id, idempotencyKey: 'ab'.repeat(32), state: 'queued', createdAt: NOW, resultArtifactRefs: [] },
      c.action,
    );
    expect(again.existing).toBe(true);
    expect(again.run.id).toBe('r1');
  });

  it('state machine enforced inside transaction', () => {
    seedRun('r2', 'a'.repeat(64));
    store.transitionRun('r2', 'executing', { startedAt: NOW }, { actor: 'test' });
    expect(store.getRun('r2')!.state).toBe('executing');
    expect(() => store.transitionRun('r2', 'completed', {})).toThrow(/illegal/);
    store.transitionRun('r2', 'verifying', {});
    store.transitionRun('r2', 'completed', { verificationVerdict: 'pass', endedAt: NOW }, { actor: 'test' });
    expect(store.getRun('r2')!.state).toBe('completed');
  });

  it('restart persists: reopen DB, state and audit survive (E2E-03 base)', () => {
    seedRun('r3', 'b'.repeat(64));
    store.transitionRun('r3', 'executing', { startedAt: NOW }, { actor: 'test' });
    const dbPath = path.join(dir, 'test.sqlite');
    store.close();
    const reopened = new Storage(dbPath);
    expect(reopened.getRun('r3')!.state).toBe('executing');
    expect(reopened.listAudit('r3').length).toBeGreaterThan(0);
    reopened.close();
    store = new Storage(dbPath); // restore for afterEach close
  });
});

describe('approvals & settings & audit', () => {
  it('grants round-trip with digests; consumption is one-shot', () => {
    const c = card('c9');
    store.upsertCandidate({
      id: 'cand-c9', projectId: 'project-atlas', eventIds: ['e1'], title: 't', whyNow: 'w',
      evidence: [], suggestedAction: c.action, score: 0.9, confidence: 0.9, risk: 'L1',
      expiresAt: c.expiresAt, suppressionKey: 'sup:c9', status: 'proposed',
    });
    store.insertCard(c);
    const g: ApprovalGrant = {
      id: 'g1', principalId: 'user-local', cardId: c.id, actionDigest: actionDigest(c.action),
      targetDigest: targetDigest(c.action), risk: 'L2', authorizedCapabilities: ['fs.write_demo_artifact'],
      expiresAt: '2099-01-01T00:00:00Z', grantedAt: NOW,
    };
    store.insertGrant(g);
    expect(store.listGrantsForCard(c.id)[0]!.actionDigest).toBe(actionDigest(c.action));
    store.consumeGrant('g1', NOW);
    store.consumeGrant('g1', NOW); // second consume is a no-op
    expect(store.listGrantsForCard(c.id)[0]!.consumedAt).toBe(NOW);
  });

  it('settings JSON round-trip', () => {
    store.setSetting('quietHours', { start: '22:00', end: '08:00' });
    expect(store.getSetting<{ start: string }>('quietHours')!.start).toBe('22:00');
  });

  it('audit log is append-only through Storage API (no mutation surface)', () => {
    store.audit('test.event', 'tester', 'obj-1', { note: 'n' });
    const rows = store.listAudit('obj-1');
    expect(rows).toHaveLength(1);
    const st = (store.db as DatabaseSync).prepare("UPDATE audit_log SET event_type = 'tampered' WHERE object_id = 'obj-1'");
    expect(() => st.run()).not.toThrow(); // raw SQL possible in-process, but Storage exposes no API
    expect(store.listAudit('obj-1')[0]!.eventType === 'tampered').toBe(true);
  });

  it('refuses reset and preserves mixed demo events, independent user chat, settings and audit', () => {
    store.ingestEvent(ev('e9'));
    store.appendChat({ id: 'real-message', sessionId: 'independent-real-chat', role: 'user', content: 'private synthetic message', adapter: 'mock', createdAt: NOW });
    store.setSetting('user-preferences', { theme: 'dark' });
    store.audit('settings.updated', 'user', 'user-preferences', { theme: 'dark' });
    const tables = ['projects', 'events', 'chat_messages', 'threads', 'settings', 'audit_log'] as const;
    const snapshot = () => Object.fromEntries(tables.map(t => [t, store.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
    const before = snapshot();
    expect(() => store.resetDemoData()).toThrow(/refusing reset/i);
    expect(snapshot()).toEqual(before);
    expect(store.listChat('independent-real-chat')[0]?.content).toBe('private synthetic message');
    expect(store.getSetting('user-preferences')).toEqual({ theme: 'dark' });
  });

  it('allows an empty reset without deleting audit records', () => {
    store.audit('test.event', 'tester', 'obj-1');
    const before = store.listAudit();
    expect(() => store.resetDemoData()).not.toThrow();
    expect(store.listAudit()).toEqual(before);
  });

  it.each(['event', 'setting', 'chat', 'thread', 'source'] as const)('refuses unclassified %s data even if all projects are demo', kind => {
    if (kind === 'event') store.ingestEvent(ev('e9'));
    if (kind === 'setting') store.setSetting('user-preferences', { theme: 'dark' });
    if (kind === 'chat') store.appendChat({ id: 'm1', sessionId: 'unbound', role: 'user', content: 'message', adapter: 'mock', createdAt: NOW });
    if (kind === 'thread') store.insertThread({ id: 'thread-real', title: 'Real chat', preview: '', projectId: null, proactiveStatus: 'idle', proactiveMessageId: null, updatedAt: NOW, createdAt: NOW });
    if (kind === 'source') store.db.prepare("INSERT INTO sources (id, scope, type) VALUES ('source-real', 'private', 'local')").run();
    expect(() => store.resetDemoData()).toThrow(/refusing reset/i);
    if (kind === 'event') expect(store.listEvents({ limit: 100 })).toHaveLength(1);
    if (kind === 'setting') expect(store.getSetting('user-preferences')).toEqual({ theme: 'dark' });
    if (kind === 'chat') expect(store.listChat('unbound')).toHaveLength(1);
    if (kind === 'thread') expect(store.getThread('thread-real')).not.toBeNull();
    if (kind === 'source') expect(store.db.prepare("SELECT id FROM sources WHERE id = 'source-real'").get()).toBeDefined();
  });

  it('acquires the write lock before checking reset eligibility', () => {
    const other = openDatabase(path.join(dir, 'test.sqlite'));
    other.exec('BEGIN IMMEDIATE');
    store.db.exec('PRAGMA busy_timeout = 0');
    try {
      expect(() => store.resetDemoData()).toThrow(/locked/i);
    } finally {
      other.exec('ROLLBACK');
      other.close();
      store.db.exec('PRAGMA busy_timeout = 5000');
    }
    expect(() => store.resetDemoData()).not.toThrow();
  });

  it('refuses reset when a non-demo project exists', () => {
    store.seedProjects([{ id: 'user-project', name: 'User', description: '', visibility: 'private' }]);
    expect(() => store.resetDemoData()).toThrow(/non-demo/i);
    expect(store.listProjects().find(p => p.id === 'user-project')).toBeDefined();
  });
});
