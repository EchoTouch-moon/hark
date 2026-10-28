import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from '@hearth/project-observer';
import { commitAll, createGitRepo } from '../../project-observer/src/testkit/git-fixture.js';
import { openObserverDatabase } from '../../project-observer/src/state/schema.js';
import { InsightConsumer } from './consume.js';
import { InsightError } from './errors.js';
import { InProcessObserverReadPort } from './observer-read-port.js';
import { extractSignalBatch } from './signals/batch.js';
import { migrateInsight, openInsightDatabase } from './store/schema.js';
import { InsightStore } from './store/store.js';

let dir: string;
let now = new Date('2026-10-28T08:00:00.000Z');
let observer: ProjectObserver | undefined;
let store: InsightStore | undefined;

async function boot(): Promise<{
  observer: ProjectObserver;
  store: InsightStore;
  consumer: InsightConsumer;
  port: InProcessObserverReadPort;
  projectId: string;
  root: string;
}> {
  observer = new ProjectObserver({
    dbPath: path.join(dir, 'observer.sqlite'),
    clock: () => now,
    watchEnabled: false,
  });
  store = new InsightStore(path.join(dir, 'insights.sqlite'), { clock: () => now });
  const root = await createGitRepo(dir, 'repo');
  const project = await observer.registerProject(root);
  return {
    observer,
    store,
    consumer: new InsightConsumer(store),
    port: new InProcessObserverReadPort(observer),
    projectId: project.id,
    root,
  };
}

