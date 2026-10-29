import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from './observer.js';
import { ObserverError } from './errors.js';
import { createGitRunner } from './git/run.js';
import { createGitRepo } from './testkit/git-fixture.js';

let dir: string;

describe('H05 PF-03 resource limits', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'hearth-pf-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('GIT_TIMEOUT isolates the failing repo', async () => {
    const okRoot = await createGitRepo(dir, 'ok');
    const badRoot = await createGitRepo(dir, 'bad');
    const base = createGitRunner();
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      watchEnabled: false,
      gitRunner: async (args, options) => {
        if (options.cwd === badRoot) {
          throw new ObserverError('GIT_TIMEOUT', 'git timed out after 40ms');
        }
        return base(args, options);
      },
    });
    const ok = await observer.registerProject(okRoot);
    await expect(observer.registerProject(badRoot)).rejects.toMatchObject({ code: 'GIT_TIMEOUT' });
    expect(observer.getObserverHealth(ok.id).collectionStatus).toBe('OK');
    await observer.stop();
    observer.close();
  });

  it('OUTPUT_LIMIT is a controlled error', async () => {
    const root = await createGitRepo(dir, 'out');
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      watchEnabled: false,
      gitRunner: async (args, options) => createGitRunner()(args, { ...options, maxOutputBytes: 8 }),
    });
    await expect(observer.registerProject(root)).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
    await observer.stop();
    observer.close();
  });

  it('REPORT_TOO_LARGE does not claim PASS', async () => {
    const root = await createGitRepo(dir, 'rep');
    await mkdir(path.join(root, 'reports'), { recursive: true });
    await writeFile(path.join(root, 'reports/junit.xml'), 'z'.repeat(4096));
    const observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      watchEnabled: false,
      maxReportBytes: 128,
    });
    const project = await observer.registerProject(root, {
      reports: [{ format: 'junit-xml', relativePath: 'reports/junit.xml' }],
    });
    const snap = observer.getLatestSnapshot(project.id);
    expect(snap?.test.result).not.toBe('PASS');
    expect(observer.listEvents(project.id, { types: ['ADAPTER_ERROR'] }).events[0]?.evidence.errorCode).toBe(
      'REPORT_TOO_LARGE',
    );
    await observer.stop();
    observer.close();
  });
});
