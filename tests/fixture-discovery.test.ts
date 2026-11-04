import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beginSyntheticRoot, enumerateSyntheticRoot, issueSyntheticProjectRead, pauseSyntheticRoot, posixDirAdapterAvailable, readSyntheticFile, restoreSyntheticRoot, resumeSyntheticRoot, revokeSyntheticRoot, type DiscoveryCandidate, type DiscoveryResult } from '../src/fixture-discovery.js';
import { openDatabase } from '../src/storage.js';

const sampleRoot = fileURLToPath(new URL('./fixtures/rediscovery', import.meta.url));
const dirs: string[] = [];
const now = new Date('2026-11-04T12:00:00.000Z');
const expires = '2099-01-01T00:00:00.000Z';
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function database() {
  const dir = mkdtempSync(join(tmpdir(), 'hearth-discovery-db-'));
  dirs.push(dir);
  return openDatabase(join(dir, 'synthetic.sqlite'));
}

function inventory(result: DiscoveryResult): DiscoveryCandidate[] {
  if ('candidates' in result) return result.candidates;
  throw new Error(result.reason);
}

function stageRoot(extra?: (setupPath: string) => void) {
  const session = beginSyntheticRoot();
  dirs.push(session.setupPath);
  cpSync(sampleRoot, session.setupPath, { recursive: true });
  mkdirSync(join(session.setupPath, 'project-a', '.git'));
  extra?.(session.setupPath);
  return session;
}

describe('synthetic discovery adapter availability', () => {
  it('loads a prebuilt posix openat adapter and keeps Windows fail-closed', () => {
    if (process.platform === 'win32') expect(posixDirAdapterAvailable()).toBe(false);
    else expect(posixDirAdapterAvailable()).toBe(true);
  });
});