describe('S1.2 durable signal inbox', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'hearth-s12-'));
    now = new Date('2026-10-28T08:00:00.000Z');
  });

  afterEach(async () => {
    if (observer !== undefined) {
      await observer.stop();
      observer.close();
      observer = undefined;
    }
    store?.close();
    store = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('ST-01 same batch twice does not duplicate signals', async () => {
    const ctx = await boot();
    const first = await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId });
    const second = await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId });
    expect(ctx.store.countSignals(ctx.projectId)).toBe(first.signalsInserted);
    expect(second.signalsInserted).toBe(0);
    const ids = ctx.store.listSignalIds(ctx.projectId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ST-02/ST-03 injected faults roll back signals and cursor', async () => {
    const ctx = await boot();
    await writeFile(path.join(ctx.root, 'a.txt'), '1\n');
    await commitAll(ctx.root, 'a');
    await ctx.observer.scanProject(ctx.projectId, 'manual');
    const batch = extractSignalBatch(ctx.port, { projectId: ctx.projectId, afterSeq: 0, streamEpoch: 1, limit: 50 });
    expect(batch.outcome === 'OK' || batch.outcome === 'NO_SIGNAL').toBe(true);
    for (const fault of ['after-signals', 'after-cursor', 'before-commit'] as const) {
      expect(() =>
        ctx.store.commitSignalBatch({
          projectId: ctx.projectId,
          streamEpoch: 1,
          expectedRevision: 0,
          batch,
          fault,
        }),
      ).toThrow(InsightError);
      expect(ctx.store.countSignals(ctx.projectId)).toBe(0);
      expect(ctx.store.getCheckpoint(ctx.projectId, 1)).toBeNull();
    }
    const committed = ctx.store.commitSignalBatch({
      projectId: ctx.projectId,
      streamEpoch: 1,
      expectedRevision: 0,
      batch,
    });
    expect(committed.inserted).toBeGreaterThanOrEqual(0);
    expect(ctx.store.getCheckpoint(ctx.projectId, 1)?.afterSeq).toBe(batch.proposedCursor.afterSeq);
  });

  it('ST-04 restart resumes from committed checkpoint', async () => {
    const ctx = await boot();
    const first = await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId });
    const afterSeq = first.checkpoint.afterSeq;
    const ids = ctx.store.listSignalIds(ctx.projectId);
    ctx.store.close();
    store = new InsightStore(path.join(dir, 'insights.sqlite'), { clock: () => now });
    expect(store.getCheckpoint(ctx.projectId, 1)?.afterSeq).toBe(afterSeq);
    const consumer = new InsightConsumer(store);
    const again = await consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId });
    expect(store.listSignalIds(ctx.projectId)).toEqual(ids);
    expect(again.checkpoint.afterSeq).toBeGreaterThanOrEqual(afterSeq);
  });

  it('ST-05 concurrent workers cannot clobber the cursor', async () => {
    const ctx = await boot();
    const secondPath = path.join(dir, 'insights.sqlite');
    expect(() => new InsightStore(secondPath)).toThrow(InsightError);
    const [a, b] = await Promise.all([
      ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId }),
      ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId }),
    ]);
    const after = [a.checkpoint.afterSeq, b.checkpoint.afterSeq].sort((x, y) => x - y);
    expect(after[1]).toBeGreaterThanOrEqual(after[0]!);
    const ids = ctx.store.listSignalIds(ctx.projectId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ST-06 NO_SIGNAL still advances the cursor', async () => {
    const ctx = await boot();
    const result = await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId, limit: 200 });
    expect(result.outcome === 'OK' || result.outcome === 'NO_SIGNAL').toBe(true);
    expect(result.checkpoint.afterSeq).toBeGreaterThan(0);
    expect(result.eventsProcessed).toBeGreaterThan(0);
  });

  it('ST-07 EVIDENCE_UNAVAILABLE does not advance the cursor', async () => {
    const ctx = await boot();
    const blocked = {
      inspectSource: ctx.port.inspectSource.bind(ctx.port),
      readForward: ctx.port.readForward.bind(ctx.port),
      legacyOrderReconstructed: ctx.port.legacyOrderReconstructed.bind(ctx.port),
      getSnapshot: () => null,
    };
    const result = await ctx.consumer.consumeProjectBatch(blocked, { projectId: ctx.projectId });
    expect(result.outcome).toBe('EVIDENCE_UNAVAILABLE');
    expect(result.checkpoint.afterSeq).toBe(0);
    expect(ctx.store.getCheckpoint(ctx.projectId, 1)).toBeNull();
  });

  it('ST-08 PROJECT_REMOVED freezes and records an interruption', async () => {
    const ctx = await boot();
    await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId });
    await ctx.observer.removeProject(ctx.projectId);
    const result = await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId });
    expect(result.outcome).toBe('SOURCE_RESET_REQUIRED');
    expect(result.resetReason).toBe('PROJECT_REMOVED');
    expect(ctx.store.getCheckpoint(ctx.projectId, 1)?.status).toBe('FROZEN');
    expect(ctx.store.listInterruptions(ctx.projectId).some((row) => row.interruptionType === 'PROJECT_REMOVED')).toBe(
      true,
    );
    expect(ctx.store.listInterruptions(ctx.projectId).every((row) => row.resolutionStatus === 'OPEN')).toBe(true);
    expect(ctx.store.countSignals(ctx.projectId)).toBe(0);
  });

  it('ST-09 new epoch does not inherit the old cursor', async () => {
    const ctx = await boot();
    const first = await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId });
    await ctx.observer.removeProject(ctx.projectId);
    await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId });
    await ctx.observer.registerProject(ctx.root);
    const next = await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId });
    expect(next.checkpoint.streamEpoch).toBe(2);
    expect(ctx.store.getCheckpoint(ctx.projectId, 1)?.afterSeq).toBe(first.checkpoint.afterSeq);
    expect(ctx.store.getCheckpoint(ctx.projectId, 1)?.status).toBe('FROZEN');
    expect(ctx.store.getCheckpoint(ctx.projectId, 2)?.status).toBe('ACTIVE');
  });

  it('ST-10 cursor ahead of restored stream does not reset to zero', async () => {
    const ctx = await boot();
    const first = await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId });
    expect(first.checkpoint.afterSeq).toBeGreaterThan(0);
    ctx.observer.store.db.prepare(`UPDATE observer_meta SET value = 0 WHERE key = 'append_seq'`).run();
    ctx.observer.store.db.exec('DELETE FROM observer_events');
    const result = await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId });
    expect(result.outcome).toBe('SOURCE_RESET_REQUIRED');
    expect(result.resetReason).toBe('CURSOR_AHEAD_OF_STREAM');
    expect(ctx.store.getCheckpoint(ctx.projectId, 1)?.afterSeq).toBe(first.checkpoint.afterSeq);
    expect(ctx.store.getCheckpoint(ctx.projectId, 1)?.status).toBe('FROZEN');
  });

  it('ST-11 frozen highWatermark leaves later events for the next round', async () => {
    const ctx = await boot();
    const freeze = ctx.observer.store.allocatedAppendSeq();
    await writeFile(path.join(ctx.root, 'later.txt'), 'x\n');
    await commitAll(ctx.root, 'later');
    now = new Date('2026-10-28T08:01:00.000Z');
    await ctx.observer.scanProject(ctx.projectId, 'manual');
    const first = await ctx.consumer.consumeProjectBatch(ctx.port, {
      projectId: ctx.projectId,
      highWatermark: freeze,
      limit: 200,
    });
    expect(first.checkpoint.afterSeq).toBeLessThanOrEqual(freeze);
    const second = await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId, limit: 200 });
    expect(second.checkpoint.afterSeq).toBeGreaterThan(freeze);
  });

  it('ST-15 source deleted after extract is detected on the next consume', async () => {
    const ctx = await boot();
    await writeFile(path.join(ctx.root, 'a.txt'), '1\n');
    await commitAll(ctx.root, 'a');
    await ctx.observer.scanProject(ctx.projectId, 'manual');
    const batch = extractSignalBatch(ctx.port, { projectId: ctx.projectId, afterSeq: 0, streamEpoch: 1, limit: 50 });
    await ctx.observer.removeProject(ctx.projectId);
    ctx.store.commitSignalBatch({
      projectId: ctx.projectId,
      streamEpoch: 1,
      expectedRevision: 0,
      batch,
    });
    const next = await ctx.consumer.consumeProjectBatch(ctx.port, { projectId: ctx.projectId });
    expect(next.outcome).toBe('SOURCE_RESET_REQUIRED');
    expect(next.resetReason).toBe('PROJECT_REMOVED');
  });
});

