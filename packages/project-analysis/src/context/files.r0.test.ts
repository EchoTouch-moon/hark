import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const hooks = vi.hoisted(() => ({ afterOpen: undefined as (() => void) | undefined, reads: [] as number[] }));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      const fd = fs.openSync(...args);
      hooks.afterOpen?.();
      return fd;
    },
    readSync: (...args: [number, Buffer, number, number, number]) => {
      hooks.reads.push(args[3]);
      return fs.readSync(...args);
    },
  };
});
import { MAX_FILE_BYTES, listCandidateRelativePaths, readAllowedFile } from './files.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'hearth-r0-file-')); hooks.reads = []; });
afterEach(() => { hooks.afterOpen = undefined; rmSync(dir, { recursive: true, force: true }); });

describe('R0 bounded context files', () => {
  it('reads only the fixed prefix of a sparse 100MB document', () => {
    const file = path.join(dir, 'README.md');
    const fd = openSync(file, 'w');
    ftruncateSync(fd, 100 * 1024 * 1024);
    closeSync(fd);
    const result = readAllowedFile(dir, 'README.md');
    expect(result).toMatchObject({ bytes: 100 * 1024 * 1024, truncated: true });
    expect(hooks.reads.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_FILE_BYTES);
    expect(result?.excerpt.length).toBeLessThanOrEqual(MAX_FILE_BYTES);
  });

  it('refuses a file replaced after opening before any content read', () => {
    const file = path.join(dir, 'README.md');
    writeFileSync(file, 'before');
    hooks.afterOpen = () => {
      hooks.afterOpen = undefined;
      rmSync(file);
      writeFileSync(file, 'replacement');
    };
    expect(() => readAllowedFile(dir, 'README.md')).toThrow(/changed|path/i);
    expect(hooks.reads).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe('replacement');
  });

  it('does not traverse a symlinked docs directory', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'hearth-r0-outside-'));
    try {
      writeFileSync(path.join(outside, 'private.md'), 'do not read');
      symlinkSync(outside, path.join(dir, 'docs'));
      expect(listCandidateRelativePaths(dir)).not.toContain('docs/private.md');
      expect(() => readAllowedFile(dir, 'docs/private.md')).toThrow(/path|symbolic/i);
      expect(hooks.reads).toEqual([]);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it('rejects final symlinks and relative traversal', () => {
    mkdirSync(path.join(dir, 'docs'));
    writeFileSync(path.join(dir, 'README.md'), 'safe');
    symlinkSync('../README.md', path.join(dir, 'docs/link.md'));
    expect(() => readAllowedFile(dir, 'docs/link.md')).toThrow();
    expect(readAllowedFile(dir, '../outside.md')).toBeNull();
  });
});
