import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { beginSyntheticRoot, posixDirAdapterAvailable } from '../src/fixture-discovery.js';
import { listDirectory, openChild, readOpened } from '../src/posix-dir-handle.js';
import { openDatabase } from '../src/storage.js';

const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
const now = new Date('2026-11-04T12:00:00Z');

describe.skipIf(!posixDirAdapterAvailable())('synthetic folder movement', () => {
  it('keeps access to the same authorized root if the root itself moves', () => {
    const db = openDatabase(':memory:'), root = beginSyntheticRoot();
    const outside = mkdtempSync(join(tmpdir(), 'hark-root-move-')); paths.push(root.setupPath, outside);
    writeFileSync(join(root.setupPath, 'project.txt'), 'SYNTHETIC_ROOT');
    const session = root.commit(db, now, 'never');
    if (session.status !== 'available') throw new Error('Synthetic root unavailable');
    try {
      renameSync(root.setupPath, join(outside, 'authorized'));
      const file = openChild(session.handle.rootDescriptor(), 'project.txt', false);
      if ('reason' in file) throw new Error('Authorized root should remain usable');
      // Returned metadata is not the adapter's internal identity record.
      (file.identity as { dev: string; ino: string }).ino = '0';
      const result = readOpened(file.fd, 128);
      expect('bytes' in result && result.bytes.toString()).toBe('SYNTHETIC_ROOT');
    } finally { session.handle.release(); db.close(); }
  });

  it('refuses a moved-out child and a file replaced after its directory leaves the root', () => {
    const db = openDatabase(':memory:'), root = beginSyntheticRoot();
    const outside = mkdtempSync(join(tmpdir(), 'hark-child-move-')); paths.push(root.setupPath, outside);
    mkdirSync(join(root.setupPath, 'project-a')); mkdirSync(join(root.setupPath, 'project-a', 'sub'));
    writeFileSync(join(root.setupPath, 'project-a', 'sub', 'data.txt'), 'SYNTHETIC_A');
    writeFileSync(join(outside, 'data-b.txt'), 'SYNTHETIC_B');
    const session = root.commit(db, now, 'never');
    if (session.status !== 'available') throw new Error('Synthetic root unavailable');
    try {
      const project = openChild(session.handle.rootDescriptor(), 'project-a', true);
      if ('reason' in project) throw new Error('Synthetic project unavailable');
      const sub = openChild(project.fd, 'sub', true);
      if ('reason' in sub) throw new Error('Synthetic child unavailable');
      const original = openChild(sub.fd, 'data.txt', false);
      if ('reason' in original) throw new Error('Synthetic file unavailable');
      renameSync(join(root.setupPath, 'project-a', 'sub'), join(outside, 'moved'));
      renameSync(join(outside, 'moved', 'data.txt'), join(outside, 'old-a.txt'));
      renameSync(join(outside, 'data-b.txt'), join(outside, 'moved', 'data.txt'));
      expect(listDirectory(sub.fd)).toHaveProperty('reason');
      expect(openChild(sub.fd, 'data.txt', false)).toHaveProperty('reason');
      expect(readOpened(original.fd, 128)).toHaveProperty('reason');
      expect(listDirectory(project.fd)).toHaveProperty('names');
    } finally { session.handle.release(); db.close(); }
  });

  it('does not return an already-opened file after it is replaced at the same name', () => {
    const db = openDatabase(':memory:'), root = beginSyntheticRoot(); paths.push(root.setupPath);
    writeFileSync(join(root.setupPath, 'data.txt'), 'SYNTHETIC_A');
    const session = root.commit(db, now, 'never');
    if (session.status !== 'available') throw new Error('Synthetic root unavailable');
    try {
      const original = openChild(session.handle.rootDescriptor(), 'data.txt', false);
      if ('reason' in original) throw new Error('Synthetic file unavailable');
      renameSync(join(root.setupPath, 'data.txt'), join(root.setupPath, 'old.txt'));
      writeFileSync(join(root.setupPath, 'data.txt'), 'SYNTHETIC_B');
      expect(readOpened(original.fd, 128)).toHaveProperty('reason');
      const replacement = openChild(session.handle.rootDescriptor(), 'data.txt', false);
      if ('reason' in replacement) throw new Error('Replacement inside root unavailable');
      const result = readOpened(replacement.fd, 128);
      expect('bytes' in result && result.bytes.toString()).toBe('SYNTHETIC_B');
    } finally { session.handle.release(); db.close(); }
  });

  it('rejects a FIFO without waiting for a writer', () => {
    const db = openDatabase(':memory:'), root = beginSyntheticRoot(); paths.push(root.setupPath);
    execFileSync('mkfifo', [join(root.setupPath, 'pipe')], { timeout: 2000 });
    const session = root.commit(db, now, 'never');
    if (session.status !== 'available') throw new Error('Synthetic root unavailable');
    try { expect(openChild(session.handle.rootDescriptor(), 'pipe', false)).toHaveProperty('reason'); }
    finally { session.handle.release(); db.close(); }
  });
});
