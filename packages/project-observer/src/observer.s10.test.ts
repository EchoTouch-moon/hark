import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProjectObserver } from './observer.js';
import {
  OBSERVER_MIGRATIONS,
  OBSERVER_SCHEMA_VERSION,
  migrateObserver,
  openObserverDatabase,
} from './state/schema.js';
import { commitAll, createGitRepo } from './testkit/git-fixture.js';

let dir: string;
let now = new Date('2026-10-28T08:00:00.000Z');

const WORKTREE = JSON.stringify({
  clean: true,
  conflicted: false,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  renamed: 0,
  unmerged: 0,
});
const TEST = JSON.stringify({
  result: 'UNKNOWN',
  evidenceQuality: 'UNKNOWN',
  headBound: false,
  stale: false,
  sourceTimeKind: 'none',
});

function seedV2Events(db: DatabaseSync): { projectId: string; eventIds: readonly string[] } {
  const occurredAt = '2026-10-28T08:00:00.000Z';
  const projectId = 'prj_aaaaaaaaaaaaaaaa';
  const runId = 'run_aaaaaaaaaaaaaaaa';
  const snapId = 'snap_aaaaaaaaaaaaaaaa';
  db.exec('BEGIN');
  db.prepare(
    `INSERT INTO observer_projects
     (id, name, canonical_path, git_identity, enabled, created_at, scan_interval_ms, debounce_ms)
     VALUES (?, 'seed', '/tmp/seed-v2', NULL, 1, ?, 300000, 1500)`,
  ).run(projectId, occurredAt);
  db.prepare(
    `INSERT INTO observation_runs (id, project_id, started_at, finished_at, status, source, error_code, error_message)
     VALUES (?, ?, ?, ?, 'ok', 'manual', NULL, NULL)`,
  ).run(runId, projectId, occurredAt, occurredAt);
  db.prepare(
    `INSERT INTO observer_snapshots
     (id, project_id, observed_at, fingerprint, head_sha, branch, detached, unborn, worktree_json, test_json, accessibility, git_identity)
     VALUES (?, ?, ?, 'seedfingerprint000', NULL, 'main', 0, 0, ?, ?, 'OK', NULL)`,
  ).run(snapId, projectId, occurredAt, WORKTREE, TEST);
  const eventIds = ['evt_aaaaaaaaaaaaaaaa', 'evt_bbbbbbbbbbbbbbbb', 'evt_cccccccccccccccc'] as const;
  const insert = db.prepare(
    `INSERT INTO observer_events
     (id, project_id, run_id, type, before_snapshot_id, after_snapshot_id, occurred_at, payload_json, evidence_json)
     VALUES (?, ?, ?, ?, NULL, ?, ?, '{}', ?)`,
  );
  const evidence = JSON.stringify({ source: 'system', observationRunId: runId, quality: 'OBSERVED' });
  insert.run(eventIds[0], projectId, runId, 'PROJECT_REGISTERED', snapId, occurredAt, evidence);
  insert.run(eventIds[1], projectId, runId, 'WORKTREE_STATE_CHANGED', snapId, occurredAt, evidence);
  insert.run(eventIds[2], projectId, runId, 'REPOSITORY_HEAD_CHANGED', snapId, occurredAt, evidence);
  db.prepare(
    `INSERT INTO observer_health
     (project_id, last_success_at, last_error_code, last_error_message, watch_status, collection_status,
      last_reconcile_at, last_observed_at, last_snapshot_id, current_revision, last_gap_at)
     VALUES (?, ?, NULL, NULL, 'polling', 'OK', NULL, ?, ?, 1, NULL)`,
  ).run(projectId, occurredAt, occurredAt, snapId);
  db.exec('COMMIT');
  return { projectId, eventIds };
}

