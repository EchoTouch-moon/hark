import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from '@hearth/project-observer';
import {
  SAMPLE_JUNIT_BAD,
  SAMPLE_JUNIT_FAIL,
  SAMPLE_JUNIT_PASS,
  commitAll,
  createGitRepo,
  repoReadOnlyFingerprint,
} from '../../project-observer/src/testkit/git-fixture.js';
import { openObserverDatabase } from '../../project-observer/src/state/schema.js';
import { InProcessObserverReadPort } from './observer-read-port.js';
import { extractSignalBatch } from './signals/batch.js';
import { InsightSchema } from './contracts.js';

let dir: string;
let now = new Date('2026-10-28T08:00:00.000Z');
let observer: ProjectObserver | undefined;

async function makeObserver(): Promise<ProjectObserver> {
  observer = new ProjectObserver({
    dbPath: path.join(dir, 'observer.sqlite'),
    clock: () => now,
    watchEnabled: false,
  });
  return observer;
}

describe('S1.1 observer read port and signal batch', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'hearth-s11-'));
    now = new Date('2026-10-28T08:00:00.000Z');
  });

  afterEach(async () => {
    if (observer !== undefined) {
      await observer.stop();
      observer.close();
      observer = undefined;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('repeats the same signals and does not write observer or the git repo', async () => {
    observer = await makeObserver();
    const root = await createGitRepo(dir, 'idemp');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'note.txt'), 'A\n');
    await commitAll(root, 'signal');
    await observer.scanProject(project.id, 'manual');
    const beforeRepo = await repoReadOnlyFingerprint(root);
    const port = new InProcessObserverReadPort(observer);
    const seq = observer!.store.allocatedAppendSeq();
    const events = observer!.store.countEvents(project.id);
    const revision = observer!.getObserverHealth(project.id).currentRevision;
    const first = extractSignalBatch(port, { projectId: project.id, afterSeq: 0, streamEpoch: 1, limit: 50 });
    const second = extractSignalBatch(port, { projectId: project.id, afterSeq: 0, streamEpoch: 1, limit: 50 });
    expect(first.signals.map((item) => item.signalKey)).toEqual(second.signals.map((item) => item.signalKey));
    expect(first.signals.every((item) => item.headBinding === 'UNDETERMINED')).toBe(true);
    expect(observer!.store.allocatedAppendSeq()).toBe(seq);
    expect(observer!.store.countEvents(project.id)).toBe(events);
    expect(observer!.getObserverHealth(project.id).currentRevision).toBe(revision);
    expect(await repoReadOnlyFingerprint(root)).toEqual(beforeRepo);
    expect(first.signals.length).toBeGreaterThan(0);
    expect(first.signals.every((item) => InsightSchema.safeParse(item).success === false)).toBe(true);
  });

  it('orders same-timestamp events by append_seq and recognizes A→B→A HEAD changes', async () => {
    observer = await makeObserver();
    const root = await createGitRepo(dir, 'aba');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'note.txt'), 'A\n');
    await commitAll(root, 'A');
    await observer.scanProject(project.id, 'manual');
    await writeFile(path.join(root, 'note.txt'), 'B\n');
    await commitAll(root, 'B');
    await observer.scanProject(project.id, 'manual');
    await writeFile(path.join(root, 'note.txt'), 'A\n');
    await commitAll(root, 'A-again');
    await observer.scanProject(project.id, 'manual');
    const port = new InProcessObserverReadPort(observer);
    const batch = extractSignalBatch(port, { projectId: project.id, afterSeq: 0, streamEpoch: 1, limit: 200 });
    const seqs = batch.signals.map((item) => item.appendSeq ?? 0);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    const heads = batch.signals.filter((item) => item.kind === 'REPOSITORY_HEAD_CHANGED');
    expect(heads.length).toBeGreaterThanOrEqual(3);
    expect(new Set(heads.map((item) => String(item.facts['current']))).size).toBeGreaterThanOrEqual(2);
  });

  it('freezes highWatermark so later events stay out of the batch', async () => {
    observer = await makeObserver();
    const root = await createGitRepo(dir, 'hw');
    const project = await observer.registerProject(root);
    const port = new InProcessObserverReadPort(observer);
    const freeze = observer.store.allocatedAppendSeq();
    await writeFile(path.join(root, 'x.txt'), '1\n');
    await commitAll(root, 'later');
    now = new Date('2026-10-28T08:01:00.000Z');
    await observer.scanProject(project.id, 'manual');
    const frozen = extractSignalBatch(port, {
      projectId: project.id,
      afterSeq: 0,
      streamEpoch: 1,
      limit: 200,
      highWatermark: freeze,
    });
    expect(frozen.signals.every((item) => (item.appendSeq ?? 0) <= freeze)).toBe(true);
    expect(frozen.highWatermark).toBe(freeze);
    const live = extractSignalBatch(port, { projectId: project.id, afterSeq: freeze, streamEpoch: 1, limit: 200 });
    expect(live.signals.length).toBeGreaterThan(0);
  });

  it('resumes from proposedCursor after a restart', async () => {
    const dbPath = path.join(dir, 'observer.sqlite');
    observer = new ProjectObserver({ dbPath, clock: () => now, watchEnabled: false });
    const root = await createGitRepo(dir, 'resume');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'a.txt'), '1\n');
    await commitAll(root, 'a');
    await observer.scanProject(project.id, 'manual');
    const first = extractSignalBatch(new InProcessObserverReadPort(observer), {
      projectId: project.id,
      afterSeq: 0,
      streamEpoch: 1,
      limit: 1,
    });
    expect(first.hasMore).toBe(true);
    await observer.stop();
    observer.close();
    observer = new ProjectObserver({ dbPath, clock: () => now, watchEnabled: false });
    const rest = extractSignalBatch(new InProcessObserverReadPort(observer), {
      projectId: project.id,
      afterSeq: first.proposedCursor.afterSeq,
      streamEpoch: first.proposedCursor.streamEpoch,
      limit: 200,
    });
    const overlap = new Set(first.signals.map((item) => item.signalKey));
    expect(rest.signals.every((item) => !overlap.has(item.signalKey))).toBe(true);
  });

  it('does not treat global seq holes between projects as lost events', async () => {
    observer = await makeObserver();
    const aRoot = await createGitRepo(dir, 'proj-a');
    const bRoot = await createGitRepo(dir, 'proj-b');
    const a = await observer.registerProject(aRoot);
    const b = await observer.registerProject(bRoot);
    await writeFile(path.join(bRoot, 'b.txt'), '1\n');
    await commitAll(bRoot, 'b');
    await observer.scanProject(b.id, 'manual');
    await writeFile(path.join(aRoot, 'a.txt'), '1\n');
    await commitAll(aRoot, 'a');
    await observer.scanProject(a.id, 'manual');
    const port = new InProcessObserverReadPort(observer);
    const batch = extractSignalBatch(port, { projectId: a.id, afterSeq: 0, streamEpoch: 1, limit: 200 });
    expect(batch.outcome === 'OK' || batch.outcome === 'NO_SIGNAL').toBe(true);
    expect(batch.reasonCode).toBeUndefined();
    const seqs = batch.signals.map((item) => item.appendSeq ?? 0);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
  });

  it('returns SOURCE_RESET_REQUIRED after delete, re-register, and cursor rewind', async () => {
    observer = await makeObserver();
    const root = await createGitRepo(dir, 'reset');
    const project = await observer.registerProject(root);
    const port = new InProcessObserverReadPort(observer);
    await observer.removeProject(project.id);
    const removed = extractSignalBatch(port, { projectId: project.id, afterSeq: 0, streamEpoch: 1, limit: 50 });
    expect(removed.outcome).toBe('SOURCE_RESET_REQUIRED');
    expect(removed.resetReason).toBe('PROJECT_REMOVED');
    const again = await observer.registerProject(root);
    const mismatch = extractSignalBatch(port, { projectId: again.id, afterSeq: 0, streamEpoch: 1, limit: 50 });
    expect(mismatch.outcome).toBe('SOURCE_RESET_REQUIRED');
    expect(mismatch.resetReason).toBe('STREAM_EPOCH_MISMATCH');
    observer.store.db.prepare(`UPDATE observer_meta SET value = 0 WHERE key = 'append_seq'`).run();
    observer.store.db.exec('DELETE FROM observer_events');
    const rewind = extractSignalBatch(port, { projectId: again.id, afterSeq: 9, streamEpoch: 2, limit: 50 });
    expect(rewind.outcome).toBe('SOURCE_RESET_REQUIRED');
    expect(rewind.resetReason).toBe('CURSOR_AHEAD_OF_STREAM');
    const missing = extractSignalBatch(port, {
      projectId: 'prj_ffffffffffffffff',
      afterSeq: 0,
      streamEpoch: 1,
      limit: 50,
    });
    expect(missing.outcome).toBe('EVIDENCE_UNAVAILABLE');
    expect(missing.reasonCode).toBe('PROJECT_NOT_FOUND');
  });

  it('does not invent snapshot facts when the referenced snapshot is missing', async () => {
    observer = await makeObserver();
    const root = await createGitRepo(dir, 'snap');
    const project = await observer.registerProject(root);
    const inner = new InProcessObserverReadPort(observer);
    const port = {
      inspectSource: inner.inspectSource.bind(inner),
      readForward: inner.readForward.bind(inner),
      legacyOrderReconstructed: inner.legacyOrderReconstructed.bind(inner),
      getSnapshot: () => null,
    };
    const batch = extractSignalBatch(port, { projectId: project.id, afterSeq: 0, streamEpoch: 1, limit: 50 });
    expect(batch.outcome).toBe('EVIDENCE_UNAVAILABLE');
    expect(batch.reasonCode).toBe('SNAPSHOT_MISSING');
    expect(batch.proposedCursor.afterSeq).toBe(0);
  });

  it('emits JUnit failure signals per relativePath without claiming HEAD', async () => {
    observer = await makeObserver();
    const root = await createGitRepo(dir, 'junit', {
      files: {
        'README.md': '# t\n',
        'reports/a.xml': SAMPLE_JUNIT_PASS,
        'reports/b.xml': SAMPLE_JUNIT_PASS,
      },
    });
    const project = await observer.registerProject(root, {
      reports: [
        { format: 'junit-xml', relativePath: 'reports/a.xml' },
        { format: 'junit-xml', relativePath: 'reports/b.xml' },
      ],
    });
    await writeFile(path.join(root, 'reports/b.xml'), SAMPLE_JUNIT_FAIL);
    now = new Date('2026-10-28T08:02:00.000Z');
    await observer.scanProject(project.id, 'manual');
    const batch = extractSignalBatch(new InProcessObserverReadPort(observer), {
      projectId: project.id,
      afterSeq: 0,
      streamEpoch: 1,
      limit: 200,
    });
    const testSignals = batch.signals.filter((item) => item.kind.startsWith('TEST_REPORT_'));
    expect(testSignals.length).toBeGreaterThan(0);
    expect(testSignals.every((item) => item.headBinding === 'UNDETERMINED')).toBe(true);
    expect(testSignals.every((item) => (item.subject ?? '').startsWith('reportSource:'))).toBe(true);
    expect(testSignals.some((item) => item.kind === 'TEST_EVIDENCE_NOT_CURRENT')).toBe(false);
  });

  it('extracts adapter errors and keeps UNKNOWN quality', async () => {
    observer = await makeObserver();
    const root = await createGitRepo(dir, 'bad', {
      files: { 'README.md': '# t\n', 'reports/junit.xml': SAMPLE_JUNIT_BAD },
    });
    const project = await observer.registerProject(root, {
      reports: [{ format: 'junit-xml', relativePath: 'reports/junit.xml' }],
    });
    const batch = extractSignalBatch(new InProcessObserverReadPort(observer), {
      projectId: project.id,
      afterSeq: 0,
      streamEpoch: 1,
      limit: 200,
    });
    const adapter = batch.signals.filter((item) => item.kind === 'ADAPTER_ERROR_OBSERVED');
    expect(adapter.length).toBeGreaterThan(0);
    expect(adapter[0]?.evidenceQuality).toBe('UNKNOWN');
    expect(adapter[0]?.subject).toBe('reportSource:reports/junit.xml');
  });
});

