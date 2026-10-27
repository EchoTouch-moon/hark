import path from 'node:path';

export type ArtifactPathResult =
  | { ok: true; absPath: string; relPath: string }
  | { ok: false; code: 'PATH_ABSOLUTE' | 'PATH_TRAVERSAL' | 'PATH_EMPTY'; reason: string };

/**
 * Pure containment logic for artifact paths under the dedicated demo root.
 * Rejects absolute paths and any `..` escape BEFORE normalization games.
 * Symlink escapes are caught separately by validateRealpathContainment (fs).
 */
export function resolveArtifactPath(demoRoot: string, relPath: string): ArtifactPathResult {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    return { ok: false, code: 'PATH_EMPTY', reason: 'artifact path empty' };
  }
  if (path.isAbsolute(relPath)) {
    return { ok: false, code: 'PATH_ABSOLUTE', reason: 'artifact path must be relative' };
  }
  const normalized = path.normalize(relPath);
  const segments = normalized.split(path.sep);
  if (segments.includes('..')) {
    return { ok: false, code: 'PATH_TRAVERSAL', reason: 'artifact path escapes demo root' };
  }
  const absPath = path.resolve(demoRoot, normalized);
  const rootWithSep = demoRoot.endsWith(path.sep) ? demoRoot : demoRoot + path.sep;
  if (absPath !== demoRoot && !absPath.startsWith(rootWithSep)) {
    return { ok: false, code: 'PATH_TRAVERSAL', reason: 'resolved path outside demo root' };
  }
  return { ok: true, absPath, relPath: normalized };
}

/**
 * FS-level guard (S03): realpath the deepest existing ancestor of the target
 * and require it to stay inside the realpath'd demo root. Catches symlinks
 * pointing outside the root even before the file exists.
 */
export async function validateRealpathContainment(
  absPath: string,
  demoRoot: string,
  fsRealpath: (p: string) => Promise<string>,
  fsStat: (p: string) => Promise<{ isDirectory(): boolean } | null>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let rootReal: string;
  let probe = absPath;
  let firstStatError: unknown = null;
  try {
    rootReal = await fsRealpath(demoRoot);
  } catch (err) {
    return { ok: false, reason: `demo root missing: ${String(err)}` };
  }
  for (;;) {
    try {
      const st = await fsStat(probe);
      if (st) {
        const real = await fsRealpath(probe);
        if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
          return { ok: false, reason: `symlink escape via ${probe}` };
        }
        return { ok: true };
      }
    } catch (err) {
      firstStatError = err;
    }
    const parent = path.dirname(probe);
    if (parent === probe) return { ok: false, reason: `cannot stat path: ${String(firstStatError)}` };
    probe = parent;
  }
}
