import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { closeDescriptor, identitiesEqual, listDirectory, openChild, openRootDirectory, posixDirAdapterAvailable, readOpened, type DirIdentity } from './posix-dir-handle.js';

export const FIXTURE_ROOT_OWNER = 'hearth.fixture.internal';
export const DiscoveryStatus = z.enum(['available', 'needs_confirmation', 'unavailable', 'cancelled']);
export type DiscoveryStatus = z.infer<typeof DiscoveryStatus>;
const Id = z.string().trim().min(1).max(256);
const DateTime = z.string().datetime({ offset: true });
const RelativeName = z.string().regex(/^[A-Za-z0-9._-]+$/);
const RelativePath = z.string().regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/);
export const DiscoveryCandidate = z.object({
  candidateId: Id, rootId: Id, rootEpoch: z.number().int().positive().safe(),
  relativePath: RelativePath, kind: z.enum(['git_marker', 'non_git', 'unknown']),
  attribution: z.enum(['confirmed', 'needs_confirmation']), inspectedAt: DateTime, synthetic: z.literal(true),
}).strict();
export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidate>;
export type DiscoveryResult =
  | { status: 'available' | 'needs_confirmation'; candidates: DiscoveryCandidate[] }
  | { status: 'unavailable' | 'cancelled'; reason: string };
export type RootAccess = { allowed: true } | { allowed: false; reason: string };
export type RootSession = { status: 'available'; rootId: string; rootEpoch: number; handle: FixtureRootHandle } | { status: 'unavailable'; reason: string };
type RootOperation = 'enumerate' | 'read' | 'restore' | 'pause' | 'resume' | 'revoke';
const MAX_DEPTH = 3, MAX_READ = 65536, MAX_CANDIDATES = 32;

