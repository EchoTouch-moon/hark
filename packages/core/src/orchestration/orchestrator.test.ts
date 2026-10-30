import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Orchestrator, CardExpiredError } from './orchestrator.js';
import { DiscoveryService } from '../discovery/discovery.js';
import { Storage } from '@hearth/storage';
import { FixtureConnector } from '@hearth/connectors';
import type { ActionCard, ActionSpec, TaskRun } from '@hearth/contracts';
import { actionDigest, targetDigest, deriveIdempotencyKey } from '@hearth/contracts';

let dir: string;
let artifactRoot: string;
let store: Storage;
let orchestrator: Orchestrator;

const NOW = () => '2026-10-28T12:00:00.000Z';

async function seedAndDiscover(): Promise<void> {
  const connector = new FixtureConnector(process.cwd());
  store.seedProjects(connector.loadProjects());
  for (const { event, meta } of connector.loadEvents()) {
    store.ingestEvent(event, { goldenAction: meta.goldenAction, goldenUseful: meta.goldenUseful });
  }
  const discovery = new DiscoveryService({ storage: store, clock: NOW });
  await discovery.discover();
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-orch-'));
  artifactRoot = path.join(dir, 'artifacts');
  store = new Storage(path.join(dir, 'test.sqlite'));
  orchestrator = new Orchestrator({ storage: store, artifactRoot, clock: NOW, stepDelayMs: 0, allowLegacyExecution: true });
  await seedAndDiscover();
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

function cardByTitle(title: string): ActionCard {
  const cards = store.listCards({ limit: 50 });
  const hit = cards.find((c) => c.title === title);
  if (!hit) throw new Error(`card ${title} not found; have ${cards.map((c) => c.title).join(', ')}`);
  return hit;
}

describe('closed loop (E2E-01/02/04 core)', () => {
  it('queued -> executing -> verifying -> completed with real artifact + sha256 evidence', async () => {
    const card = cardByTitle('项目构建未通过');
    const { run, alreadyRunning } = await orchestrator.executeCard(card.id, 'user', { awaitCompletion: true });
    expect(alreadyRunning).toBe(false);
    const final = store.getRun(run.id)!;
    expect(final.state).toBe('completed');
    expect(final.verificationVerdict).toBe('pass');
    expect(final.resultArtifactRefs).toEqual(['report/ci-42.json']);

    const abs = path.join(artifactRoot, 'report/ci-42.json');
    expect(existsSync(abs)).toBe(true);
    const content = await readFile(abs, 'utf8');
    const parsed = JSON.parse(content) as { actionType: string; projectId: string };
    expect(parsed.actionType).toBe('report.generate');
    expect(parsed.projectId).toBe('project-atlas');

    const evidence = store.listEvidence(run.id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.kind).toBe('json_schema');
    expect(evidence[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);

    const steps = store.listSteps(run.id);
    expect(steps.map((s) => s.name)).toEqual(['diagnose.read_event', 'diagnose.summarize_failures', 'report.write_json']);
    expect(steps.every((s) => s.status === 'succeeded')).toBe(true);
    expect(store.getCard(card.id)!.status).toBe('completed');
  });

  it('all three golden scenarios close the loop', async () => {
    for (const title of ['可以继续上次的研究', '两场会议需要协调']) {
      const card = cardByTitle(title);
      const { run } = await orchestrator.executeCard(card.id, 'user', { awaitCompletion: true });
      expect(store.getRun(run.id)!.state).toBe('completed');
    }
    expect(existsSync(path.join(artifactRoot, 'checklists/project-beacon-experiment.md'))).toBe(true);
    expect(existsSync(path.join(artifactRoot, 'drafts/meeting-adjustment.md'))).toBe(true);
  });

  it('double-click idempotent: second execute returns same run, single artifact', async () => {
    const card = cardByTitle('项目构建未通过');
    const first = await orchestrator.executeCard(card.id, 'user', { awaitCompletion: true });
    const second = await orchestrator.executeCard(card.id, 'user', { awaitCompletion: true });
    expect(second.run.id).toBe(first.run.id);
    expect(second.alreadyRunning).toBe(true);
    expect(store.listRuns({ limit: 100 })).toHaveLength(1);
  });

  it('expired card refuses execution (E2E-05)', async () => {
    const card = cardByTitle('项目构建未通过');
    store.updateCard(card.id, { status: 'proposed' });
    // force expiry by writing a past expiresAt through a fresh card object
    store.db
      .prepare('UPDATE cards SET expires_at = ? WHERE id = ?')
      .run('2026-10-01T00:00:00Z', card.id);
    await expect(orchestrator.executeCard(card.id, 'user')).rejects.toBeInstanceOf(CardExpiredError);
    expect(store.getCard(card.id)!.status).toBe('expired');
    expect(store.listRuns({ limit: 10 })).toHaveLength(0);
  });
});

describe('approval flow (S05/S06-adjacent)', () => {
  function l2Card(id: string, params: Record<string, unknown>): ActionCard {
    const base = cardByTitle('两场会议需要协调');
    const spec: ActionSpec = {
      ...base.action,
      id: `act-${id}`,
      risk: 'L2',
      effect: 'external_write',
      params,
      allowedCapabilities: ['fs.write_demo_artifact'],
      verification: { kind: 'artifact_sha256', artifactPath: 'drafts/meeting-adjustment.md' },
      idempotencyKey: deriveIdempotencyKey({
        actionType: base.action.actionType,
        projectId: base.action.projectId,
        target: base.action.target,
        params,
        sourceVersion: base.action.expectedSourceVersion,
      }),
    };
    store.upsertCandidate({
      id: `cand-${id}`,
      projectId: spec.projectId,
      eventIds: ['ev-beacon-calendar-001'],
      title: `L2 ${id}`,
      whyNow: 'test',
      evidence: base.evidence,
      suggestedAction: spec,
      score: 0.5,
      confidence: 0.5,
      risk: 'L2',
      expiresAt: '2999-01-01T00:00:00Z',
      suppressionKey: `sup-l2-${id}`,
      status: 'proposed',
    });
    const card: ActionCard = {
      id,
      candidateId: `cand-${id}`,
      projectId: spec.projectId,
      title: `L2 ${id}`,
      whyNow: 'test',
      evidence: base.evidence,
      action: spec,
      createdAt: NOW(),
      expiresAt: '2999-01-01T00:00:00Z',
      status: 'proposed',
    };
    store.insertCard(card);
    return card;
  }

  it('unapproved L2 goes awaiting_approval with zero side effects; deny -> blocked', async () => {
    const card = l2Card('card-l2a', { to: 'alice@example.invalid' });
    const { run } = await orchestrator.executeCard(card.id, 'user', { awaitCompletion: true });
    expect(store.getRun(run.id)!.state).toBe('awaiting_approval');
    expect(store.getCard(card.id)!.status).toBe('awaiting_approval');
    expect(await existsSync(path.join(artifactRoot, 'drafts/meeting-adjustment.md'))).toBe(false);
    expect(store.listSteps(run.id)).toHaveLength(0); // executor never ran

    const denied = await orchestrator.decideApproval(run.id, 'deny', 'user');
    expect(denied.state).toBe('blocked');
  });

  it('approve -> executes and completes; grant bound to exact params (S06)', async () => {
    const card = l2Card('card-l2b', { to: 'alice@example.invalid' });
    const { run } = await orchestrator.executeCard(card.id, 'user', { awaitCompletion: true });
    expect(store.getRun(run.id)!.state).toBe('awaiting_approval');

    // a grant for DIFFERENT params must not unlock this run
    const spec = store.getRunActionSnapshot(run.id)!;
    const wrongGrant = {
      id: 'g-wrong',
      principalId: 'user',
      cardId: card.id,
      actionDigest: actionDigest({ ...spec, params: { to: 'bob@example.invalid' } }),
      targetDigest: targetDigest(spec),
      risk: 'L2' as const,
      authorizedCapabilities: spec.allowedCapabilities,
      expiresAt: '2999-01-01T00:00:00Z',
      grantedAt: NOW(),
    };
    store.insertGrant(wrongGrant);
    await orchestrator.decideApproval(run.id, 'approve', 'user');
    // correct grant was written by decideApproval; pipeline runs to completion
    const final = store.getRun(run.id)!;
    expect(final.state).toBe('completed');
    expect(final.verificationVerdict).toBe('pass');
    expect(await existsSync(path.join(artifactRoot, 'drafts/meeting-adjustment.md'))).toBe(true);
  });
});

describe('interrupted recovery (S09)', () => {
  it('executing run with existing valid artifact completes via readback, no re-execution', async () => {
    const card = cardByTitle('项目构建未通过');
    const run0 = await orchestrator.executeCard(card.id, 'user', { awaitCompletion: true });
    // simulate crash mid-flight of a second card: manually craft executing run
    const target = cardByTitle('可以继续上次的研究');
    const { run } = store.createRun(
      {
        id: 'run-crashed',
        cardId: target.id,
        actionId: target.action.id,
        idempotencyKey: target.action.idempotencyKey,
        state: 'executing',
        createdAt: NOW(),
        startedAt: NOW(),
        resultArtifactRefs: [],
      },
      target.action,
    );
    // artifact pre-exists (as if executor finished writing before crash)
    await mkdir(path.join(artifactRoot, 'checklists'), { recursive: true });
    await writeFile(path.join(artifactRoot, 'checklists/project-beacon-experiment.md'), '# 实验清单\n\n- [ ] 第一步\n', 'utf8');

    const recovered = await orchestrator.recoverInterrupted();
    const ids = recovered.map((r) => r.id);
    expect(ids).toContain('run-crashed');
    const after = store.getRun('run-crashed')!;
    expect(['completed', 'verifying', 'pending_verification']).toContain(after.state);
    if (after.state === 'completed') {
      expect(after.verificationVerdict).toBe('pass');
    }
    expect(store.getRun('run-crashed')!.state).not.toBe('executing');
    expect(run0.run.state).toBe('completed');
  });

  it('executing run with NO artifact goes pending_verification, never blind re-run', async () => {
    const target = cardByTitle('两场会议需要协调');
    store.createRun(
      {
        id: 'run-crashed2',
        cardId: target.id,
        actionId: target.action.id,
        idempotencyKey: target.action.idempotencyKey,
        state: 'executing',
        createdAt: NOW(),
        startedAt: NOW(),
        resultArtifactRefs: [],
      },
      target.action,
    );
    const recovered: TaskRun[] = await orchestrator.recoverInterrupted();
    const hit = recovered.find((r) => r.id === 'run-crashed2');
    expect(hit).toBeDefined();
    expect(hit!.state).toBe('pending_verification');
    expect(await existsSync(path.join(artifactRoot, 'drafts/meeting-adjustment.md'))).toBe(false);
  });
});