describe('S1.1 legacy reconstructed order flag', () => {
  it('surfaces reconstructed order on migrated v2 rows', async () => {
    const legacyDir = await mkdtemp(path.join(tmpdir(), 'hearth-s11-legacy-'));
    const dbPath = path.join(legacyDir, 'observer.sqlite');
    const v2 = openObserverDatabase(dbPath, { untilVersion: 2 });
    const occurredAt = '2026-10-28T08:00:00.000Z';
    const projectId = 'prj_aaaaaaaaaaaaaaaa';
    const runId = 'run_aaaaaaaaaaaaaaaa';
    const snapId = 'snap_aaaaaaaaaaaaaaaa';
    const worktree = JSON.stringify({
      clean: true,
      conflicted: false,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      renamed: 0,
      unmerged: 0,
    });
    const test = JSON.stringify({
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
       VALUES (?, ?, ?, ?, 'ok', 'manual', NULL, NULL)`,
    ).run(runId, projectId, occurredAt, occurredAt);
    v2.prepare(
      `INSERT INTO observer_snapshots
       (id, project_id, observed_at, fingerprint, head_sha, branch, detached, unborn, worktree_json, test_json, accessibility, git_identity)
       VALUES (?, ?, ?, 'seedfingerprint000', NULL, 'main', 0, 0, ?, ?, 'OK', NULL)`,
    ).run(snapId, projectId, occurredAt, worktree, test);
    v2.prepare(
      `INSERT INTO observer_events
       (id, project_id, run_id, type, before_snapshot_id, after_snapshot_id, occurred_at, payload_json, evidence_json)
       VALUES (?, ?, ?, 'OBSERVATION_GAP', NULL, ?, ?, '{"gapMs":10}', ?)`,
    ).run(
      'evt_aaaaaaaaaaaaaaaa',
      projectId,
      runId,
      snapId,
      occurredAt,
      JSON.stringify({ source: 'system', observationRunId: runId, quality: 'OBSERVED' }),
    );
    v2.exec('COMMIT');
    v2.close();
    const legacyObserver = new ProjectObserver({ dbPath, watchEnabled: false });
    const port = new InProcessObserverReadPort(legacyObserver);
    expect(port.legacyOrderReconstructed()).toBe(true);
    const batch = extractSignalBatch(port, { projectId, afterSeq: 0, streamEpoch: 1, limit: 50 });
    expect(batch.legacyOrderReconstructed).toBe(true);
    expect(batch.signals[0]?.facts['orderUncertainty']).toBe('reconstructed_rowid');
    await legacyObserver.stop();
    legacyObserver.close();
    await rm(legacyDir, { recursive: true, force: true });
  });
});
