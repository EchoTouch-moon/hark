import { emptyWorktree, type WorktreeSummary } from '../contracts.js';

export interface ParsedBranch {
  oid: string | null;
  head: string | null;
  detached: boolean;
  unborn: boolean;
}

export interface ParsedStatus {
  branch: ParsedBranch;
  worktree: WorktreeSummary;
  /** Parsed paths, used only in tests. Never persisted. */
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
 * Parse `git status --porcelain=v2 -z --branch`.
 * Records are NUL-terminated; pathnames are not split on spaces.
 * Rename records separate the new path and origPath with an extra NUL.
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
