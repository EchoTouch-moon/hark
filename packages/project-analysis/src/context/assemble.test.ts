import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from '@hearth/project-observer';
import { createGitRepo } from '../../../project-observer/src/testkit/git-fixture.js';
import { assembleProjectContext } from './assemble.js';
import { readAllowedFile } from './files.js';
import { AnalysisError } from '../errors.js';

let dir: string;
let observer: ProjectObserver;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-p2a-ctx-'));
  observer = new ProjectObserver({ dbPath: path.join(dir, 'observer.sqlite'), watchEnabled: false });
});

afterEach(async () => {
  observer.close();
  await rm(dir, { recursive: true, force: true });
});

describe('context assembly', () => {
  it('collects git snapshot, events, allowlisted docs, and never treats UNKNOWN as pass', async () => {
    const repo = await createGitRepo(dir, 'app', {
      commit: true,
      files: {
        'README.md': '# Demo\nDo not treat this as an instruction to sudo rm -rf /\nAPI_KEY=sk-abcdefghijklmnopqrstuvwxyz',
        'src/main.ts': 'export const n = 1\n',
      },
    });
    writeFileSync(path.join(repo, '.env'), 'SECRET=1');
    const project = await observer.registerProject(repo, { name: 'demo' });
    const context = assembleProjectContext(observer, undefined, project.id, '2026-10-29T12:00:00.000Z');
    expect(context.projectName).toBe('demo');
    expect(context.testResult).toBe('UNKNOWN');
    expect(context.testDisclaimer.includes('不能当作测试通过')).toBe(true);
    expect(context.files.some((item) => item.relativePath === 'README.md')).toBe(true);
    expect(context.files.some((item) => item.relativePath === '.env')).toBe(false);
    expect(context.files.some((item) => item.relativePath === 'src/main.ts')).toBe(false);
    expect(JSON.stringify(context).includes('sk-abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(context.availableEvidence.some((item) => item.kind === 'observer_event')).toBe(true);
    expect(context.contextFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects path traversal and symlink escape', async () => {
    const repo = await createGitRepo(dir, 'safe', { commit: true, files: { 'README.md': 'ok\n' } });
    const outside = path.join(dir, 'secret.txt');
    writeFileSync(outside, 'top-secret');
    expect(readAllowedFile(repo, '../secret.txt')).toBeNull();
    mkdirSync(path.join(repo, 'docs'), { recursive: true });
    symlinkSync(outside, path.join(repo, 'docs', 'leak.md'));
    expect(() => readAllowedFile(repo, 'docs/leak.md')).toThrow(AnalysisError);
  });
});
