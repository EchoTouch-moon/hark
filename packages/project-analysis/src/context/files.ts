import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AnalysisError } from '../errors.js';
import { isSensitiveRelativePath, redactSecrets, stripControlChars } from './redact.js';
import type { FileExcerpt } from '../contracts.js';

function isInsideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 8_192;
export const MAX_TOTAL_BYTES = 32_768;

const ROOT_DOCS = [
  'README.md',
  'README',
  'AGENTS.md',
  'CLAUDE.md',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
];

export function listCandidateRelativePaths(root: string): string[] {
  const out: string[] = [];
  for (const name of ROOT_DOCS) {
    if (existsSync(path.join(root, name))) out.push(name);
  }
  const docsDir = path.join(root, 'docs');
  if (existsSync(docsDir) && !lstatSync(docsDir).isSymbolicLink() && lstatSync(docsDir).isDirectory()
      && isInsideRoot(realpathSync.native(root), realpathSync.native(docsDir))) {
    const names = listMarkdown(docsDir, 'docs', 4);
    out.push(...names);
  }
  return out.slice(0, MAX_FILES);
}

function listMarkdown(absDir: string, relDir: string, remaining: number): string[] {
  if (remaining <= 0) return [];
  const names = readdirSync(absDir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('.'))
    .sort()
    .slice(0, remaining);
  return names.map((name) => path.posix.join(relDir.replaceAll('\\', '/'), name));
}

export function readAllowedFile(root: string, relativePath: string): FileExcerpt | null {
  if (relativePath.includes('\0') || path.isAbsolute(relativePath) || isSensitiveRelativePath(relativePath)) {
    return null;
  }
  const lexical = path.resolve(root, relativePath);
  if (!isInsideRoot(root, lexical) || !existsSync(lexical)) return null;
  const canonicalRoot = realpathSync.native(root);
  // Reject links in every path component, not only the leaf. The opened fd is
  // checked against the current canonical path before and after bounded reads.
  let current = canonicalRoot;
  for (const component of path.relative(root, lexical).split(path.sep)) {
    current = path.join(current, component);
    if (lstatSync(current).isSymbolicLink()) {
      throw new AnalysisError('PATH_ESCAPE', `symbolic context path rejected: ${relativePath}`);
    }
  }
  let fd: number;
  try {
    fd = openSync(lexical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (cause) {
    throw new AnalysisError('PATH_ESCAPE', `unable to open context path: ${relativePath}`, { cause });
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) return null;
    const validateOpenedPath = () => {
      const real = realpathSync.native(lexical);
      if (!isInsideRoot(canonicalRoot, real)) {
        throw new AnalysisError('PATH_ESCAPE', `file escapes project root: ${relativePath}`);
      }
      const atPath = statSync(real);
      if (atPath.dev !== opened.dev || atPath.ino !== opened.ino || lstatSync(lexical).isSymbolicLink()) {
        throw new AnalysisError('PATH_ESCAPE', `context path changed during read: ${relativePath}`);
      }
    };
    validateOpenedPath();
    const raw = Buffer.alloc(Math.min(opened.size, MAX_FILE_BYTES));
    let offset = 0;
    while (offset < raw.length) {
      const count = readSync(fd, raw, offset, raw.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    validateOpenedPath();
    const after = fstatSync(fd);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new AnalysisError('PATH_ESCAPE', `context file changed during read: ${relativePath}`);
    }
    const prefix = raw.subarray(0, offset);
    const excerpt = redactSecrets(stripControlChars(prefix.toString('utf8')));
    return {
      relativePath: relativePath.replaceAll('\\', '/'),
      // This is the hash of the captured prefix, not an unbounded whole-file hash.
      sha256: createHash('sha256').update(prefix).digest('hex'),
      bytes: opened.size,
      excerpt,
      truncated: opened.size > prefix.length,
    };
  } catch (cause) {
    if (cause instanceof AnalysisError) throw cause;
    throw new AnalysisError('PATH_ESCAPE', `context path unavailable during read: ${relativePath}`, { cause });
  } finally {
    closeSync(fd);
  }
}

export function collectProjectFiles(root: string, excludedPaths: string[] = []): FileExcerpt[] {
  const files: FileExcerpt[] = [];
  let total = 0;
  for (const relative of listCandidateRelativePaths(root)) {
    if (excludedPaths.some(excluded => relative === excluded || relative.startsWith(excluded.replace(/\/$/, '') + '/'))) continue;
    const item = readAllowedFile(root, relative);
    if (item === null) continue;
    if (total + Math.min(item.bytes, MAX_FILE_BYTES) > MAX_TOTAL_BYTES) break;
    files.push(item);
    total += Math.min(item.bytes, MAX_FILE_BYTES);
    if (files.length >= MAX_FILES) break;
  }
  return files;
}
