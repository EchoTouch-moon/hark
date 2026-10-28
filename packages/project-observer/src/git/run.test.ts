import { describe, expect, it } from 'vitest';
import { ObserverError } from '../errors.js';
import { assertAllowedGitArgs } from './run.js';

describe('git allowlist', () => {
  it('allows porcelain status and rejects mutating commands', () => {
    expect(() =>
      assertAllowedGitArgs(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--ignore-submodules=all']),
    ).not.toThrow();
    expect(() => assertAllowedGitArgs(['fetch'])).toThrow(ObserverError);
    expect(() => assertAllowedGitArgs(['pull'])).toThrow(ObserverError);
    expect(() => assertAllowedGitArgs(['commit', '-m', 'x'])).toThrow(ObserverError);
    expect(() => assertAllowedGitArgs(['status', '--porcelain=v1'])).toThrow(ObserverError);
  });
});
