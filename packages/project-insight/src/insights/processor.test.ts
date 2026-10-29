import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EXTRACTOR_VERSION } from '../contracts.js';
import { InsightError } from '../errors.js';
import { INSIGHT_MIGRATIONS, migrateInsight, openInsightDatabase } from '../store/schema.js';
import { InsightStore } from '../store/store.js';
import { makeSignal, testChangedSignal, testFailSignal } from './fixtures.js';
import { acknowledgeEpisode, dismissEpisode, processProjectRules } from './processor.js';
import type { Signal } from '../contracts.js';

let dir: string;
let store: InsightStore;
const NOW = new Date('2026-10-28T10:00:00.000Z');

function seed(projectId: string, signals: Signal[], revision = 0): void {
  const afterSeq = Math.max(...signals.map((item) => item.appendSeq ?? 0), 0);
  store.commitSignalBatch({
    projectId,
    streamEpoch: 1,
    expectedRevision: revision,
    batch: {
      signals,
      proposedCursor: { afterSeq, streamEpoch: 1 },
      highWatermark: afterSeq,
      outcome: signals.length > 0 ? 'OK' : 'NO_SIGNAL',
      hasMore: false,
      legacyOrderReconstructed: false,
      extractorVersion: EXTRACTOR_VERSION,
      eventsRead: signals.length,
    },
  });
}

