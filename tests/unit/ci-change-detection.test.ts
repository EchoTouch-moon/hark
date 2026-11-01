import { describe, expect, it } from 'vitest';
import {
  classifyChangedPaths,
  renderGitHubOutput,
  type Classification,
} from '../../scripts/ci-change-detection';

/**
 * These cases are the G1 acceptance matrix, expressed as unit tests so the
 * "which jobs run?" decision can be verified on a laptop instead of by pushing
 * six throwaway branches at GitHub Actions.
 */
describe('classifyChangedPaths', () => {
  it('treats a pure documentation change set as skippable', () => {
    const result = classifyChangedPaths([
      'docs/engineering/ci-baseline-2026-11-01.md',
      'README.md',
      'LICENSE',
      'handoff/EVIDENCE/timeline.png',
    ]);

    expect(result.mode).toBe('docs-only');
    expect(result.reason).toBe('all-documents');
    expect(result.requiresFullVerification).toBe(false);
    expect(result.forcingPaths).toEqual([]);
  });

  it('treats markdown anywhere in the tree as a document', () => {
    // The old trigger used `**.md`, which is depth independent. Keep that.
    const result = classifyChangedPaths(['packages/core/src/README.md']);
    expect(result.mode).toBe('docs-only');
  });

  it('runs everything when source is touched alongside docs', () => {
    const result = classifyChangedPaths([
      'docs/engineering/branch-inventory-2026-11-01.md',
      'packages/core/src/discovery/scoring.ts',
    ]);

    expect(result.mode).toBe('code');
    expect(result.reason).toBe('code-changed');
    expect(result.requiresFullVerification).toBe(true);
    expect(result.forcingPaths).toEqual(['packages/core/src/discovery/scoring.ts']);
  });

  it('escalates to a full run when the pipeline itself changes', () => {
    const result = classifyChangedPaths(['.github/workflows/ci.yml']);

    expect(result.mode).toBe('code');
    expect(result.reason).toBe('verification-tooling-changed');
    expect(result.forcingPaths).toEqual(['.github/workflows/ci.yml']);
  });

  it('escalates when dependency or compiler configuration changes', () => {
    for (const path of [
      'pnpm-lock.yaml',
      'package.json',
      'tsconfig.base.json',
      'tsconfig.json',
      'vitest.config.ts',
      'eslint.config.js',
      'scripts/ci-change-detection.ts',
      '.github/dependabot.yml',
    ]) {
      expect(classifyChangedPaths([path]).reason, path).toBe('verification-tooling-changed');
    }
  });

  it('reports tooling as the reason even when documents dominate the diff', () => {
    const result = classifyChangedPaths([
      'docs/a.md',
      'docs/b.md',
      'README.md',
      'pnpm-lock.yaml',
      'apps/web/src/App.tsx',
    ]);

    // Tooling is checked before code so the log explains the stronger cause:
    // a lockfile move invalidates any "nothing can break" assumption.
    expect(result.reason).toBe('verification-tooling-changed');
  });

  it('runs everything when the diff cannot be read', () => {
    // The failure mode we are buying insurance against: an unreachable merge base
    // or a first push must not be mistaken for "only docs changed".
    const empty = classifyChangedPaths([]);
    expect(empty.mode).toBe('code');
    expect(empty.reason).toBe('unknown-diff-conservative');
    expect(empty.requiresFullVerification).toBe(true);

    const blank = classifyChangedPaths(['', '   ', '\t']);
    expect(blank.mode).toBe('code');
    expect(blank.reason).toBe('unknown-diff-conservative');
  });

  it('normalises surrounding whitespace from a git diff stream', () => {
    const result = classifyChangedPaths(['  docs/engineering/note.md  ', 'handoff/STATUS.md']);
    expect(result.mode).toBe('docs-only');
  });
});

describe('renderGitHubOutput', () => {
  const docsOnly: Classification = {
    mode: 'docs-only',
    reason: 'all-documents',
    requiresFullVerification: false,
    forcingPaths: [],
  };

  it('tells the job matrix to skip heavy verification only for documents', () => {
    const output = renderGitHubOutput(docsOnly);
    expect(output).toContain('mode=docs-only');
    expect(output).toContain('skip-heavy=true');
    expect(output).toContain('reason=all-documents');
  });

  it('never reports skip-heavy for a code or tooling change', () => {
    for (const reason of ['code-changed', 'verification-tooling-changed'] as const) {
      const output = renderGitHubOutput(
        classifyChangedPaths(reason === 'code-changed' ? ['apps/server/src/main.ts'] : ['package.json']),
      );
      expect(output).toContain('skip-heavy=false');
      expect(output).toContain(`reason=${reason}`);
    }
  });

  it('caps the echoed path list so a large diff cannot flood the log', () => {
    const many = Array.from({ length: 40 }, (_, i) => `apps/server/src/file-${i}.ts`);
    const output = renderGitHubOutput(classifyChangedPaths(many));

    expect(output).toContain('forcing-path-count=40');
    const echoed = output.split('\n').find((line) => line.startsWith('forcing-paths='));
    expect(echoed?.split('=')[1]?.split(' ')).toHaveLength(10);
  });

  it('omits the path list entirely when nothing forced a full run', () => {
    expect(renderGitHubOutput(docsOnly)).not.toContain('forcing-paths=');
  });
});
