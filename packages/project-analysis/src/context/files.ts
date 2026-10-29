import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
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
  if (existsSync(docsDir) && statSync(docsDir).isDirectory()) {
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
  let real: string;
  try {
    real = realpathSync.native(lexical);
  } catch {
    throw new AnalysisError('PATH_ESCAPE', `unable to resolve ${relativePath}`);
  }
  if (!isInsideRoot(root, real)) {
    throw new AnalysisError('PATH_ESCAPE', `file escapes project root: ${relativePath}`);
  }
  const stat = statSync(real);
  if (!stat.isFile()) return null;
  const raw = readFileSync(real);
  const truncated = raw.byteLength > MAX_FILE_BYTES;
  const slice = raw.subarray(0, MAX_FILE_BYTES);
  const excerpt = redactSecrets(stripControlChars(slice.toString('utf8')));
  return {
    relativePath: relativePath.replaceAll('\\', '/'),
    sha256: createHash('sha256').update(raw).digest('hex'),
    bytes: raw.byteLength,
    excerpt,
    truncated,
  };
}

export function collectProjectFiles(root: string): FileExcerpt[] {
  const files: FileExcerpt[] = [];
  let total = 0;
  for (const relative of listCandidateRelativePaths(root)) {
    const item = readAllowedFile(root, relative);
    if (item === null) continue;
    if (total + Math.min(item.bytes, MAX_FILE_BYTES) > MAX_TOTAL_BYTES) break;
    files.push(item);
    total += Math.min(item.bytes, MAX_FILE_BYTES);
    if (files.length >= MAX_FILES) break;
  }
  return files;
}
