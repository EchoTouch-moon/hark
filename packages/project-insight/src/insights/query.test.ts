import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EXTRACTOR_VERSION, type Signal } from '../contracts.js';
import { InsightError } from '../errors.js';
import { migrateInsight, openInsightDatabase } from '../store/schema.js';
import { InsightStore } from '../store/store.js';
import { makeSignal, testChangedSignal, testFailSignal } from './fixtures.js';
import { processProjectRules } from './processor.js';
import { applyAcknowledge, applyDismiss, applyFeedback } from './actions.js';
import { getInsight, listInsights, summarizeInsights } from './query.js';

let dir: string;
let store: InsightStore;
const PROJECT = 'prj_aaaaaaaaaaaaaaaa';
const PROJECT_B = 'prj_bbbbbbbbbbbbbbbb';
const PROJECT_C = 'prj_cccccccccccccccc';

function seed(projectId: string, signals: Signal[], revision = 0, streamEpoch = 1): void {
  const afterSeq = Math.max(...signals.map((item) => item.appendSeq ?? 0), 0);
  store.commitSignalBatch({
    projectId,
    streamEpoch,
    expectedRevision: revision,
    batch: {
      signals,
      proposedCursor: { afterSeq, streamEpoch },
      highWatermark: afterSeq,
      outcome: signals.length > 0 ? 'OK' : 'NO_SIGNAL',
      hasMore: false,
      legacyOrderReconstructed: false,
      extractorVersion: EXTRACTOR_VERSION,
      eventsRead: signals.length,
    },
  });
}

function failSignal(projectId: string, eventId: string, signalKey: string): Signal {
  return makeSignal({
    ...testFailSignal(),
    projectId,
    signalKey,
    sourceEventIds: [eventId],
    evidenceRefs: [
      {
        kind: 'observer_event',
        projectId,
        id: eventId,
        observedAt: '2026-10-28T10:00:00.000Z',
        quality: 'OBSERVED',
        role: 'trigger',
      },
    ],
  });
}

