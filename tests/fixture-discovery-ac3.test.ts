import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginSyntheticRoot, enumerateSyntheticRoot, issueSyntheticProjectRead, posixDirAdapterAvailable, readSyntheticFile, revokeSyntheticRoot, type DiscoveryCandidate, type DiscoveryResult } from '../src/fixture-discovery.js';
import { listDirectory } from '../src/posix-dir-handle.js';
import { openDatabase } from '../src/storage.js';

const dirs: string[] = [];
const now = new Date('2026-11-04T12:00:00.000Z');
const expires = '2099-01-01T00:00:00.000Z';
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function inventory(result: DiscoveryResult): DiscoveryCandidate[] {
  if ('candidates' in result) return result.candidates;
  throw new Error(result.reason);
}

function openDb() {
  const dir = mkdtempSync(join(tmpdir(), 'hearth-ac3-db-'));
  dirs.push(dir);
  return openDatabase(join(dir, 'synthetic.sqlite'));
}

describe.skipIf(!posixDirAdapterAvailable())('A-C3 discovery boundary regressions', () => {
  it('refuses project content without a server-issued project grant', () => {
    const db = openDb();
    const session = beginSyntheticRoot();
    dirs.push(session.setupPath);
    mkdirSync(join(session.setupPath, 'project-a'));
    writeFileSync(join(session.setupPath, 'project-a', 'local.txt'), 'SYNTHETIC_PROJECT_CONTENT');
    writeFileSync(join(session.setupPath, 'project-a', 'PROJECT.md'), '# synthetic\n');
    const committed = session.commit(db, now, expires);
    expect(committed.status).toBe('available');
    if (committed.status !== 'available') return;
    const candidates = inventory(enumerateSyntheticRoot(db, committed.handle, now));
    const project = candidates.find(item => item.relativePath === 'project-a');
    expect(project?.attribution).toBe('confirmed');
    expect(db.prepare('SELECT COUNT(*) AS n FROM observation_grants').get()?.n).toBe(0);
    expect(readSyntheticFile(db, committed.handle, ['project-a', 'local.txt'], ['project-a', 'local.txt'], 1024, now).status).toBe('unavailable');
    const issued = issueSyntheticProjectRead(db, committed.handle, project?.candidateId, now, expires);
    expect(issued.status).toBe('available');
    if (issued.status !== 'available') return;
    const allowed = readSyntheticFile(db, committed.handle, issued.scope, ['project-a', 'local.txt'], 1024, now);
    expect(allowed.status).toBe('available');
    if (allowed.status === 'available') expect(allowed.bytes.toString('utf8')).toBe('SYNTHETIC_PROJECT_CONTENT');
    const unassigned = candidates.find(item => item.relativePath === 'unassigned');
    expect(issueSyntheticProjectRead(db, committed.handle, unassigned?.candidateId ?? 'missing', now, expires).status).toBe('unavailable');
    committed.handle.release();
    db.close();
  });

  it('does not return a hard-linked file whose inode also exists outside the root', () => {
    const db = openDb();
    const outside = mkdtempSync(join(tmpdir(), 'hearth-ac3-outside-'));
    dirs.push(outside);
    writeFileSync(join(outside, 'fixture.txt'), 'SYNTHETIC_OUTSIDE_CONTENT');
    const session = beginSyntheticRoot();
    dirs.push(session.setupPath);
    mkdirSync(join(session.setupPath, 'project-a'));
    writeFileSync(join(session.setupPath, 'project-a', 'PROJECT.md'), '# synthetic\n');
    writeFileSync(join(session.setupPath, 'project-a', 'local.txt'), 'inside');
    linkSync(join(outside, 'fixture.txt'), join(session.setupPath, 'project-a', 'data.txt'));
    const committed = session.commit(db, now, expires);
    expect(committed.status).toBe('available');
    if (committed.status !== 'available') return;
    const project = inventory(enumerateSyntheticRoot(db, committed.handle, now)).find(item => item.relativePath === 'project-a');
    const issued = issueSyntheticProjectRead(db, committed.handle, project?.candidateId, now, expires);
    expect(issued.status).toBe('available');
    if (issued.status !== 'available') return;
    const linked = readSyntheticFile(db, committed.handle, issued.scope, ['project-a', 'data.txt'], 1024, now);
    expect(linked.status).toBe('unavailable');
    if (linked.status === 'available') expect(linked.bytes.toString('utf8')).not.toBe('SYNTHETIC_OUTSIDE_CONTENT');
    const local = readSyntheticFile(db, committed.handle, issued.scope, ['project-a', 'local.txt'], 1024, now);
    expect(local.status).toBe('available');
    committed.handle.release();
    db.close();
  });

  it('closes handles on revoke and refuses to un-revoke through SQL', () => {
    const db = openDb();
    const session = beginSyntheticRoot();
    dirs.push(session.setupPath);
    mkdirSync(join(session.setupPath, 'project-c'));
    const committed = session.commit(db, now, expires);
    expect(committed.status).toBe('available');
    if (committed.status !== 'available') return;
    const stolen = committed.handle.rootDescriptor();
    expect(revokeSyntheticRoot(db, committed.rootId, committed.rootEpoch, now).allowed).toBe(true);
    expect(committed.handle.alive).toBe(false);
    expect('fd' in committed.handle).toBe(false);
    expect('names' in listDirectory(stolen)).toBe(false);
    expect(() => db.prepare('UPDATE fixture_roots SET revoked_at=NULL, enabled=1 WHERE root_id=? AND root_epoch=?').run(committed.rootId, committed.rootEpoch))
      .toThrow(/irreversible/);
    expect(enumerateSyntheticRoot(db, committed.handle, now).status).toBe('cancelled');
    db.close();
  });

  it('restores the same candidate identity when a directory is moved out and returned', () => {
    const db = openDb();
    const session = beginSyntheticRoot();
    dirs.push(session.setupPath);
    mkdirSync(join(session.setupPath, 'project-b'));
    writeFileSync(join(session.setupPath, 'project-b', 'PROJECT.md'), 'synthetic');
    const committed = session.commit(db, now, expires);
    expect(committed.status).toBe('available');
    if (committed.status !== 'available') return;
    const first = inventory(enumerateSyntheticRoot(db, committed.handle, now)).find(item => item.relativePath === 'project-b');
    expect(first).toBeTruthy();
    const parked = join(session.setupPath, '..', `parked-${first?.candidateId}`);
    renameSync(join(session.setupPath, 'project-b'), parked);
    dirs.push(parked);
    expect(inventory(enumerateSyntheticRoot(db, committed.handle, now)).some(item => item.relativePath === 'project-b')).toBe(false);
    renameSync(parked, join(session.setupPath, 'project-b'));
    const returned = enumerateSyntheticRoot(db, committed.handle, now);
    expect(returned.status === 'unavailable' || returned.status === 'cancelled').toBe(false);
    const again = inventory(returned).find(item => item.relativePath === 'project-b');
    expect(again?.candidateId).toBe(first?.candidateId);
    committed.handle.release();
    db.close();
  });

  it('does not compile or load the native adapter from the process temp directory', () => {
    const source = readFileSync(new URL('../src/posix-dir-handle.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('execFileSync');
    expect(source).not.toContain("join(tmpdir()");
    const cache = join(tmpdir(), 'hearth-posix-dir');
    expect(existsSync(join(cache, `hearth_posix_dir-${process.platform}-${process.arch}.node`))).toBe(false);
  });
});
