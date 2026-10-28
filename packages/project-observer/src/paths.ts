import { closeSync, existsSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { ObserverError } from './errors.js';

export function isInsideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function canonicalizeProjectPath(input: string): string {
  if (input.trim() === '') {
    throw new ObserverError('INVALID_PATH', 'path is empty');
  }
  const resolved = path.resolve(input);
  if (!existsSync(resolved)) {
    throw new ObserverError('PATH_NOT_FOUND', `path does not exist: ${resolved}`);
  }
  let real: string;
  try {
    real = realpathSync.native(resolved);
  } catch (cause) {
    throw new ObserverError('INVALID_PATH', `unable to resolve path: ${resolved}`, { cause });
  }
  let stat;
  try {
    stat = statSync(real);
  } catch (cause) {
    throw new ObserverError('PATH_NOT_FOUND', `unable to stat path: ${real}`, { cause });
  }
  if (!stat.isDirectory()) {
    throw new ObserverError('INVALID_PATH', `path is not a directory: ${real}`);
  }
  return real;
}

export function resolveInsideRoot(root: string, relativePath: string): string {
  if (relativePath.trim() === '' || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new ObserverError('INVALID_PATH', 'report path must be a relative path inside the repository');
  }
  const lexical = path.resolve(root, relativePath);
  if (!isInsideRoot(root, lexical)) {
    throw new ObserverError('SYMLINK_ESCAPE', 'report path escapes the repository root');
  }
  if (!existsSync(lexical)) {
    return lexical;
  }
  let real: string;
  try {
    real = realpathSync.native(lexical);
  } catch (cause) {
    throw new ObserverError('SYMLINK_ESCAPE', 'unable to resolve report path', { cause });
  }
  if (!isInsideRoot(root, real)) {
    throw new ObserverError('SYMLINK_ESCAPE', 'report path resolves outside the repository root');
  }
  return real;
}

export function toPosixRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

/**
 * Open a repo-relative file and verify the opened inode still resolves inside root.
 * Rejects `../`, absolute paths, and TOCTOU symlink swaps.
 */
export function readFileInsideRoot(
  root: string,
  relativePath: string,
  maxBytes: number,
): { bytes: Buffer; mtime: Date; realPath: string } {
  const lexical = resolveInsideRoot(root, relativePath);
  if (!existsSync(lexical)) {
    throw new ObserverError('PATH_NOT_FOUND', 'report file does not exist');
  }
  const fd = openSync(lexical, 'r');
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) {
      throw new ObserverError('REPORT_UNREADABLE', 'report path is not a file');
    }
    if (opened.size > maxBytes) {
      throw new ObserverError('REPORT_TOO_LARGE', `report exceeds ${maxBytes} bytes`);
    }
    let real: string;
    try {
      real = realpathSync.native(lexical);
    } catch (cause) {
      throw new ObserverError('SYMLINK_ESCAPE', 'unable to resolve opened report path', { cause });
    }
    if (!isInsideRoot(root, real)) {
      throw new ObserverError('SYMLINK_ESCAPE', 'report path resolves outside the repository root');
    }
    const realStat = statSync(real);
    if (realStat.ino !== opened.ino || realStat.dev !== opened.dev) {
      throw new ObserverError('SYMLINK_ESCAPE', 'report path changed during open');
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < opened.size) {
      const n = readSync(fd, bytes, offset, opened.size - offset, offset);
      if (n <= 0) break;
      offset += n;
    }
    return { bytes, mtime: opened.mtime, realPath: real };
  } finally {
    closeSync(fd);
  }
}