describe('S1.0 observer schema v3 forward consume', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'hearth-s10-'));
    now = new Date('2026-10-28T08:00:00.000Z');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('assigns append_seq in insert order when occurred_at is identical', async () => {
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
    const root = await createGitRepo(dir, 'same-time');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'a.txt'), '1\n');
    await commitAll(root, 'a1');
    await observer.scanProject(project.id, 'manual');
    await writeFile(path.join(root, 'a.txt'), '2\n');
    await commitAll(root, 'a2');
    await observer.scanProject(project.id, 'manual');
    const page = observer.listEventsForward(project.id, { limit: 200 });
    expect(page.status).toBe('OK');
    expect(page.events.length).toBeGreaterThanOrEqual(2);
    const times = new Set(page.events.map((event) => event.observedAt));
    expect(times.size).toBe(1);
    const seqs = page.events.map((event) => event.appendSeq ?? 0);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    await observer.stop();
    observer.close();
  });

  it('consumes A → B → A worktree changes in append order', async () => {
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
    const root = await createGitRepo(dir, 'aba');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'note.txt'), 'A\n');
    await commitAll(root, 'A');
    now = new Date('2026-10-28T08:01:00.000Z');
    await observer.scanProject(project.id, 'manual');
    await writeFile(path.join(root, 'note.txt'), 'B\n');
    await commitAll(root, 'B');
    now = new Date('2026-10-28T08:02:00.000Z');
    await observer.scanProject(project.id, 'manual');
    await writeFile(path.join(root, 'note.txt'), 'A\n');
    await commitAll(root, 'A-again');
    now = new Date('2026-10-28T08:03:00.000Z');
    await observer.scanProject(project.id, 'manual');
    const heads = observer
      .listEventsForward(project.id, { limit: 200 })
      .events.filter((event) => event.type === 'REPOSITORY_HEAD_CHANGED');
    expect(heads.length).toBeGreaterThanOrEqual(3);
    const payloads = heads.map((event) => (event.payload as { current: string | null }).current);
    expect(new Set(payloads).size).toBeGreaterThanOrEqual(2);
    const seqs = heads.map((event) => event.appendSeq ?? 0);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    await observer.stop();
    observer.close();
  });

  it('frozen highWatermark ignores events inserted during pagination', async () => {
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
    const root = await createGitRepo(dir, 'page');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'a.txt'), '1\n');
    await commitAll(root, 'p1');
    await observer.scanProject(project.id, 'manual');
    await writeFile(path.join(root, 'a.txt'), '2\n');
    await commitAll(root, 'p2');
    await observer.scanProject(project.id, 'manual');
    const freeze = observer.store.allocatedAppendSeq();
    const first = observer.listEventsForward(project.id, { afterSeq: 0, limit: 1, highWatermark: freeze });
    expect(first.events).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    await writeFile(path.join(root, 'extra.txt'), 'x\n');
    await commitAll(root, 'extra');
    now = new Date('2026-10-28T08:04:00.000Z');
    await observer.scanProject(project.id, 'manual');
    expect(observer.store.allocatedAppendSeq()).toBeGreaterThan(freeze);
    const rest: string[] = [];
    let cursor = first.nextCursor;
    let guard = 0;
    while (guard < 20) {
      const page = observer.listEventsForward(project.id, {
        afterSeq: cursor,
        limit: 1,
        highWatermark: freeze,
      });
      rest.push(...page.events.map((event) => event.eventId));
      if (!page.hasMore) break;
      cursor = page.nextCursor;
      guard += 1;
    }
    const frozenIds = [first.events[0]!.eventId, ...rest];
    const live = observer.listEventsForward(project.id, { limit: 200, highWatermark: freeze });
    expect(frozenIds).toEqual(live.events.map((event) => event.eventId));
    expect(new Set(frozenIds).size).toBe(frozenIds.length);
    expect(live.events.every((event) => (event.appendSeq ?? 0) <= freeze)).toBe(true);
    const later = observer.listEventsForward(project.id, { afterSeq: freeze, limit: 200 });
    expect(later.events.length).toBeGreaterThan(0);
    await observer.stop();
    observer.close();
  });

  it('continues the sequence across process restart', async () => {
    const dbPath = path.join(dir, 'observer.sqlite');
    const observer = new ProjectObserver({ dbPath, clock: () => now, watchEnabled: false });
    const root = await createGitRepo(dir, 'restart');
    const project = await observer.registerProject(root);
    const before = observer.store.allocatedAppendSeq();
    const ids = observer.listEventsForward(project.id, { limit: 200 }).events.map((event) => event.eventId);
    await observer.stop();
    observer.close();
    const resumed = new ProjectObserver({ dbPath, clock: () => now, watchEnabled: false });
    expect(resumed.store.allocatedAppendSeq()).toBe(before);
    expect(resumed.listEventsForward(project.id, { limit: 200 }).events.map((event) => event.eventId)).toEqual(ids);
    await writeFile(path.join(root, 'n.txt'), '1\n');
    await resumed.scanProject(project.id, 'manual');
    expect(resumed.store.allocatedAppendSeq()).toBeGreaterThan(before);
    await resumed.stop();
    resumed.close();
  });

  it('keeps append_seq stable across VACUUM', async () => {
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
    const root = await createGitRepo(dir, 'vac');
    const project = await observer.registerProject(root);
    const before = observer.listEventsForward(project.id, { limit: 200 }).events.map((event) => ({
      id: event.eventId,
      seq: event.appendSeq,
    }));
    observer.store.db.exec('VACUUM');
    const after = observer.listEventsForward(project.id, { limit: 200 }).events.map((event) => ({
      id: event.eventId,
      seq: event.appendSeq,
    }));
    expect(after).toEqual(before);
    await observer.stop();
    observer.close();
  });

  it('rolls back allocated seq with injected scan faults', async () => {
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
    const root = await createGitRepo(dir, 'fault');
    const project = await observer.registerProject(root);
    const beforeEvents = observer.store.countEvents(project.id);
    const beforeSeq = observer.store.allocatedAppendSeq();
    await writeFile(path.join(root, 'dirty.txt'), 'x\n');
    now = new Date('2026-10-28T08:05:00.000Z');
    await expect(observer.scanProject(project.id, 'manual', 'after-events')).rejects.toMatchObject({
      code: 'INJECTED_FAULT',
    });
    expect(observer.store.countEvents(project.id)).toBe(beforeEvents);
    expect(observer.store.allocatedAppendSeq()).toBe(beforeSeq);
    await observer.stop();
    observer.close();
  });

  it('does not reuse append_seq after deleting the tail event', async () => {
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
    const root = await createGitRepo(dir, 'tail');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'keep.txt'), '1\n');
    await commitAll(root, 'keep');
    now = new Date('2026-10-28T08:05:30.000Z');
    await observer.scanProject(project.id, 'manual');
    const tail = observer.store.allocatedAppendSeq();
    observer.store.db.prepare('DELETE FROM observer_events WHERE append_seq = ?').run(tail);
    const remainingMaxRow = observer.store.db
      .prepare('SELECT MAX(append_seq) AS seq FROM observer_events')
      .get() as { seq: number | bigint | null };
    const remainingMax = Number(remainingMaxRow.seq);
    expect(remainingMax).toBeGreaterThan(0);
    expect(remainingMax).toBeLessThan(tail);
    await writeFile(path.join(root, 'tail.txt'), 'x\n');
    now = new Date('2026-10-28T08:06:00.000Z');
    await observer.scanProject(project.id, 'manual');
    const seqs = (
      observer.store.db.prepare('SELECT append_seq AS seq FROM observer_events').all() as Array<{
        seq: number | bigint;
      }>
    ).map((row) => Number(row.seq));
    expect(seqs).not.toContain(tail);
    expect(Math.max(...seqs)).toBeGreaterThan(tail);
    expect(observer.store.allocatedAppendSeq()).toBeGreaterThan(tail);
    await observer.stop();
    observer.close();
  });

  it('migrates v2 rows to v3 with reconstructed order and rolls back a failed v3', () => {
    const dbPath = path.join(dir, 'mig.sqlite');
    const v2 = openObserverDatabase(dbPath, { untilVersion: 2 });
    const seeded = seedV2Events(v2);
    const beforeIds = v2
      .prepare('SELECT id FROM observer_events ORDER BY rowid ASC')
      .all() as Array<{ id: string }>;
    expect(beforeIds.map((row) => row.id)).toEqual(seeded.eventIds);
    v2.close();

    const v3 = openObserverDatabase(dbPath);
    const version = v3.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(version.v).toBe(OBSERVER_SCHEMA_VERSION);
    const migrated = v3
      .prepare('SELECT id, append_seq AS seq FROM observer_events ORDER BY append_seq ASC')
      .all() as Array<{ id: string; seq: number }>;
    expect(migrated.map((row) => row.id)).toEqual(seeded.eventIds);
    expect(migrated.map((row) => row.seq)).toEqual([1, 2, 3]);
    const reconstructed = v3
      .prepare(`SELECT value FROM observer_meta WHERE key = 'legacy_order_reconstructed'`)
      .get() as { value: number };
    expect(reconstructed.value).toBe(1);
    const counter = v3.prepare(`SELECT value FROM observer_meta WHERE key = 'append_seq'`).get() as { value: number };
    expect(counter.value).toBe(3);
    v3.close();

    const failPath = path.join(dir, 'fail.sqlite');
    const failDb = openObserverDatabase(failPath, { untilVersion: 2 });
    seedV2Events(failDb);
    expect(() =>
      migrateObserver(failDb, {
        migrations: [
          ...OBSERVER_MIGRATIONS.filter((migration) => migration.version <= 2),
          {
            version: 3,
            name: 'boom',
            up: () => {
              throw new Error('boom');
            },
          },
        ],
      }),
    ).toThrow(/observer migration v3 failed/);
    const still = failDb.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(still.v).toBe(2);
    const cols = failDb.prepare('PRAGMA table_info(observer_events)').all() as Array<{ name: string }>;
    expect(cols.map((col) => col.name)).not.toContain('append_seq');
    failDb.close();
  });

  it('keeps DESC UI pagination independent of append_seq', async () => {
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
    const root = await createGitRepo(dir, 'ui');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'a.txt'), '1\n');
    await commitAll(root, 'ui-1');
    now = new Date('2026-10-28T08:07:00.000Z');
    await observer.scanProject(project.id, 'manual');
    await writeFile(path.join(root, 'a.txt'), '2\n');
    await commitAll(root, 'ui-2');
    now = new Date('2026-10-28T08:08:00.000Z');
    await observer.scanProject(project.id, 'manual');
    const page1 = observer.listEvents(project.id, { limit: 1 });
    expect(page1.nextCursor).toEqual(expect.stringMatching(/\|evt_/));
    const page2 = observer.listEvents(project.id, { limit: 1, cursor: page1.nextCursor ?? undefined });
    const ids = [...page1.events, ...page2.events].map((event) => event.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    const times = [...page1.events, ...page2.events].map((event) => event.observedAt);
    const sorted = [...times].sort((a, b) => b.localeCompare(a));
    expect(times).toEqual(sorted);
    await observer.stop();
    observer.close();
  });

  it('detects project removal and epoch change after re-register', async () => {
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
    const root = await createGitRepo(dir, 'gone');
    const project = await observer.registerProject(root);
    const live = observer.listEventsForward(project.id, { limit: 50 });
    expect(live.status).toBe('OK');
    expect(live.streamEpoch).toBe(1);
    const missing = observer.listEventsForward('prj_ffffffffffffffff');
    expect(missing.status).toBe('PROJECT_NOT_FOUND');
    await observer.removeProject(project.id);
    const removed = observer.listEventsForward(project.id, { expectedEpoch: 1 });
    expect(removed.status).toBe('PROJECT_REMOVED');
    expect(removed.events).toEqual([]);
    expect(observer.store.getEventStream(project.id)?.retiredAt).not.toBeNull();
    const again = await observer.registerProject(root);
    expect(again.id).toBe(project.id);
    const mismatch = observer.listEventsForward(again.id, { expectedEpoch: 1 });
    expect(mismatch.status).toBe('STREAM_EPOCH_MISMATCH');
    expect(mismatch.streamEpoch).toBe(2);
    const fresh = observer.listEventsForward(again.id, { expectedEpoch: 2 });
    expect(fresh.status).toBe('OK');
    expect(fresh.streamEpoch).toBe(2);
    await observer.stop();
    observer.close();
  });

  it('flags a cursor that is ahead of the allocated sequence after rewind', async () => {
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
    const root = await createGitRepo(dir, 'rewind');
    const project = await observer.registerProject(root);
    const live = observer.listEventsForward(project.id, { limit: 50 });
    expect(live.status).toBe('OK');
    observer.store.db.prepare(`UPDATE observer_meta SET value = 0 WHERE key = 'append_seq'`).run();
    observer.store.db.exec('DELETE FROM observer_events');
    const ahead = observer.listEventsForward(project.id, { afterSeq: live.highWatermark });
    expect(ahead.status).toBe('CURSOR_AHEAD_OF_STREAM');
    expect(ahead.events).toEqual([]);
    await observer.stop();
    observer.close();
  });

  it('returns an empty OK page when afterSeq is at the watermark', async () => {
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
    const root = await createGitRepo(dir, 'empty');
    const project = await observer.registerProject(root);
    const hw = observer.store.allocatedAppendSeq();
    const page = observer.listEventsForward(project.id, { afterSeq: hw, highWatermark: hw });
    expect(page.events).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBe(hw);
    expect(page.status).toBe('OK');
    await observer.stop();
    observer.close();
  });
});
