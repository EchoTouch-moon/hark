import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export type PathCheck = { kind: 'candidate'; canonicalPath: string } | { kind: 'rejected'; reason: string };

/**
 * Preflight only. This does not authorize opening a file: path components can be
 * replaced between these checks and an open. A future reader needs an OS-level
 * race-resistant boundary, fresh persisted authorization, and a security review.
 * The root is server-owned, never an untrusted client's scope assertion.
 */
export async function inspectPathCandidate(root: string, relativePath: string): Promise<PathCheck> {
  if (!path.isAbsolute(root) || typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\0') || relativePath.includes('\\') || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    return { kind: 'rejected', reason: 'invalid_path' };
  }
  const parts = relativePath.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..' || part.includes(':'))) return { kind: 'rejected', reason: 'invalid_path' };
  try {
    const rootInfo = await lstat(root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return { kind: 'rejected', reason: 'invalid_root' };
    const canonicalRoot = await realpath(root);
    let cursor = canonicalRoot;
    for (const part of parts) {
      cursor = path.join(cursor, part);
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink()) return { kind: 'rejected', reason: 'symlink' };
    }
    const canonicalPath = await realpath(cursor);
    const rel = path.relative(canonicalRoot, canonicalPath);
    if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return { kind: 'rejected', reason: 'outside_root' };
    return { kind: 'candidate', canonicalPath };
  } catch {
    // Do not expose underlying host paths or error details to callers.
    return { kind: 'rejected', reason: 'unavailable' };
  }
}