describe.skipIf(process.platform === 'win32')('synthetic fixture discovery', () => {
  it('discovers git and non-git projects with stable ids across repeat scans and restart', () => {
    const dbDir = mkdtempSync(join(tmpdir(), 'hearth-discovery-db-'));
    dirs.push(dbDir);
    const dbPath = join(dbDir, 'synthetic.sqlite');
    let db = openDatabase(dbPath);
    const session = stageRoot();
    const committed = session.commit(db, now, expires);
    expect(committed.status).toBe('available');
    if (committed.status !== 'available') return;
    const first = enumerateSyntheticRoot(db, committed.handle, now);
    expect(first.status).toBe('needs_confirmation');
    const firstCandidates = inventory(first);
    const byPath = Object.fromEntries(firstCandidates.map(item => [item.relativePath, item]));
    expect(byPath['project-a']?.kind).toBe('git_marker');
    expect(byPath['project-a']?.attribution).toBe('confirmed');
    expect(byPath['project-b']?.kind).toBe('non_git');
    expect(byPath['project-b']?.attribution).toBe('confirmed');
    expect(byPath.unassigned?.kind).toBe('unknown');
    expect(byPath.unassigned?.attribution).toBe('needs_confirmation');
    expect(JSON.stringify(first)).not.toMatch(/\/var\/|\/Users\/|\\\\|setupPath|locator/);
    const secondCandidates = inventory(enumerateSyntheticRoot(db, committed.handle, now));
    expect(secondCandidates.map(item => item.candidateId).sort()).toEqual(firstCandidates.map(item => item.candidateId).sort());
    committed.handle.release();
    db.close();
    db = openDatabase(dbPath);
    const restored = restoreSyntheticRoot(db, committed.rootId, committed.rootEpoch, now);
    expect(restored.status).toBe('available');
    if (restored.status !== 'available') return;
    const againCandidates = inventory(enumerateSyntheticRoot(db, restored.handle, now));
    expect(againCandidates.map(item => item.candidateId).sort()).toEqual(firstCandidates.map(item => item.candidateId).sort());
    const projectA = againCandidates.find(item => item.relativePath === 'project-a');
    expect(projectA?.attribution).toBe('confirmed');
    const issued = issueSyntheticProjectRead(db, restored.handle, projectA?.candidateId, now, expires);
    expect(issued.status).toBe('available');
    if (issued.status !== 'available') return;
    const text = readSyntheticFile(db, restored.handle, issued.scope, ['project-a', 'PROJECT.md'], 4096, now);
    expect(text.status).toBe('available');
    if (text.status === 'available') expect(text.bytes.toString('utf8')).toContain('星光书签');
    expect(readSyntheticFile(db, restored.handle, ['project-a', 'PROJECT.md'], ['project-a', 'PROJECT.md'], 4096, now).status).toBe('unavailable');
    restored.handle.release();
    db.close();
  });

  it('keeps same-name nested directories unconfirmed and isolated across roots', () => {
    const db = database();
    const sessionA = stageRoot(setupPath => {
      mkdirSync(join(setupPath, 'nested', 'project-a'), { recursive: true });
      writeFileSync(join(setupPath, 'nested', 'project-a', 'PROJECT.md'), '# nested synthetic\n');
    });
    const a = sessionA.commit(db, now, expires);
    const sessionB = stageRoot();
    const b = sessionB.commit(db, now, expires);
    expect(a.status).toBe('available');
    expect(b.status).toBe('available');
    if (a.status !== 'available' || b.status !== 'available') return;
    const foundA = inventory(enumerateSyntheticRoot(db, a.handle, now));
    const foundB = inventory(enumerateSyntheticRoot(db, b.handle, now));
    const nested = foundA.find(item => item.relativePath === 'nested/project-a');
    const top = foundA.find(item => item.relativePath === 'project-a');
    expect(nested?.attribution).toBe('needs_confirmation');
    expect(top?.attribution).toBe('needs_confirmation');
    expect(foundA.every(item => item.rootId === a.rootId)).toBe(true);
    expect(foundB.every(item => item.rootId === b.rootId)).toBe(true);
    const idsB = new Set(foundB.map(item => item.candidateId));
    expect(foundA.some(item => idsB.has(item.candidateId))).toBe(false);
    a.handle.release();
    b.handle.release();
    db.close();
  });

  it('fails closed for traversal, symlinks, replacement and missing authorization', () => {
    const db = database();
    const outside = mkdtempSync(join(tmpdir(), 'hearth-discovery-outside-'));
    dirs.push(outside);
    writeFileSync(join(outside, 'secret.txt'), 'OUTSIDE_SECRET');
    const session = stageRoot(setupPath => {
      symlinkSync(outside, join(setupPath, 'escape'));
    });
    const committed = session.commit(db, now, expires);
    expect(committed.status).toBe('available');
    if (committed.status !== 'available') return;
    const found = enumerateSyntheticRoot(db, committed.handle, now);
    const foundCandidates = inventory(found);
    expect(foundCandidates.some(item => item.relativePath === 'escape')).toBe(false);
    expect(JSON.stringify(found)).not.toContain('OUTSIDE_SECRET');
    expect(readSyntheticFile(db, committed.handle, { principalId: 'user', projectId: 'A', grantId: 'g', rootId: committed.rootId, candidateId: 'missing' }, ['escape', 'secret.txt'], 4096, now).status).toBe('unavailable');
    expect(readSyntheticFile(db, committed.handle, { principalId: 'user', projectId: 'A', grantId: 'g', rootId: committed.rootId, candidateId: 'missing' }, ['..', 'secret.txt'], 4096, now).status).toBe('unavailable');
    expect(readSyntheticFile(db, committed.handle, { principalId: 'user', projectId: 'A', grantId: 'g', rootId: committed.rootId, candidateId: 'missing' }, [join(outside, 'secret.txt')], 4096, now).status).toBe('unavailable');
    rmSync(join(session.setupPath, 'project-a', 'PROJECT.md'));
    symlinkSync(join(outside, 'secret.txt'), join(session.setupPath, 'project-a', 'PROJECT.md'));
    const replaced = readSyntheticFile(db, committed.handle, { principalId: 'user', projectId: 'A', grantId: 'g', rootId: committed.rootId, candidateId: 'missing' }, ['project-a', 'PROJECT.md'], 4096, now);
    expect(replaced.status).toBe('unavailable');
    if (replaced.status === 'available') expect(replaced.bytes.toString('utf8')).not.toContain('OUTSIDE_SECRET');
    expect(enumerateSyntheticRoot(db, committed.handle, new Date('invalid')).status).toBe('unavailable');
    expect(pauseSyntheticRoot(db, committed.rootId, committed.rootEpoch, now).allowed).toBe(true);
    expect(enumerateSyntheticRoot(db, committed.handle, now).status).toBe('unavailable');
    expect(resumeSyntheticRoot(db, committed.rootId, committed.rootEpoch, now).allowed).toBe(true);
    expect(enumerateSyntheticRoot(db, committed.handle, now).status).not.toBe('unavailable');
    expect(revokeSyntheticRoot(db, committed.rootId, committed.rootEpoch, now).allowed).toBe(true);
    expect(enumerateSyntheticRoot(db, committed.handle, now).status).toBe('cancelled');
    expect(resumeSyntheticRoot(db, committed.rootId, committed.rootEpoch, now).allowed).toBe(false);
    committed.handle.cancel();
    expect(enumerateSyntheticRoot(db, committed.handle, now).status).toBe('cancelled');
    db.close();
  });

  it('does not restore a replaced root instance from the stored locator', () => {
    const db = database();
    const session = stageRoot();
    const committed = session.commit(db, now, expires);
    expect(committed.status).toBe('available');
    if (committed.status !== 'available') return;
    const moved = `${session.setupPath}.moved`;
    committed.handle.release();
    renameSync(session.setupPath, moved);
    dirs.push(moved);
    mkdirSync(session.setupPath);
    writeFileSync(join(session.setupPath, 'decoy.md'), 'replacement');
    const restored = restoreSyntheticRoot(db, committed.rootId, committed.rootEpoch, now);
    expect(restored.status).toBe('unavailable');
    db.close();
  });
});

describe('windows and unknown roots stay unavailable', () => {
  it('does not register a usable synthetic root when the adapter is missing', () => {
    if (posixDirAdapterAvailable()) return;
    const db = database();
    const session = beginSyntheticRoot();
    dirs.push(session.setupPath);
    expect(session.commit(db, now, expires)).toEqual({ status: 'unavailable', reason: 'adapter_unavailable' });
    db.close();
  });
});
