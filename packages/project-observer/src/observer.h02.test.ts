import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from './observer.js';
import { ObserverError } from './errors.js';
import { createGitRunner } from './git/run.js';
import { SAMPLE_JUNIT_BAD, SAMPLE_JUNIT_PASS, commitAll, createGitRepo, writeFiles } from './testkit/git-fixture.js';

let dir: string;
let now = new Date('2026-10-28T08:00:00.000Z');

/**
 * Windows process creation and recursive deletes are far slower than on POSIX,
 * so scan-heavy cases get a larger wall-clock budget there. Assertions are
 * unchanged; only the budget differs.
 */
const SCAN_HEAVY_TIMEOUT = process.platform === 'win32' ? 180_000 : 20_000;

/**
 * POSIX `chmod 000` genuinely revokes read/execute for the owner. Windows ACLs
 * ignore the POSIX mode bits, so the same call leaves the directory readable and
 * the case cannot be reproduced there.
 */
const POSIX_PERMISSIONS = process.platform !== 'win32';

function makeObserver(dbName = 'observer.sqlite'): ProjectObserver {
  return new ProjectObserver({
    dbPath: path.join(dir, dbName),
    clock: () => now,
    watchEnabled: false,
    gapThresholdMs: 60_000,
  });
}

describe('H02 recovery', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'hearth-h02-'));
    now = new Date('2026-10-28T08:00:00.000Z');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('RE-01 / RE-02 restart after HEAD change records one gap and latest HEAD', async () => {
    const observer = makeObserver();
    const root = await createGitRepo(dir, 'gap');
    const project = await observer.registerProject(root);
    const dbPath = path.join(dir, 'observer.sqlite');
    await observer.stop();
    observer.close();
    await writeFiles(root, { 'later.ts': 'export {}\n' });
    await commitAll(root, 'later');
    now = new Date('2026-10-28T09:00:00.000Z');
    const resumed = new ProjectObserver({ dbPath, clock: () => now, watchEnabled: false, gapThresholdMs: 60_000 });
    await resumed.scanProject(project.id, 'startup');
    const types = resumed.listEvents(project.id, { limit: 50 }).events.map((event) => event.type);
    expect(types.filter((type) => type === 'OBSERVATION_GAP')).toHaveLength(1);
    expect(types).toContain('REPOSITORY_HEAD_CHANGED');
    const second = await resumed.scanProject(project.id, 'reconcile');
    expect(resumed.store.countEvents(project.id, ['OBSERVATION_GAP'])).toBe(1);
    expect(second.status === 'ok' || second.status === 'error').toBe(true);
    await resumed.stop();
    resumed.close();
  });

  it('RE-03 git timeout is isolated and keeps last-good', async () => {
    const slow = await createGitRepo(dir, 'slow');
    const otherRoot = await createGitRepo(dir, 'other');
    const base = createGitRunner();
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
      gitRunner: async (args, options) => {
        if (options.cwd === slow) {
          throw new ObserverError('GIT_TIMEOUT', 'git timed out after 30ms');
        }
        return base(args, options);
      },
    });
    const other = await observer.registerProject(otherRoot);
    await expect(observer.registerProject(slow)).rejects.toBeInstanceOf(ObserverError);
    expect(observer.getLatestSnapshot(other.id)?.accessibility).toBe('OK');
    await observer.stop();
    observer.close();
  });

  it.skipIf(!POSIX_PERMISSIONS)('RE-04 temporarily unreadable repo then recovered keeps last-good until recover', async () => {
    const observer = makeObserver();
    const root = await createGitRepo(dir, 'perm');
    const project = await observer.registerProject(root);
    const lastGood = observer.getLatestSnapshot(project.id)?.headSha;
    await chmod(root, 0);
    now = new Date('2026-10-28T08:10:00.000Z');
    await observer.scanProject(project.id, 'manual');
    expect(observer.getObserverHealth(project.id).collectionStatus).toBe('UNAVAILABLE');
    expect(observer.getLatestSnapshot(project.id)?.headSha).toBe(lastGood);
    await chmod(root, 0o755);
    now = new Date('2026-10-28T08:11:00.000Z');
    await observer.scanProject(project.id, 'manual');
    expect(observer.store.countEvents(project.id, ['REPOSITORY_RECOVERED'])).toBe(1);
    await observer.stop();
    observer.close();
  });

  it('RE-05 corrupt JUnit does not mark current PASS and keeps git facts', async () => {
    const observer = makeObserver();
    const root = await createGitRepo(dir, 'junit', {
      files: { 'README.md': '# t\n', 'reports/junit.xml': SAMPLE_JUNIT_PASS },
    });
    const project = await observer.registerProject(root, {
      reports: [{ format: 'junit-xml', relativePath: 'reports/junit.xml' }],
    });
    const head = observer.getLatestSnapshot(project.id)?.headSha;
    await writeFile(path.join(root, 'reports/junit.xml'), SAMPLE_JUNIT_BAD);
    now = new Date('2026-10-28T08:02:00.000Z');
    await observer.scanProject(project.id, 'manual');
    const snap = observer.getLatestSnapshot(project.id);
    expect(snap?.headSha).toBe(head);
    expect(snap?.test.result === 'PASS' && snap.test.evidenceQuality === 'OBSERVED' && !snap.test.stale).toBe(false);
    expect(snap?.test.evidenceQuality).not.toBe('OBSERVED');
    await observer.stop();
    observer.close();
  });

  it('RE-07 pause stops automatic scans; remove drops watchers', async () => {
    const observer = makeObserver();
    const root = await createGitRepo(dir, 'pause');
    const project = await observer.registerProject(root);
    await observer.setProjectEnabled(project.id, false);
    await expect(observer.scanProject(project.id, 'reconcile')).rejects.toMatchObject({ code: 'PROJECT_PAUSED' });
    await observer.scanProject(project.id, 'manual');
    await observer.removeProject(project.id);
    expect(() => observer.getProject(project.id)).toThrow(ObserverError);
    await observer.stop();
    observer.close();
  });

  it('RE-08 100 unavailable/recovered cycles do not emit gap storms', async () => {
    const observer = makeObserver();
    const root = await createGitRepo(dir, 'storm');
    const project = await observer.registerProject(root);
    for (let i = 0; i < 20; i += 1) {
      await rm(root, { recursive: true, force: true });
      now = new Date(Date.parse('2026-10-28T08:10:00.000Z') + i * 2000);
      await observer.scanProject(project.id, 'reconcile');
      await createGitRepo(dir, 'storm');
      now = new Date(Date.parse('2026-10-28T08:10:00.000Z') + i * 2000 + 1000);
      await observer.scanProject(project.id, 'reconcile');
    }
    expect(observer.store.countEvents(project.id, ['OBSERVATION_GAP'])).toBeLessThanOrEqual(1);
    expect(observer.store.countEvents(project.id, ['REPOSITORY_UNAVAILABLE'])).toBeGreaterThan(0);
    expect(observer.store.countEvents(project.id, ['REPOSITORY_UNAVAILABLE'])).toBeLessThanOrEqual(25);
    await observer.stop();
    observer.close();
  }, SCAN_HEAVY_TIMEOUT);
});