describe('S1.2 schema and unreadable files', () => {
  it('ST-13 failed migration rolls back', async () => {
    const dirLocal = await mkdtemp(path.join(tmpdir(), 'hearth-s12-mig-'));
    const dbPath = path.join(dirLocal, 'insights.sqlite');
    const db = openInsightDatabase(dbPath, { untilVersion: 0 });
    expect(() =>
      migrateInsight(db, {
        migrations: [
          {
            version: 1,
            name: 'boom',
            up: () => {
              throw new Error('boom');
            },
          },
        ],
      }),
    ).toThrow(InsightError);
    const version = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
    expect(version.v).toBeNull();
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='signal_inbox'`).get();
    expect(tables).toBeUndefined();
    db.close();
    await rm(dirLocal, { recursive: true, force: true });
  });

  it('ST-12 legacy reconstructed order is persisted on inbox payload', async () => {
    const dirLocal = await mkdtemp(path.join(tmpdir(), 'hearth-s12-legacy-'));
    const observerPath = path.join(dirLocal, 'observer.sqlite');
    const v2 = openObserverDatabase(observerPath, { untilVersion: 2 });
    const occurredAt = '2026-10-28T08:00:00.000Z';
    const projectId = 'prj_aaaaaaaaaaaaaaaa';
    const worktree = JSON.stringify({
      clean: true,
      conflicted: false,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      renamed: 0,
      unmerged: 0,
    });
    const testJson = JSON.stringify({
      result: 'UNKNOWN',
      evidenceQuality: 'UNKNOWN',
      headBound: false,
      stale: false,
      sourceTimeKind: 'none',
    });
    v2.exec('BEGIN');
    v2.prepare(
      `INSERT INTO observer_projects (id, name, canonical_path, git_identity, enabled, created_at, scan_interval_ms, debounce_ms)
       VALUES (?, 'seed', '/tmp/seed-v2', NULL, 1, ?, 300000, 1500)`,
    ).run(projectId, occurredAt);
    v2.prepare(
      `INSERT INTO observation_runs (id, project_id, started_at, finished_at, status, source, error_code, error_message)
       VALUES ('run_aaaaaaaaaaaaaaaa', ?, ?, ?, 'ok', 'manual', NULL, NULL)`,
    ).run(projectId, occurredAt, occurredAt);
    v2.prepare(
      `INSERT INTO observer_snapshots
       (id, project_id, observed_at, fingerprint, head_sha, branch, detached, unborn, worktree_json, test_json, accessibility, git_identity)
       VALUES ('snap_aaaaaaaaaaaaaaaa', ?, ?, 'seedfingerprint000', NULL, 'main', 0, 0, ?, ?, 'OK', NULL)`,
    ).run(projectId, occurredAt, worktree, testJson);
    v2.prepare(
      `INSERT INTO observer_events
       (id, project_id, run_id, type, before_snapshot_id, after_snapshot_id, occurred_at, payload_json, evidence_json)
       VALUES ('evt_aaaaaaaaaaaaaaaa', ?, 'run_aaaaaaaaaaaaaaaa', 'OBSERVATION_GAP', NULL, 'snap_aaaaaaaaaaaaaaaa', ?, '{"gapMs":10}', ?)`,
    ).run(
      projectId,
      occurredAt,
      JSON.stringify({ source: 'system', observationRunId: 'run_aaaaaaaaaaaaaaaa', quality: 'OBSERVED' }),
    );
    v2.exec('COMMIT');
    v2.close();
    const legacyObserver = new ProjectObserver({ dbPath: observerPath, watchEnabled: false });
    const legacyStore = new InsightStore(path.join(dirLocal, 'insights.sqlite'), { clock: () => now });
    const result = await new InsightConsumer(legacyStore).consumeProjectBatch(new InProcessObserverReadPort(legacyObserver), {
      projectId,
      limit: 50,
    });
    expect(result.outcome === 'OK' || result.outcome === 'NO_SIGNAL').toBe(true);
    const payload = legacyStore.db
      .prepare('SELECT payload_json AS json FROM signal_inbox WHERE project_id = ?')
      .get(projectId) as { json: string } | undefined;
    expect(payload).toBeDefined();
    const parsed = JSON.parse(payload!.json) as { facts?: { orderUncertainty?: string } };
    expect(parsed.facts?.orderUncertainty).toBe('reconstructed_rowid');
    await legacyObserver.stop();
    legacyObserver.close();
    legacyStore.close();
    await rm(dirLocal, { recursive: true, force: true });
  });

  it('ST-14 unreadable insight db fails closed', async () => {
    const dirLocal = await mkdtemp(path.join(tmpdir(), 'hearth-s12-bad-'));
    const dbPath = path.join(dirLocal, 'insights.sqlite');
    await writeFile(dbPath, 'this is not sqlite');
    expect(() => new InsightStore(dbPath, { skipWriterLock: true })).toThrow(InsightError);
    await rm(dirLocal, { recursive: true, force: true });
  });
});
