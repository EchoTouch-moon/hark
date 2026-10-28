import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from './observer.js';
import { ObserverError } from './errors.js';
import { SAMPLE_JUNIT_BAD, createGitRepo, git } from './testkit/git-fixture.js';

let dir: string;
let observer: ProjectObserver;
let now = new Date('2026-10-28T08:00:00.000Z');

describe('H01 idempotency', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'hearth-h01-'));
    now = new Date('2026-10-28T08:00:00.000Z');
    observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
      gapThresholdMs: 60_000,
    });
  });

  afterEach(async () => {
    await observer.stop();
    observer.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('ID-01 100 identical scans add no change events', async () => {
    const root = await createGitRepo(dir, 'stable');
    const project = await observer.registerProject(root);
    const before = observer.store.countEvents(project.id);
    const fingerprint = observer.getLatestSnapshot(project.id)?.fingerprint;
    for (let i = 0; i < 100; i += 1) {
      now = new Date(Date.parse('2026-10-28T08:00:00.000Z') + i * 1000);
      await observer.scanProject(project.id, 'manual');
    }
    expect(observer.store.countEvents(project.id)).toBe(before);
    expect(observer.getLatestSnapshot(project.id)?.fingerprint).toBe(fingerprint);
    expect(observer.getObserverHealth(project.id).currentRevision).toBeGreaterThan(0);
  });

  it('ID-02 A→B→A keeps two real transitions', async () => {
    const root = await createGitRepo(dir, 'toggle');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'x.txt'), 'b\n');
    now = new Date('2026-10-28T08:01:00.000Z');
    await observer.scanProject(project.id, 'manual');
    await rm(path.join(root, 'x.txt'));
    now = new Date('2026-10-28T08:02:00.000Z');
    await observer.scanProject(project.id, 'manual');
    expect(observer.store.countEvents(project.id, ['WORKTREE_STATE_CHANGED'])).toBe(2);
  });

  it('ID-03 concurrent watch/api/timer requests share one in-flight scan', async () => {
    const root = await createGitRepo(dir, 'conc');
    const project = await observer.registerProject(root);
    const before = observer.scanStats().scanCount;
    await Promise.all([
      ...Array.from({ length: 20 }, () => observer.scanProject(project.id, 'watch')),
      ...Array.from({ length: 20 }, () => observer.scanProject(project.id, 'manual')),
      ...Array.from({ length: 20 }, () => observer.scanProject(project.id, 'reconcile')),
    ]);
    expect(observer.scanStats().maxActiveScans).toBe(1);
    expect(observer.scanStats().scanCount - before).toBeLessThanOrEqual(2);
    expect(observer.store.countEvents(project.id, ['WORKTREE_STATE_CHANGED'])).toBe(0);
  });

  it('ID-04 retry after successful commit does not duplicate events', async () => {
    const root = await createGitRepo(dir, 'retry');
    const project = await observer.registerProject(root);
    const before = observer.store.countEvents(project.id);
    const snap = observer.getLatestSnapshot(project.id)?.id;
    await observer.scanProject(project.id, 'manual');
    await observer.scanProject(project.id, 'manual');
    expect(observer.store.countEvents(project.id)).toBe(before);
    expect(observer.getLatestSnapshot(project.id)?.id).toBe(snap);
  });

  it('ID-05 second writer on the same DB is rejected', async () => {
    const dbPath = path.join(dir, 'observer.sqlite');
    expect(() => new ProjectObserver({ dbPath, watchEnabled: false })).toThrow(ObserverError);
  });

  it('ID-06 rename plus chinese/space/newline paths parse via real git', async () => {
    const root = await createGitRepo(dir, 'names');
    const project = await observer.registerProject(root);
    await git(root, ['mv', 'README.md', '中文 空格.md']);
    await writeFile(path.join(root, 'line1\nline2.txt'), 'nl\n');
    now = new Date('2026-10-28T08:01:00.000Z');
    await observer.scanProject(project.id, 'manual');
    const snap = observer.getLatestSnapshot(project.id);
    expect(snap?.worktree.renamed).toBeGreaterThanOrEqual(1);
    expect(snap?.worktree.untracked).toBeGreaterThanOrEqual(1);
  });

  it('ID-07 repeated identical adapter faults do not flood the timeline', async () => {
    const root = await createGitRepo(dir, 'bad-report', {
      files: { 'README.md': '# t\n', 'reports/junit.xml': SAMPLE_JUNIT_BAD },
    });
    const project = await observer.registerProject(root, {
      reports: [{ format: 'junit-xml', relativePath: 'reports/junit.xml' }],
    });
    const before = observer.store.countEvents(project.id, ['ADAPTER_ERROR']);
    for (let i = 0; i < 20; i += 1) {
      now = new Date(Date.parse('2026-10-28T08:01:00.000Z') + i * 1000);
      await observer.scanProject(project.id, 'manual');
    }
    expect(observer.store.countEvents(project.id, ['ADAPTER_ERROR'])).toBe(before);
  });
});
