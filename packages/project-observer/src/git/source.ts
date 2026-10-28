import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { emptyWorktree, type Accessibility, type WorktreeSummary } from '../contracts.js';
import { ObserverError } from '../errors.js';
import { redactText } from '../redact.js';
import { parsePorcelainV2 } from './porcelain.js';
import { createGitRunner, type GitRunner } from './run.js';

export interface GitScanResult {
  quality: 'OBSERVED' | 'UNKNOWN';
  accessibility: Accessibility;
  errorCode?: string;
  errorMessage?: string;
  headSha: string | null;
  branch: string | null;
  detached: boolean;
  unborn: boolean;
  gitIdentity: string | null;
  worktree: WorktreeSummary;
  /** Test-only parsed paths. */
  paths: string[];
}

export class GitSource {
  private readonly runner: GitRunner;
  private readonly timeoutMs: number;
  scanCount = 0;
  activeScans = 0;
  maxActiveScans = 0;

  constructor(options: { runner?: GitRunner; timeoutMs?: number } = {}) {
    this.runner = options.runner ?? createGitRunner();
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async scan(canonicalPath: string): Promise<GitScanResult> {
    this.scanCount += 1;
    this.activeScans += 1;
    this.maxActiveScans = Math.max(this.maxActiveScans, this.activeScans);
    try {
      return await this.scanInner(canonicalPath);
    } finally {
      this.activeScans -= 1;
    }
  }

  private async scanInner(canonicalPath: string): Promise<GitScanResult> {
    if (!existsSync(canonicalPath)) {
      return unavailable('PATH_NOT_FOUND', 'repository path does not exist');
    }
    try {
      const inside = await this.runner(['rev-parse', '--is-inside-work-tree'], {
        cwd: canonicalPath,
        timeoutMs: this.timeoutMs,
      });
      if (inside.code !== 0 || inside.stdout.toString('utf8').trim() !== 'true') {
        return unavailable('NOT_A_GIT_REPO', redactText(inside.stderr || 'not a git work tree'));
      }

      const status = await this.runner(
        ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--ignore-submodules=all'],
        { cwd: canonicalPath, timeoutMs: this.timeoutMs },
      );
      if (status.code !== 0) {
        return unavailable('GIT_STATUS_FAILED', redactText(status.stderr || `git status exited ${status.code}`));
      }
      const parsed = parsePorcelainV2(status.stdout);

      const common = await this.runner(['rev-parse', '--git-common-dir'], {
        cwd: canonicalPath,
        timeoutMs: this.timeoutMs,
      });
      let gitIdentity: string | null = null;
      if (common.code === 0) {
        const raw = common.stdout.toString('utf8').trim();
        const abs = path.resolve(canonicalPath, raw);
        gitIdentity = existsSync(abs) ? realpathSync.native(abs) : abs;
      }

      return {
        quality: 'OBSERVED',
        accessibility: 'OK',
        headSha: parsed.branch.oid,
        branch: parsed.branch.head,
        detached: parsed.branch.detached,
        unborn: parsed.branch.unborn,
        gitIdentity,
        worktree: parsed.worktree,
        paths: parsed.paths,
      };
    } catch (cause) {
      if (cause instanceof ObserverError && (cause.code === 'SCAN_TIMEOUT' || cause.code === 'GIT_TIMEOUT')) {
        return unavailable('GIT_TIMEOUT', cause.message);
      }
      if (cause instanceof ObserverError && cause.code === 'OUTPUT_LIMIT') {
        return unavailable('OUTPUT_LIMIT', cause.message);
      }
      const message = cause instanceof Error ? cause.message : String(cause);
      return unavailable('GIT_ERROR', redactText(message));
    }
  }

  async isFastForward(canonicalPath: string, previousSha: string, currentSha: string): Promise<boolean | null> {
    try {
      const result = await this.runner(['merge-base', '--is-ancestor', previousSha, currentSha], {
        cwd: canonicalPath,
        timeoutMs: this.timeoutMs,
      });
      if (result.code === 0) return true;
      if (result.code === 1) return false;
      return null;
    } catch {
      return null;
    }
  }
}

function unavailable(errorCode: string, errorMessage: string): GitScanResult {
  return {
    quality: 'UNKNOWN',
    accessibility: 'UNAVAILABLE',
    errorCode,
    errorMessage,
    headSha: null,
    branch: null,
    detached: false,
    unborn: false,
    gitIdentity: null,
    worktree: emptyWorktree(),
    paths: [],
  };
}
