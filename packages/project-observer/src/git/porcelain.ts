/**
 * @fileoverview Git Porcelain V2 协议解析器
 * 
 * 解析 `git status --porcelain=v2 -z --branch` 输出：
 * - 记录以 NUL 字节（\0）分隔，路径名中的空格和特殊字符无需转义；
 * - 开头携带 `# branch.oid` 与 `# branch.head` 头部字段；
 * - 记录种类：
 *   - `?`：未跟踪文件（untracked）；
 *   - `1`：普通已跟踪文件修改（包含暂存区与工作区两处状态字符 XY）；
 *   - `2`：重命名或复制（包含目标路径与随后的原路径）；
 *   - `u`：未合并冲突条目（unmerged conflict）。
 */

import { emptyWorktree, type WorktreeSummary } from '../contracts.js';

/** Git 分支与 HEAD 解析状态 */
export interface ParsedBranch {
  /** HEAD 提交哈希（null 表示 unborn） */
  oid: string | null;
  /** 当前分支名（null 表示游离 HEAD 或 unborn） */
  head: string | null;
  /** 是否游离 HEAD */
  detached: boolean;
  /** 是否尚未创建任何提交（初始分支） */
  unborn: boolean;
}

/** 工作区与分支综合状态解析结果 */
export interface ParsedStatus {
  /** 分支与游离状态 */
  branch: ParsedBranch;
  /** 工作区变更聚合统计 */
  worktree: WorktreeSummary;
  /** 解析出的所有文件路径（测试断言用，不入库） */
  paths: string[];
}

function splitFields(record: string, prefixLength: number, fieldCountBeforePath: number): { meta: string[]; path: string } | null {
  if (!record.startsWith(record[0] === '1' || record[0] === '2' || record[0] === 'u' ? `${record[0]} ` : record.slice(0, 2))) {
    return null;
  }
  const body = record.slice(prefixLength);
  const meta: string[] = [];
  let rest = body;
  for (let i = 0; i < fieldCountBeforePath; i += 1) {
    const space = rest.indexOf(' ');
    if (space < 0) return null;
    meta.push(rest.slice(0, space));
    rest = rest.slice(space + 1);
  }
  return { meta, path: rest };
}

function parseHeader(line: string, branch: ParsedBranch): void {
  if (line.startsWith('# branch.oid ')) {
    const oid = line.slice('# branch.oid '.length).trim();
    if (oid === '(initial)') {
      branch.unborn = true;
      branch.oid = null;
    } else {
      branch.oid = oid === '' ? null : oid;
    }
    return;
  }
  if (line.startsWith('# branch.head ')) {
    const head = line.slice('# branch.head '.length).trim();
    if (head === '(detached)') {
      branch.detached = true;
      branch.head = null;
    } else {
      branch.head = head === '' ? null : head;
    }
  }
}

function consumeHeaders(chunk: string, branch: ParsedBranch): string {
  const lines = chunk.split('\n');
  const leftover: string[] = [];
  for (const line of lines) {
    if (line.startsWith('# ')) {
      parseHeader(line, branch);
    } else if (line.length > 0) {
      leftover.push(line);
    }
  }
  return leftover.join('\n');
}

/**
 * 解析 `git status --porcelain=v2 -z --branch` 的输出缓冲区
 * 
 * @param buffer Git status 命令的标准输出字节流
 * @returns 解析得到的完整工作区状态及分支元信息
 */
export function parsePorcelainV2(buffer: Buffer): ParsedStatus {
  const branch: ParsedBranch = { oid: null, head: null, detached: false, unborn: false };
  const worktree = emptyWorktree();
  const paths: string[] = [];
  const parts = buffer.length === 0 ? [] : buffer.toString('utf8').split('\0');

  let index = 0;
  while (index < parts.length) {
    const raw = parts[index] ?? '';
    index += 1;
    if (raw === '') continue;

    const maybeRecord = raw.startsWith('#') || raw.includes('\n#') ? consumeHeaders(raw, branch) : raw;
    if (maybeRecord === '' || maybeRecord.startsWith('#')) {
      if (maybeRecord.startsWith('# ')) parseHeader(maybeRecord, branch);
      continue;
    }

    const kind = maybeRecord[0];
    if (kind === '?' || kind === '!') {
      const filePath = maybeRecord.slice(2);
      if (kind === '?') {
        worktree.untracked += 1;
        paths.push(filePath);
      }
      continue;
    }

    if (kind === '1') {
      const parsed = splitFields(maybeRecord, 2, 7);
      if (parsed === null) continue;
      const xy = parsed.meta[0] ?? '..';
      countOrdinary(xy, worktree);
      paths.push(parsed.path);
      continue;
    }

    if (kind === 'u') {
      const parsed = splitFields(maybeRecord, 2, 9);
      if (parsed === null) continue;
      worktree.unmerged += 1;
      worktree.conflicted = true;
      paths.push(parsed.path);
      continue;
    }

    if (kind === '2') {
      const parsed = splitFields(maybeRecord, 2, 8);
      const origPath = parts[index] ?? '';
      index += 1;
      if (parsed === null) continue;
      const xy = parsed.meta[0] ?? '..';
      countOrdinary(xy, worktree);
      worktree.renamed += 1;
      paths.push(parsed.path);
      if (origPath !== '') paths.push(origPath);
    }
  }

  worktree.clean =
    worktree.staged === 0 &&
    worktree.unstaged === 0 &&
    worktree.untracked === 0 &&
    worktree.unmerged === 0 &&
    !worktree.conflicted;
  return { branch, worktree, paths };
}

function countOrdinary(xy: string, worktree: WorktreeSummary): void {
  const indexStatus = xy[0] ?? '.';
  const workTreeStatus = xy[1] ?? '.';
  if (indexStatus === 'U' || workTreeStatus === 'U' || xy.includes('U')) {
    worktree.unmerged += 1;
    worktree.conflicted = true;
  }
  if (indexStatus !== '.' && indexStatus !== ' ') {
    worktree.staged += 1;
  }
  if (workTreeStatus !== '.' && workTreeStatus !== ' ') {
    worktree.unstaged += 1;
  }
}
