/**
 * @fileoverview 产物路径沙箱遏制与安全校验（Artifact Path Containment）
 * 严格防范目录遍历（Path Traversal）、绝对路径越界及符号链接（Symlink）逃逸。
 * 确保所有生成的文件产物均被局限在专用沙箱目录（.hearth-demo-artifacts）之内。
 */

import path from 'node:path';

/** 产物路径解析结果 */
export type ArtifactPathResult =
  | { ok: true; absPath: string; relPath: string }
  | { ok: false; code: 'PATH_ABSOLUTE' | 'PATH_TRAVERSAL' | 'PATH_EMPTY'; reason: string };

/**
 * 纯逻辑路径遏制校验
 * 在未访问真实文件系统前，快速拦截空路径、绝对路径以及包含 `..` 的跨级跳跃
 * @param demoRoot 允许写入的 demo-artifacts 根目录绝对路径
 * @param relPath 声明的产物相对路径
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
  // Resolve the root first: a caller may pass a rooted-but-unqualified root
  // (e.g. "/tmp/..." on Windows). Comparing that literal against an absolute
  // `absPath` collapses to a false traversal denial for every legal path.
  const rootAbs = path.resolve(demoRoot);
  const absPath = path.resolve(rootAbs, normalized);
  const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  if (absPath !== rootAbs && !absPath.startsWith(rootWithSep)) {
    return { ok: false, code: 'PATH_TRAVERSAL', reason: 'resolved path outside demo root' };
  }
  // Contracts, evidence records and API payloads speak POSIX separators on every
  // platform; only `absPath` is allowed to carry native separators.
  const posixRelPath = normalized.split(path.sep).join('/');
  return { ok: true, absPath, relPath: posixRelPath };
}

/**
 * 文件系统级别深层防逃逸检查（安全守卫 S03）
 * 向上探测目标路径上已存在的最近祖先目录，并调用 realpath 解析其真实物理路径，
 * 验证解析后的真实路径是否依然严格处于 realpath(demoRoot) 之下。
 * 可在文件实际被创建前有效阻止通过预埋符号链接逃逸到沙箱外的攻击。
 * 
 * @param absPath 待写入目标的绝对路径
 * @param demoRoot 沙箱根目录
 * @param fsRealpath realpath 异步方法
 * @param fsStat stat 异步方法
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