function snapshotCounts(): { episodes: number; progress: number; feedback: number; inbox: number; evidence: number } {
  const one = (sql: string): number => Number((store.db.prepare(sql).get() as { n: number }).n);
  return {
    episodes: one('SELECT COUNT(*) AS n FROM insight_episodes'),
    progress: one('SELECT COUNT(*) AS n FROM insight_rule_progress'),
    feedback: one('SELECT COUNT(*) AS n FROM insight_feedback'),
    inbox: one('SELECT COUNT(*) AS n FROM signal_inbox'),
    evidence: one('SELECT COUNT(*) AS n FROM insight_evidence_refs'),
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'insight-s3-'));
  store = new InsightStore(path.join(dir, 'insights.sqlite'), { skipWriterLock: true });
  seed(PROJECT, [testFailSignal()]);
  processProjectRules(store, { projectId: PROJECT, streamEpoch: 1, baseline: 'none' });
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('insight query and feedback', () => {
  it('hides dismissed items from the default feed after refresh', () => {
    const first = listInsights(store, {});
    expect(first.items).toHaveLength(1);
    applyDismiss(store, first.items[0]!.id);
    const again = listInsights(store, {});
    expect(again.items).toEqual([]);
    const all = listInsights(store, { statuses: ['DISMISSED'] });
    expect(all.items).toHaveLength(1);
    expect(all.items[0]?.status).toBe('DISMISSED');
  });

  it('keeps useful feedback without changing status', () => {
    const id = listInsights(store, {}).items[0]!.id;
    applyAcknowledge(store, id);
    applyFeedback(store, id, 'useful');
    applyFeedback(store, id, 'useful');
    const detail = getInsight(store, id);
    expect(detail?.status).toBe('ACKNOWLEDGED');
    expect(detail?.feedback).toBe('useful');
    expect(detail?.observeHref).toBe(`/observe/${PROJECT}`);
    expect(detail?.reasonCodes).toEqual(['junit_failures_gt_0']);
    expect(summarizeInsights(store).openCount).toBe(1);
  });

  it('does not write on list, detail, or summary reads', () => {
    const before = snapshotCounts();
    const updated = store.db.prepare('SELECT updated_at AS t FROM insight_episodes').get() as { t: string };
    listInsights(store, {});
    getInsight(store, listInsights(store, {}).items[0]!.id);
    summarizeInsights(store);
    expect(snapshotCounts()).toEqual(before);
    const after = store.db.prepare('SELECT updated_at AS t FROM insight_episodes').get() as { t: string };
    expect(after.t).toBe(updated.t);
  });

  it('returns unique insight ids and stable cursor pages', () => {
    seed(PROJECT_B, [failSignal(PROJECT_B, 'evt_bbbbbbbbbbbbbbbb', '1'.repeat(64))]);
    seed(PROJECT_C, [failSignal(PROJECT_C, 'evt_cccccccccccccccc', '2'.repeat(64))]);
    processProjectRules(store, { projectId: PROJECT_B, streamEpoch: 1, baseline: 'none' });
    processProjectRules(store, { projectId: PROJECT_C, streamEpoch: 1, baseline: 'none' });
    const all = listInsights(store, { limit: 50 });
    const ids = all.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
    const first = listInsights(store, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTypeOf('string');
    const second = listInsights(store, { limit: 1, cursor: first.nextCursor ?? undefined });
    const third = listInsights(store, { limit: 1, cursor: second.nextCursor ?? undefined });
    expect([first.items[0]!.id, second.items[0]!.id, third.items[0]!.id]).toEqual(ids);
    expect(third.nextCursor).toBeNull();
    const replay = listInsights(store, { limit: 1, cursor: first.nextCursor ?? undefined });
    expect(replay.items[0]!.id).toBe(second.items[0]!.id);
  });

  it('marks missing and unavailable evidence without pretending it is live', () => {
    const id = listInsights(store, {}).items[0]!.id;
    expect(getInsight(store, id)?.evidenceAvailability).toBe('AVAILABLE');
    store.db.prepare('DELETE FROM signal_inbox').run();
    expect(getInsight(store, id)?.evidenceAvailability).toBe('MISSING');
    store.recordInterruption({
      projectId: PROJECT,
      streamEpoch: 1,
      interruptionType: 'PROJECT_REMOVED',
      lastSafeCursor: 0,
    });
    expect(getInsight(store, id)?.evidenceAvailability).toBe('UNAVAILABLE');
    expect(getInsight(store, id)?.evidence.length).toBeGreaterThan(0);
  });

  it('keeps evidence rows after dismiss and persists feedback across reopen', () => {
    const id = listInsights(store, {}).items[0]!.id;
    const evidenceBefore = snapshotCounts().evidence;
    const inboxBefore = snapshotCounts().inbox;
    applyDismiss(store, id);
    expect(snapshotCounts().evidence).toBe(evidenceBefore);
    expect(snapshotCounts().inbox).toBe(inboxBefore);
    applyFeedback(store, id, 'not_useful');
    const dbPath = store.dbPath;
    store.close();
    store = new InsightStore(dbPath, { skipWriterLock: true });
    const detail = getInsight(store, id);
    expect(detail?.status).toBe('DISMISSED');
    expect(detail?.feedback).toBe('not_useful');
    expect(listInsights(store, {}).items).toEqual([]);
  });

  it('opens a new episode after resolve without inheriting dismiss or feedback', () => {
    const firstId = listInsights(store, {}).items[0]!.id;
    applyFeedback(store, firstId, 'useful');
    seed(PROJECT, [testChangedSignal({ previousFailed: 2, currentFailed: 0, appendSeq: 5, signalKey: 'r'.repeat(64) })], 1);
    const recovered = processProjectRules(store, { projectId: PROJECT, streamEpoch: 1, baseline: 'none' });
    expect(recovered.episodesResolved).toBe(1);
    seed(
      PROJECT,
      [
        makeSignal({
          ...testFailSignal(),
          signalKey: 'n'.repeat(64),
          appendSeq: 6,
          sourceEventIds: ['evt_nnnnnnnnnnnnnnnn'],
          evidenceRefs: [
            {
              kind: 'observer_event',
              projectId: PROJECT,
              id: 'evt_nnnnnnnnnnnnnnnn',
              observedAt: '2026-10-28T10:00:00.000Z',
              quality: 'OBSERVED',
              role: 'trigger',
            },
          ],
        }),
      ],
      2,
    );
    processProjectRules(store, { projectId: PROJECT, streamEpoch: 1, baseline: 'none' });
    const open = listInsights(store, {});
    expect(open.items).toHaveLength(1);
    expect(open.items[0]?.id).not.toBe(firstId);
    expect(open.items[0]?.status).toBe('OPEN');
    expect(open.items[0]?.feedback).toBeNull();
    const resolved = listInsights(store, { statuses: ['RESOLVED'] });
    expect(resolved.items[0]?.id).toBe(firstId);
    expect(resolved.items[0]?.feedback).toBe('useful');
  });

  it('surfaces historical epoch boundaries', () => {
    const id = listInsights(store, {}).items[0]!.id;
    store.db.prepare('UPDATE insight_episodes SET historical = 1, stream_epoch = 2 WHERE insight_id = ?').run(id);
    const detail = getInsight(store, id);
    expect(detail?.historical).toBe(true);
    expect(detail?.streamEpoch).toBe(2);
  });

  it('rejects illegal feedback and malformed cursors', () => {
    const id = listInsights(store, {}).items[0]!.id;
    expect(() => applyFeedback(store, id, 'love-it' as never)).toThrow(InsightError);
    expect(() => listInsights(store, { cursor: 'not-a-cursor' })).toThrow(InsightError);
    expect(getInsight(store, 'ins_missingmissing1')).toBeNull();
  });

  it('purgeProject removes episodes, evidence, and feedback', () => {
    const id = listInsights(store, {}).items[0]!.id;
    applyFeedback(store, id, 'useful');
    store.purgeProject(PROJECT);
    expect(snapshotCounts()).toEqual({ episodes: 0, progress: 0, feedback: 0, inbox: 0, evidence: 0 });
    expect(getInsight(store, id)).toBeNull();
  });
});

describe('insight schema v3', () => {
  it('migrates v2 databases to the feedback table', async () => {
    const local = await mkdtemp(path.join(tmpdir(), 'insight-s3-mig-'));
    const dbPath = path.join(local, 'insights.sqlite');
    const db = openInsightDatabase(dbPath, { untilVersion: 2 });
    const before = db.prepare(`SELECT name FROM sqlite_master WHERE name='insight_feedback'`).get();
    expect(before).toBeUndefined();
    const result = migrateInsight(db);
    expect(result.currentVersion).toBe(3);
    const table = db.prepare(`SELECT name FROM sqlite_master WHERE name='insight_feedback'`).get();
    expect(table).toBeDefined();
    db.close();
    await rm(local, { recursive: true, force: true });
  });
});
