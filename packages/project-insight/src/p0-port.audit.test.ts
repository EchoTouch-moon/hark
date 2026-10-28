import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EvidenceQualitySchema, ProjectObserver } from '@hearth/project-observer';
import { SAMPLE_JUNIT_PASS, createGitRepo } from '../../project-observer/src/testkit/git-fixture.js';
import { P0_EVIDENCE_QUALITY } from './contracts.js';
import { P0_CAPABILITIES } from './observer-port.js';

let dir: string;
let observer: ProjectObserver;
const NOW = new Date('2026-10-28T08:00:00.000Z');

describe('P0 capability audit (S0 facts, not P1 engine)', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'insight-s0-'));
    observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => NOW,
      watchEnabled: false,
    });
  });

  afterEach(async () => {
    await observer.stop();
    observer.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('schema is v2 and has no append_seq; public listEvents is reverse-time', async () => {
    const version = observer.store.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(version.v).toBe(P0_CAPABILITIES.schemaVersion);
    const cols = observer.store.db.prepare('PRAGMA table_info(observer_events)').all() as Array<{ name: string }>;
    expect(cols.map((col) => col.name)).not.toContain('append_seq');
    expect(P0_CAPABILITIES.appendSeqColumn).toBe(false);
    expect(P0_CAPABILITIES.listEventsForward).toBe(false);
    expect(typeof (observer as { listEventsForward?: unknown }).listEventsForward).toBe('undefined');

    const root = await createGitRepo(dir, 'seq');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'a.txt'), '1\n');
    await observer.scanProject(project.id, 'manual');
    const page = observer.listEvents(project.id, { limit: 50 });
    expect(page).not.toHaveProperty('hasMore');
    const times = page.events.map((event) => event.observedAt);
    const sortedDesc = [...times].sort((a, b) => b.localeCompare(a));
    expect(times).toEqual(sortedDesc);
  });

  it('event ids are random, not monotonic; sqlite rowid still increases', async () => {
    const root = await createGitRepo(dir, 'ids');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'b.txt'), '1\n');
    await observer.scanProject(project.id, 'manual');
    const rows = observer.store.db
      .prepare('SELECT id, rowid AS seq FROM observer_events WHERE project_id = ? ORDER BY rowid ASC')
      .all(project.id) as Array<{ id: string; seq: number }>;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]!.id.startsWith('evt_')).toBe(true);
    expect(rows[0]!.id).not.toBe(rows[1]!.id);
    expect(rows[0]!.seq).toBeLessThan(rows[1]!.seq);
  });

  it('snapshots are addressable on the store, not on the observer facade', async () => {
    const root = await createGitRepo(dir, 'snap');
    const project = await observer.registerProject(root);
    const latest = observer.getLatestSnapshot(project.id);
    expect(latest).not.toBeNull();
    expect(latest?.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(observer.store.getSnapshot(latest!.id)?.id).toBe(latest!.id);
    expect('getSnapshot' in observer).toBe(false);
  });

  it('JUnit summary has relativePath and fingerprint, never HEAD SHA or reportSourceId', async () => {
    const root = await createGitRepo(dir, 'junit', {
      files: { 'README.md': '# t\n', 'reports/junit.xml': SAMPLE_JUNIT_PASS },
    });
    const project = await observer.registerProject(root, {
      reports: [{ format: 'junit-xml', relativePath: 'reports/junit.xml' }],
    });
    const sources = observer.listReportSources(project.id);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.id.startsWith('rpt_')).toBe(true);
    const test = observer.getLatestSnapshot(project.id)?.test;
    expect(test?.headBound).toBe(false);
    expect(test?.relativePath).toBe('reports/junit.xml');
    expect(test?.reportFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(test?.generatedAt).toBeDefined();
    expect(test && 'reportSourceId' in test).toBe(false);
    expect(Object.keys(test ?? {})).not.toContain('headSha');
    expect(EvidenceQualitySchema.options).toEqual([...P0_EVIDENCE_QUALITY]);
    expect(EvidenceQualitySchema.options).not.toContain('UNAVAILABLE');
  });

  it('survives restart without dropping events', async () => {
    const root = await createGitRepo(dir, 'persist');
    const project = await observer.registerProject(root);
    const dbPath = path.join(dir, 'observer.sqlite');
    const count = observer.store.countEvents(project.id);
    const snapId = observer.getLatestSnapshot(project.id)?.id;
    await observer.stop();
    observer.close();
    observer = new ProjectObserver({ dbPath, watchEnabled: false, clock: () => NOW });
    expect(observer.store.countEvents(project.id)).toBe(count);
    expect(observer.store.getSnapshot(snapId ?? '')?.id).toBe(snapId);
  });

  it('removeProject is the only event-delete path used in S0 inventory', () => {
    expect(P0_CAPABILITIES.eventDeleteExceptRemoveProject).toBe(false);
    expect(P0_CAPABILITIES.eventPushCallback).toBe(false);
    expect(P0_CAPABILITIES.junitHeadBoundAlwaysFalse).toBe(true);
    expect(P0_CAPABILITIES.httpSnapshotById).toBe(false);
    expect(P0_CAPABILITIES.p0EvidenceQualityHasUnavailable).toBe(false);
  });
});
