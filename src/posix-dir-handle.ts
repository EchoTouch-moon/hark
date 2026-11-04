import { createRequire } from 'node:module';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DirIdentity = { readonly dev: string; readonly ino: string };
export type OpenedDir = { readonly fd: number; readonly identity: DirIdentity; readonly nlink: number };
type NativeAddon = {
  available: boolean;
  openRoot(path: string): { fd: number; errno: number };
  openAt(dirfd: number, name: string, asDir: number): { fd: number; errno: number };
  fstat(fd: number): { ok: boolean; errno?: number; dev?: bigint; ino?: bigint; mode?: number; size?: bigint; nlink?: bigint };
  list(fd: number): { ok: boolean; names: string[]; errno?: number };
  read(fd: number, maxBytes: number): { ok: boolean; bytes?: Buffer; errno?: number };
  close(fd: number): number;
};

const NAME = /^[A-Za-z0-9._-]+$/;
const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const require = createRequire(import.meta.url);
const owned = new Set<number>();
let loaded: NativeAddon | null | undefined;

function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 5; index++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = join(dir, '..');
  }
  return process.cwd();
}

function adapterPath(): string | null {
  const root = realpathSync(packageRoot());
  const built = join(root, 'build', `hearth_posix_dir-${process.platform}-${process.arch}.node`);
  if (!existsSync(built)) return null;
  const info = lstatSync(built);
  if (info.isSymbolicLink() || !info.isFile()) return null;
  const resolved = realpathSync(built);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) return null;
  return resolved;
}

function loadAddon(): NativeAddon | null {
  if (process.platform === 'win32') return null;
  const path = adapterPath();
  if (!path) return null;
  const addon = require(path) as NativeAddon;
  return addon.available ? addon : null;
}

function native(): NativeAddon | null {
  if (loaded !== undefined) return loaded;
  try { loaded = loadAddon(); }
  catch { loaded = null; }
  return loaded;
}

export function posixDirAdapterAvailable(): boolean {
  return native() !== null;
}

function identityOf(stat: { dev?: bigint; ino?: bigint }): DirIdentity | null {
  if (stat.dev === undefined || stat.ino === undefined) return null;
  return { dev: stat.dev.toString(), ino: stat.ino.toString() };
}

function closeQuiet(addon: NativeAddon, fd: number): void {
  owned.delete(fd);
  if (fd >= 0) addon.close(fd);
}

function take(fd: number): number {
  owned.add(fd);
  return fd;
}

export function openRootDirectory(absolutePath: string): OpenedDir | { reason: string } {
  const addon = native();
  if (!addon) return { reason: 'adapter_unavailable' };
  if (typeof absolutePath !== 'string' || !isAbsolute(absolutePath) || absolutePath.includes('\0') || absolutePath.includes('\\')) {
    return { reason: 'invalid_path' };
  }
  const opened = addon.openRoot(absolutePath);
  if (opened.fd < 0) return { reason: opened.errno === 62 || opened.errno === 40 ? 'symlink' : 'unavailable' };
  const stat = addon.fstat(opened.fd);
  const identity = stat.ok ? identityOf(stat) : null;
  if (!stat.ok || !identity || (Number(stat.mode) & S_IFMT) !== S_IFDIR) {
    addon.close(opened.fd);
    return { reason: 'unavailable' };
  }
  return { fd: take(opened.fd), identity, nlink: Number(stat.nlink ?? 0) };
}

export function listDirectory(dirfd: number): { names: string[] } | { reason: string } {
  const addon = native();
  if (!addon) return { reason: 'adapter_unavailable' };
  if (!Number.isInteger(dirfd) || dirfd < 0 || !owned.has(dirfd)) return { reason: 'unavailable' };
  const listed = addon.list(dirfd);
  if (!listed.ok) return { reason: 'unavailable' };
  return { names: listed.names.filter(name => NAME.test(name)) };
}

export function openChild(dirfd: number, name: string, asDirectory: boolean): OpenedDir | { reason: string } {
  const addon = native();
  if (!addon) return { reason: 'adapter_unavailable' };
  if (!Number.isInteger(dirfd) || dirfd < 0 || !owned.has(dirfd) || !NAME.test(name) || name === '.' || name === '..') return { reason: 'invalid_path' };
  const opened = addon.openAt(dirfd, name, asDirectory ? 1 : 0);
  if (opened.fd < 0) {
    if (opened.errno === 62 || opened.errno === 40) return { reason: 'symlink' };
    return { reason: 'unavailable' };
  }
  const stat = addon.fstat(opened.fd);
  const identity = stat.ok ? identityOf(stat) : null;
  const mode = Number(stat.mode) & S_IFMT;
  const expected = asDirectory ? S_IFDIR : S_IFREG;
  const nlink = Number(stat.nlink ?? 0);
  if (!stat.ok || !identity || mode !== expected || (!asDirectory && nlink !== 1)) {
    addon.close(opened.fd);
    return { reason: 'unavailable' };
  }
  return { fd: take(opened.fd), identity, nlink };
}

export function readOpened(fd: number, maxBytes: number): { bytes: Buffer } | { reason: string } {
  const addon = native();
  if (!addon) return { reason: 'adapter_unavailable' };
  if (!Number.isInteger(fd) || fd < 0 || !owned.has(fd) || !Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > 65536) return { reason: 'unavailable' };
  const stat = addon.fstat(fd);
  if (!stat.ok || Number(stat.nlink) !== 1 || (Number(stat.mode) & S_IFMT) !== S_IFREG) return { reason: 'unavailable' };
  const read = addon.read(fd, maxBytes);
  if (!read.ok || !read.bytes) return { reason: 'unavailable' };
  return { bytes: read.bytes };
}

export function closeDescriptor(fd: number): void {
  const addon = native();
  if (addon && Number.isInteger(fd) && fd >= 0) closeQuiet(addon, fd);
}

export function identitiesEqual(left: DirIdentity, right: DirIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
