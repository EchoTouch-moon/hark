import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectPathCandidate } from '../src/path-check.js';

const created: string[] = [];
afterEach(() => { for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixtures() {
  const base = mkdtempSync(path.join(tmpdir(), 'hearth-path-'));
  created.push(base);
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  mkdirSync(root); mkdirSync(outside); mkdirSync(path.join(root, 'project'));
  writeFileSync(path.join(root, 'project', 'README.md'), 'synthetic');
  writeFileSync(path.join(outside, 'secret.txt'), 'synthetic outside');
  return { base, root, outside };
}

describe('path candidate preflight (not file-read authorization)', () => {
  it('recognizes an existing contained path in a synthetic root', async () => {
    const { root } = fixtures();
    expect((await inspectPathCandidate(root, 'project/README.md')).kind).toBe('candidate');
  });
  it('rejects traversal, absolute paths, ambiguous separators and missing paths', async () => {
    const { root, outside } = fixtures();
    for (const bad of ['../outside/secret.txt', 'project/../../outside/secret.txt', path.join(outside, 'secret.txt'), 'C:\\private\\file', '\\\\server\\share', 'project\\README.md', 'project//README.md', 'project/./README.md', 'missing', 'project/README.md\0']) {
      expect((await inspectPathCandidate(root, bad)).kind, bad).toBe('rejected');
    }
  });
  it('rejects a symlinked root or a descendant link to either inside or outside', async () => {
    const { base, root, outside } = fixtures();
    symlinkSync(root, path.join(base, 'root-link'), 'dir');
    symlinkSync(outside, path.join(root, 'escape'), 'dir');
    symlinkSync(path.join(root, 'project'), path.join(root, 'inside-link'), 'dir');
    expect((await inspectPathCandidate(path.join(base, 'root-link'), 'project/README.md')).kind).toBe('rejected');
    expect((await inspectPathCandidate(root, 'escape/secret.txt')).kind).toBe('rejected');
    expect((await inspectPathCandidate(root, 'inside-link/README.md')).kind).toBe('rejected');
  });
  it('fails closed for missing or non-directory roots', async () => {
    const { root } = fixtures();
    expect((await inspectPathCandidate(path.join(root, 'missing'), 'x')).kind).toBe('rejected');
    expect((await inspectPathCandidate(path.join(root, 'project', 'README.md'), 'x')).kind).toBe('rejected');
  });
});