describe('S2.3 processor TX/EP persist', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'hearth-s2-'));
    store = new InsightStore(path.join(dir, 'insights.sqlite'), { clock: () => NOW, skipWriterLock: true });
  });
  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('TX-01/TX-02 injected faults roll back episodes and progress', () => {
    const projectId = 'prj_aaaaaaaaaaaaaaaa';
    seed(projectId, [testFailSignal()]);
    for (const fault of ['after-episodes', 'after-progress', 'before-commit'] as const) {
      expect(() => processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none', fault })).toThrow(
        InsightError,
      );
      expect(store.countEpisodes(projectId)).toBe(0);
    }
    const ok = processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    expect(ok.episodesOpened).toBe(1);
  });

  it('TX-03 commit then reopen does not duplicate cards', () => {
    const projectId = 'prj_aaaaaaaaaaaaaaaa';
    seed(projectId, [testFailSignal()]);
    processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    const dbPath = store.dbPath;
    store.close();
    store = new InsightStore(dbPath, { clock: () => NOW, skipWriterLock: true });
    const again = processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    expect(again.written).toBe(false);
    expect(store.countEpisodes(projectId)).toBe(1);
  });

  it('TX-06 empty inbox writes nothing', () => {
    const projectId = 'prj_aaaaaaaaaaaaaaaa';
    const first = processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    expect(first.written).toBe(false);
    for (let i = 0; i < 1000; i += 1) {
      expect(processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' }).written).toBe(false);
    }
    const pages = store.db.prepare(`SELECT COUNT(*) AS n FROM insight_rule_progress`).get() as { n: number };
    expect(Number(pages.n)).toBe(0);
  });

  it('TX-07 git noise advances the rule cursor with zero insights', () => {
    const projectId = 'prj_aaaaaaaaaaaaaaaa';
    seed(projectId, [
      makeSignal({ kind: 'REPOSITORY_HEAD_CHANGED', signalKey: 'a'.repeat(64), subject: 'git:head', appendSeq: 4 }),
    ]);
    const result = processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    expect(result.written).toBe(true);
    expect(result.episodesOpened).toBe(0);
    expect(store.countEpisodes(projectId)).toBe(0);
    expect(result.lastAppendSeq).toBe(4);
  });

  it('TX-08 frozen consumer checkpoint freezes rules', () => {
    const projectId = 'prj_aaaaaaaaaaaaaaaa';
    seed(projectId, [testFailSignal()]);
    store.freezeCheckpoint(projectId, 1);
    const result = processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    expect(result.outcome).toBe('FROZEN');
    expect(store.countEpisodes(projectId)).toBe(0);
  });

  it('TX-10 missing trigger does not create a card', () => {
    const projectId = 'prj_aaaaaaaaaaaaaaaa';
    const signal = testFailSignal();
    signal.evidenceRefs = [];
    seed(projectId, [signal]);
    processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    expect(store.countEpisodes(projectId)).toBe(0);
  });

  it('TX-11 existing-inbox baseline does not open live cards', () => {
    const projectId = 'prj_aaaaaaaaaaaaaaaa';
    seed(projectId, [testFailSignal()]);
    const result = processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'existing-inbox' });
    expect(result.episodesOpened).toBe(0);
    expect(result.written).toBe(true);
    expect(store.countEpisodes(projectId)).toBe(0);
  });

  it('TX-04 second writer is locked', () => {
    const lockedPath = path.join(dir, 'locked.sqlite');
    const first = new InsightStore(lockedPath);
    expect(() => new InsightStore(lockedPath)).toThrow(InsightError);
    first.close();
  });

  it('TX-05 a faulted project does not block another', () => {
    const a = 'prj_aaaaaaaaaaaaaaaa';
    const b = 'prj_bbbbbbbbbbbbbbbb';
    seed(a, [testFailSignal()]);
    seed(b, [
      makeSignal({
        kind: 'TEST_REPORT_FAILURE_OBSERVED',
        projectId: b,
        signalKey: 'q'.repeat(64),
        subject: 'reportSource:reports/junit.xml',
        sourceEventIds: ['evt_bbbbbbbbbbbbbbbb'],
        facts: { relativePath: 'reports/junit.xml', failed: 2, errors: 0, headBound: false },
        evidenceRefs: [{ kind: 'observer_event', projectId: b, id: 'evt_bbbbbbbbbbbbbbbb', observedAt: '2026-10-28T10:00:00.000Z', quality: 'OBSERVED', role: 'trigger' }],
      }),
    ]);
    expect(() => processProjectRules(store, { projectId: a, streamEpoch: 1, baseline: 'none', fault: 'after-episodes' })).toThrow(
      InsightError,
    );
    const other = processProjectRules(store, { projectId: b, streamEpoch: 1, baseline: 'none' });
    expect(other.episodesOpened).toBe(1);
    expect(store.countEpisodes(a)).toBe(0);
  });

  it('TX-12 purgeProject removes episodes', () => {
    const projectId = 'prj_aaaaaaaaaaaaaaaa';
    seed(projectId, [testFailSignal()]);
    processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    expect(store.countEpisodes(projectId)).toBe(1);
    store.purgeProject(projectId);
    expect(store.countEpisodes(projectId)).toBe(0);
    expect(store.countSignals(projectId)).toBe(0);
  });

  it('EP persist: replay and dismiss hold', () => {
    const projectId = 'prj_aaaaaaaaaaaaaaaa';
    const first = testFailSignal();
    seed(projectId, [first]);
    const opened = processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    expect(opened.episodesOpened).toBe(1);
    const row = store.db.prepare('SELECT episode_key AS k, insight_id AS id FROM insight_episodes').get() as {
      k: string;
      id: string;
    };
    processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    expect(store.countEpisodes(projectId)).toBe(1);
    dismissEpisode(store, row.k);
    seed(
      projectId,
      [makeSignal({ ...first, signalKey: 'z'.repeat(64), appendSeq: 9, sourceEventIds: ['evt_bbbbbbbbbbbbbbbb'] })],
      1,
    );
    processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    expect(store.countEpisodes(projectId)).toBe(1);
    const status = store.db.prepare('SELECT status AS s FROM insight_episodes').get() as { s: string };
    expect(status.s).toBe('DISMISSED');
    acknowledgeEpisode(store, row.k);
    expect(status.s).toBe('DISMISSED');
  });

  it('EP-03 persist recovery then recurrence', () => {
    const projectId = 'prj_aaaaaaaaaaaaaaaa';
    seed(projectId, [testFailSignal()]);
    processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    seed(projectId, [testChangedSignal({ previousFailed: 2, currentFailed: 0, appendSeq: 5, signalKey: 'r'.repeat(64) })], 1);
    const recovered = processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    expect(recovered.episodesResolved).toBe(1);
    seed(
      projectId,
      [
        makeSignal({
          ...testFailSignal(),
          signalKey: 'n'.repeat(64),
          appendSeq: 6,
          sourceEventIds: ['evt_nnnnnnnnnnnnnnnn'],
          evidenceRefs: [
            {
              kind: 'observer_event',
              projectId,
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
    const again = processProjectRules(store, { projectId, streamEpoch: 1, baseline: 'none' });
    expect(again.episodesOpened).toBe(1);
    expect(store.countEpisodes(projectId)).toBe(2);
  });
});

describe('S2 schema TX-09', () => {
  it('failed v2 migration leaves v1 usable', async () => {
    const dirLocal = await mkdtemp(path.join(tmpdir(), 'hearth-s2-mig-'));
    const dbPath = path.join(dirLocal, 'insights.sqlite');
    const db = openInsightDatabase(dbPath, { untilVersion: 1 });
    expect(() =>
      migrateInsight(db, {
        migrations: [
          ...INSIGHT_MIGRATIONS.filter((item) => item.version <= 1),
          {
            version: 2,
            name: 'boom',
            up: () => {
              throw new Error('boom');
            },
          },
        ],
      }),
    ).toThrow(InsightError);
    const version = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(version.v).toBe(1);
    const inbox = db.prepare(`SELECT name FROM sqlite_master WHERE name='signal_inbox'`).get();
    expect(inbox).toBeDefined();
    const episodes = db.prepare(`SELECT name FROM sqlite_master WHERE name='insight_episodes'`).get();
    expect(episodes).toBeUndefined();
    db.close();
    await rm(dirLocal, { recursive: true, force: true });
  });
});
