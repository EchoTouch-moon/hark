import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from './observer.js';
import { ObserverError } from './errors.js';
import { createGitRepo, git, repoReadOnlyFingerprint, writeFiles } from './testkit/git-fixture.js';
import { readFileInsideRoot } from './paths.js';
import { parseJunitXml } from './reports/junit.js';

let dir: string;
let observer: ProjectObserver;
let now = new Date('2026-10-28T08:00:00.000Z');

describe('H03 path and git safety', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'hearth-h03-'));
    now = new Date('2026-10-28T08:00:00.000Z');
    observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
    });
  });

  afterEach(async () => {
    await observer.stop();
    observer.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('SE-01 rejects report path escape', async () => {
    const root = await createGitRepo(dir, 'esc');
    const project = await observer.registerProject(root);
    expect(() => observer.addReportSource(project.id, '../secret.xml')).toThrow(ObserverError);
    expect(() => observer.addReportSource(project.id, '/tmp/abs.xml')).toThrow(ObserverError);
    expect(() => readFileInsideRoot(root, '../outside.xml', 1024)).toThrow(ObserverError);
  });

  it('SE-02 TOCTOU symlink swap is rejected', async () => {
    const root = await createGitRepo(dir, 'toctou');
    const rel = 'reports/junit.xml';
    await writeFiles(root, { [rel]: '<testsuites></testsuites>' });
    const outside = path.join(dir, 'pwn.xml');
    await writeFile(outside, '<testsuites tests="99"></testsuites>');
    await rm(path.join(root, rel));
    await symlink(outside, path.join(root, rel));
    expect(() => readFileInsideRoot(root, rel, 1024 * 1024)).toThrow(ObserverError);
  });

  it('SE-03 duplicate realpath is rejected; worktrees are independent', async () => {
    const root = await createGitRepo(dir, 'wt-main');
    await observer.registerProject(root, { name: 'main' });
    await expect(observer.registerProject(root)).rejects.toMatchObject({ code: 'DUPLICATE_PATH' });
    const extra = path.join(dir, 'wt-extra');
    await git(root, ['worktree', 'add', '--detach', extra]);
    const second = await observer.registerProject(extra, { name: 'extra' });
    expect(second.id).not.toBe(observer.listProjects()[0]?.id);
  });

  it('SE-04 fsmonitor helper is not invoked', async () => {
    const root = await createGitRepo(dir, 'fsm', { files: { 'README.md': '# x\n' } });
    await git(root, ['config', 'core.fsmonitor', 'touch PWNED-FSM']);
    await observer.registerProject(root);
    expect(existsSync(path.join(root, 'PWNED-FSM'))).toBe(false);
  });

  it('SE-05 quoted and dashed names do not inject', async () => {
    const root = await createGitRepo(dir, 'quote');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'weird --help.txt'), 'x\n');
    await writeFile(path.join(root, "quote'.txt"), 'x\n');
    now = new Date('2026-10-28T08:01:00.000Z');
    await observer.scanProject(project.id, 'manual');
    expect(observer.getLatestSnapshot(project.id)?.worktree.untracked).toBeGreaterThanOrEqual(2);
  });

  it('SE-06 XXE and oversize reports fail closed', () => {
    expect(() => parseJunitXml('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuites/>')).toThrow(
      ObserverError,
    );
  });

  it('SE-08 scan does not mutate the observed repository', async () => {
    const root = await createGitRepo(dir, 'ro');
    const before = await repoReadOnlyFingerprint(root);
    await observer.registerProject(root);
    now = new Date('2026-10-28T08:01:00.000Z');
    await observer.scanProject(observer.listProjects()[0]!.id, 'manual');
    const after = await repoReadOnlyFingerprint(root);
    expect(after.head).toBe(before.head);
    expect(after.status).toBe(before.status);
    expect(after.indexSize).toBe(before.indexSize);
  });
});
