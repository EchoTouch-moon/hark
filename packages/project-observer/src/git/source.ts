/**
 * @fileoverview Git 本地数据源驱动
 * 
 * 职责：
 * 1. 验证目标路径是否属于合法的 Git 工作区（`rev-parse --is-inside-work-tree`）；
 * 2. 探查 Git 真实仓库唯一标识（`rev-parse --git-common-dir` + realpath），支持 worktree 识别；
 * 3. 使用 `status --porcelain=v2 -z` 零拷贝解析当前分支、HEAD OID、暂存区/工作区脏文件计数；
 * 4. 检测两个 Commit 是否为快进关系（`merge-base --is-ancestor`）；
 * 5. 严格脱敏错误信息并捕获超时与输出截断异常，返回健壮的 GitScanResult。
 */

import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { emptyWorktree, type Accessibility, type WorktreeSummary } from '../contracts.js';
import { ObserverError } from '../errors.js';
import { redactText } from '../redact.js';
import { parsePorcelainV2 } from './porcelain.js';
import { createGitRunner, type GitRunner } from './run.js';

/** Git 扫描返回的状态结果 */
export interface GitScanResult {
  /** 观察质量评级：OBSERVED（成功观察）或 UNKNOWN（无法采集） */
  quality: 'OBSERVED' | 'UNKNOWN';
  /** 可访问性状态：OK 或 UNAVAILABLE */
  accessibility: Accessibility;
  /** 错误码（不可访问时提供） */
  errorCode?: string;
  /** 脱敏后的错误摘要描述 */
  errorMessage?: string;
  /** 当前 HEAD 提交哈希（null 表示初始空仓 unborn） */
  headSha: string | null;
  /** 当前分支名（null 表示游离 HEAD 或 unborn） */
  branch: string | null;
  /** 是否处于游离 HEAD（detached）状态 */
  detached: boolean;
  /** 是否为空仓库初始状态（unborn，尚未有任何提交） */
  unborn: boolean;
  /** Git 共享通用目录绝对路径（用于多 worktree 识别真实仓库） */
  gitIdentity: string | null;
  /** 工作区变更统计（暂存、未暂存、未跟踪、冲突） */
  worktree: WorktreeSummary;
  /** 仅用于测试验证的路径列表（生产不持久化） */
  paths: string[];
}

/**
 * Git 探针与状态扫描数据源
 */
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

  /**
   * 扫描指定本地 Git 仓库的状态
   * 
   * @param canonicalPath 仓库绝对规范路径
   */
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

  /**
   * 判断两次提交是否为 fast-forward 关系（即 previousSha 是否为 currentSha 的祖先）
   */
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

/** 构造不可访问状态的统一返回值 */
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