export class FixtureRootHandle {
  readonly #fd: number;
  readonly identity: DirIdentity;
  readonly rootId: string;
  readonly rootEpoch: number;
  #alive = true;
  #cancelled = false;
  constructor(rootId: string, rootEpoch: number, fd: number, identity: DirIdentity) {
    this.rootId = rootId; this.rootEpoch = rootEpoch; this.#fd = fd; this.identity = Object.freeze({ ...identity });
  }
  get cancelled(): boolean { return this.#cancelled; }
  get alive(): boolean { return this.#alive; }
  get fd(): number { return this.#alive ? this.#fd : -1; }
  cancel(): void { this.#cancelled = true; this.release(); }
  release(): void { if (!this.#alive) return; this.#alive = false; closeDescriptor(this.#fd); }
  toJSON(): never { throw new Error('Fixture root handles are not serializable'); }
}

function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function clock(now: Date): number | { reason: 'invalid_clock' } {
  const ms = now.getTime();
  return Number.isFinite(ms) ? ms : { reason: 'invalid_clock' };
}

function isManagedFixturePath(absolutePath: string): boolean {
  if (typeof absolutePath !== 'string' || !isAbsolute(absolutePath) || absolutePath.includes('\0') || absolutePath.includes('\\') || absolutePath.includes('..')) return false;
  const prefix = join(tmpdir(), 'hearth-fixture-root-');
  return absolutePath.startsWith(prefix);
}

function audit(db: DatabaseSync, eventType: string, objectId: string, details: Record<string, string | number | boolean>): void {
  db.prepare('INSERT INTO audit_log(id, at, event_type, actor, object_id, sanitized_details_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), new Date().toISOString(), eventType, FIXTURE_ROOT_OWNER, objectId, JSON.stringify(details));
}

function rootRow(db: DatabaseSync, rootId: string, rootEpoch: number) {
  return db.prepare('SELECT root_id, root_epoch, owner, binding_dev, binding_ino, locator, enabled, paused, expires_at, revoked_at, record_version FROM fixture_roots WHERE root_id = ? AND root_epoch = ?')
    .get(rootId, rootEpoch) as {
      root_id: string; root_epoch: number; owner: string; binding_dev: string; binding_ino: string; locator: string;
      enabled: number; paused: number; expires_at: string; revoked_at: string | null; record_version: number;
    } | undefined;
}

export function checkFixtureRootAccess(db: DatabaseSync, rootId: string, rootEpoch: number, operation: RootOperation, now: Date, handle?: FixtureRootHandle): RootAccess {
  const nowMs = clock(now);
  if (typeof nowMs !== 'number') return { allowed: false, reason: nowMs.reason };
  if (!Id.safeParse(rootId).success || !Number.isSafeInteger(rootEpoch) || rootEpoch < 1) return { allowed: false, reason: 'unavailable' };
  const row = rootRow(db, rootId, rootEpoch);
  if (!row || row.owner !== FIXTURE_ROOT_OWNER) return { allowed: false, reason: 'unavailable' };
  if (row.revoked_at !== null || row.enabled !== 1) return { allowed: false, reason: 'unavailable' };
  if (Date.parse(row.expires_at) <= nowMs) return { allowed: false, reason: 'unavailable' };
  if (row.paused === 1 && (operation === 'enumerate' || operation === 'read' || operation === 'restore')) return { allowed: false, reason: 'unavailable' };
  if (handle) {
    if (!handle.alive) return { allowed: false, reason: handle.cancelled ? 'cancelled' : 'unavailable' };
    if (handle.cancelled) return { allowed: false, reason: 'cancelled' };
    if (handle.rootId !== rootId || handle.rootEpoch !== rootEpoch) return { allowed: false, reason: 'unavailable' };
    if (!identitiesEqual(handle.identity, { dev: row.binding_dev, ino: row.binding_ino })) return { allowed: false, reason: 'unavailable' };
  }
  return { allowed: true };
}

export function beginSyntheticRoot(): { setupPath: string; commit: (db: DatabaseSync, now: Date, expiresAt: string) => RootSession } {
  const setupPath = mkdtempSync(join(tmpdir(), 'hearth-fixture-root-'));
  return {
    setupPath,
    commit(db, now, expiresAt) {
      const nowMs = clock(now);
      if (typeof nowMs !== 'number') return { status: 'unavailable', reason: 'invalid_clock' };
      if (!DateTime.safeParse(expiresAt).success || Date.parse(expiresAt) <= nowMs) return { status: 'unavailable', reason: 'unavailable' };
      if (!posixDirAdapterAvailable()) return { status: 'unavailable', reason: 'adapter_unavailable' };
      if (!isManagedFixturePath(setupPath)) return { status: 'unavailable', reason: 'invalid_path' };
      const opened = openRootDirectory(setupPath);
      if ('reason' in opened) return { status: 'unavailable', reason: opened.reason };
      const rootId = randomUUID(), rootEpoch = 1;
      try {
        return transaction(db, () => {
          db.prepare(`INSERT INTO fixture_roots(root_id, root_epoch, owner, binding_dev, binding_ino, locator, enabled, paused, expires_at, revoked_at, record_version)
            VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, NULL, 1)`).run(rootId, rootEpoch, FIXTURE_ROOT_OWNER, opened.identity.dev, opened.identity.ino, setupPath, expiresAt);
          audit(db, 'fixture_root_registered', rootId, { rootEpoch, synthetic: true });
          return { status: 'available' as const, rootId, rootEpoch, handle: new FixtureRootHandle(rootId, rootEpoch, opened.fd, opened.identity) };
        });
      } catch (error) {
        closeDescriptor(opened.fd);
        throw error;
      }
    },
  };
}

export function restoreSyntheticRoot(db: DatabaseSync, rootId: string, rootEpoch: number, now: Date): RootSession {
  const access = transaction(db, () => checkFixtureRootAccess(db, rootId, rootEpoch, 'restore', now));
  if (!access.allowed) return { status: 'unavailable', reason: access.reason };
  const row = rootRow(db, rootId, rootEpoch);
  if (!row || !isManagedFixturePath(row.locator)) return { status: 'unavailable', reason: 'unavailable' };
  const opened = openRootDirectory(row.locator);
  if ('reason' in opened) return { status: 'unavailable', reason: opened.reason };
  if (!identitiesEqual(opened.identity, { dev: row.binding_dev, ino: row.binding_ino })) {
    closeDescriptor(opened.fd);
    return { status: 'unavailable', reason: 'unavailable' };
  }
  const recheck = transaction(db, () => checkFixtureRootAccess(db, rootId, rootEpoch, 'restore', now));
  if (!recheck.allowed) {
    closeDescriptor(opened.fd);
    return { status: 'unavailable', reason: recheck.reason };
  }
  return { status: 'available', rootId, rootEpoch, handle: new FixtureRootHandle(rootId, rootEpoch, opened.fd, opened.identity) };
}

function setRootFlag(db: DatabaseSync, rootId: string, rootEpoch: number, now: Date, operation: 'pause' | 'resume' | 'revoke'): RootAccess {
  return transaction(db, () => {
    const row = rootRow(db, rootId, rootEpoch);
    const nowMs = clock(now);
    if (typeof nowMs !== 'number') return { allowed: false as const, reason: 'invalid_clock' };
    if (!row || row.owner !== FIXTURE_ROOT_OWNER) return { allowed: false as const, reason: 'unavailable' };
    if (operation === 'revoke') {
      if (row.revoked_at === null) db.prepare('UPDATE fixture_roots SET enabled = 0, revoked_at = ?, record_version = record_version + 1 WHERE root_id = ? AND root_epoch = ?').run(now.toISOString(), rootId, rootEpoch);
      audit(db, 'fixture_root_revoked', rootId, { rootEpoch });
      return { allowed: true as const };
    }
    if (row.revoked_at !== null || row.enabled !== 1) return { allowed: false as const, reason: 'unavailable' };
    if (operation === 'pause') db.prepare('UPDATE fixture_roots SET paused = 1, record_version = record_version + 1 WHERE root_id = ? AND root_epoch = ? AND paused = 0').run(rootId, rootEpoch);
    else db.prepare('UPDATE fixture_roots SET paused = 0, record_version = record_version + 1 WHERE root_id = ? AND root_epoch = ? AND paused = 1').run(rootId, rootEpoch);
    audit(db, operation === 'pause' ? 'fixture_root_paused' : 'fixture_root_resumed', rootId, { rootEpoch });
    return { allowed: true as const };
  });
}

export function pauseSyntheticRoot(db: DatabaseSync, rootId: string, rootEpoch: number, now: Date): RootAccess {
  return setRootFlag(db, rootId, rootEpoch, now, 'pause');
}
export function resumeSyntheticRoot(db: DatabaseSync, rootId: string, rootEpoch: number, now: Date): RootAccess {
  return setRootFlag(db, rootId, rootEpoch, now, 'resume');
}
export function revokeSyntheticRoot(db: DatabaseSync, rootId: string, rootEpoch: number, now: Date): RootAccess {
  return setRootFlag(db, rootId, rootEpoch, now, 'revoke');
}

function inspectDirectory(fd: number): { kind: DiscoveryCandidate['kind']; projectLike: boolean } {
  const listed = listDirectory(fd);
  if ('reason' in listed) return { kind: 'unknown', projectLike: false };
  const names = new Set(listed.names);
  const git = names.has('.git') || names.has('GIT-MARKER.txt');
  const project = names.has('PROJECT.md');
  return { kind: git ? 'git_marker' : project ? 'non_git' : 'unknown', projectLike: git || project };
}

type Found = { relativePath: string; kind: DiscoveryCandidate['kind']; identity: DirIdentity };

function scanHandle(handle: FixtureRootHandle): Found[] | { reason: string } {
  const listed = listDirectory(handle.fd);
  if ('reason' in listed) return listed;
  const found: Found[] = [];
  for (const name of listed.names) {
    if (found.length >= MAX_CANDIDATES) return { reason: 'unavailable' };
    const dir = openChild(handle.fd, name, true);
    if ('reason' in dir) continue;
    try {
      const markers = inspectDirectory(dir.fd);
      found.push({ relativePath: name, kind: markers.kind, identity: dir.identity });
      const children = listDirectory(dir.fd);
      if ('reason' in children) continue;
      for (const child of children.names) {
        if (found.length >= MAX_CANDIDATES) return { reason: 'unavailable' };
        const nested = openChild(dir.fd, child, true);
        if ('reason' in nested) continue;
        try {
          const nestedMarkers = inspectDirectory(nested.fd);
          if (nestedMarkers.projectLike) found.push({ relativePath: `${name}/${child}`, kind: nestedMarkers.kind, identity: nested.identity });
        } finally { closeDescriptor(nested.fd); }
      }
    } finally { closeDescriptor(dir.fd); }
  }
  return found;
}

function persistCandidates(db: DatabaseSync, rootId: string, rootEpoch: number, found: Found[], inspectedAt: string): DiscoveryCandidate[] {
  const basenameCount = new Map<string, number>();
  for (const item of found) {
    const base = item.relativePath.split('/').pop()!;
    basenameCount.set(base, (basenameCount.get(base) ?? 0) + 1);
  }
  const publicCandidates: DiscoveryCandidate[] = [];
  const present = new Set(found.map(item => item.relativePath));
  const stale = db.prepare("SELECT candidate_id, relative_path FROM fixture_discovery_candidates WHERE root_id = ? AND root_epoch = ? AND status = 'active'").all(rootId, rootEpoch) as { candidate_id: string; relative_path: string }[];
  for (const row of stale) {
    if (!present.has(row.relative_path)) db.prepare("UPDATE fixture_discovery_candidates SET status = 'invalid' WHERE candidate_id = ?").run(row.candidate_id);
  }
  for (const item of found) {
    const nested = item.relativePath.includes('/');
    const base = item.relativePath.split('/').pop()!;
    const attribution = item.kind === 'unknown' || nested || (basenameCount.get(base) ?? 0) > 1 ? 'needs_confirmation' : 'confirmed';
    const same = db.prepare('SELECT candidate_id FROM fixture_discovery_candidates WHERE root_id = ? AND root_epoch = ? AND relative_path = ? AND binding_dev = ? AND binding_ino = ?')
      .get(rootId, rootEpoch, item.relativePath, item.identity.dev, item.identity.ino) as { candidate_id: string } | undefined;
    const candidateId = same?.candidate_id ?? randomUUID();
    if (same) {
      db.prepare('UPDATE fixture_discovery_candidates SET kind = ?, attribution = ?, inspected_at = ? WHERE candidate_id = ?')
        .run(item.kind, attribution, inspectedAt, candidateId);
    } else {
      db.prepare("UPDATE fixture_discovery_candidates SET status = 'invalid' WHERE root_id = ? AND root_epoch = ? AND relative_path = ? AND status = 'active'")
        .run(rootId, rootEpoch, item.relativePath);
      db.prepare(`INSERT INTO fixture_discovery_candidates(candidate_id, root_id, root_epoch, relative_path, kind, attribution, inspected_at, binding_dev, binding_ino, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`).run(candidateId, rootId, rootEpoch, item.relativePath, item.kind, attribution, inspectedAt, item.identity.dev, item.identity.ino);
    }
    publicCandidates.push(DiscoveryCandidate.parse({
      candidateId, rootId, rootEpoch, relativePath: item.relativePath, kind: item.kind, attribution, inspectedAt, synthetic: true,
    }));
  }
  return publicCandidates;
}

export function enumerateSyntheticRoot(db: DatabaseSync, handle: FixtureRootHandle, now: Date): DiscoveryResult {
  if (handle.cancelled || !handle.alive) return { status: 'cancelled', reason: 'cancelled' };
  const first = transaction(db, () => checkFixtureRootAccess(db, handle.rootId, handle.rootEpoch, 'enumerate', now, handle));
  if (!first.allowed) return { status: first.reason === 'cancelled' ? 'cancelled' : 'unavailable', reason: first.reason };
  const scanned = scanHandle(handle);
  if ('reason' in scanned) return { status: 'unavailable', reason: scanned.reason };
  const inspectedAt = now.toISOString();
  return transaction(db, () => {
    const again = checkFixtureRootAccess(db, handle.rootId, handle.rootEpoch, 'enumerate', now, handle);
    if (!again.allowed) return { status: again.reason === 'cancelled' ? 'cancelled' : 'unavailable', reason: again.reason } as DiscoveryResult;
    const candidates = persistCandidates(db, handle.rootId, handle.rootEpoch, scanned, inspectedAt);
    audit(db, 'fixture_root_enumerated', handle.rootId, { rootEpoch: handle.rootEpoch, count: candidates.length });
    const status = candidates.some(item => item.attribution === 'needs_confirmation') ? 'needs_confirmation' : 'available';
    return { status, candidates };
  });
}

function parseComponents(components: unknown): string[] | null {
  if (!Array.isArray(components) || components.length === 0 || components.length > MAX_DEPTH + 1) return null;
  const parsed: string[] = [];
  for (const part of components) {
    if (!RelativeName.safeParse(part).success) return null;
    parsed.push(part);
  }
  return parsed;
}

export function readSyntheticFile(db: DatabaseSync, handle: FixtureRootHandle, components: unknown, maxBytes: number, now: Date): { status: 'available'; bytes: Buffer } | { status: 'unavailable' | 'cancelled'; reason: string } {
  if (handle.cancelled || !handle.alive) return { status: 'cancelled', reason: 'cancelled' };
  const parts = parseComponents(components);
  if (!parts || !Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_READ) return { status: 'unavailable', reason: 'invalid_path' };
  const access = transaction(db, () => checkFixtureRootAccess(db, handle.rootId, handle.rootEpoch, 'read', now, handle));
  if (!access.allowed) return { status: access.reason === 'cancelled' ? 'cancelled' : 'unavailable', reason: access.reason };
  let cursor = handle.fd;
  const opened: number[] = [];
  try {
    for (let index = 0; index < parts.length; index++) {
      const last = index === parts.length - 1;
      const child = openChild(cursor, parts[index]!, !last);
      if ('reason' in child) return { status: 'unavailable', reason: child.reason };
      opened.push(child.fd);
      cursor = child.fd;
    }
    const read = readOpened(cursor, maxBytes);
    const recheck = transaction(db, () => checkFixtureRootAccess(db, handle.rootId, handle.rootEpoch, 'read', now, handle));
    if (!recheck.allowed) return { status: recheck.reason === 'cancelled' ? 'cancelled' : 'unavailable', reason: recheck.reason };
    if ('reason' in read) return { status: 'unavailable', reason: read.reason };
    return { status: 'available', bytes: read.bytes };
  } finally {
    for (const fd of opened) closeDescriptor(fd);
  }
}

export { posixDirAdapterAvailable };
