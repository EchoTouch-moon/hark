import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beginSyntheticRoot, enumerateSyntheticRoot, issueSyntheticProjectRead, pauseSyntheticRoot, posixDirAdapterAvailable, readSyntheticFile, resumeSyntheticRoot, revokeSyntheticRoot } from '../src/fixture-discovery.js';
import { openDatabase } from '../src/storage.js';

const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe.skipIf(!posixDirAdapterAvailable())('persistent synthetic folder authorization', () => {
  it('survives time passage until paused or revoked', () => {
    const db = openDatabase(':memory:'), root = beginSyntheticRoot(); paths.push(root.setupPath);
    mkdirSync(join(root.setupPath, 'project-a'));
    writeFileSync(join(root.setupPath, 'project-a', 'PROJECT.md'), 'SYNTHETIC');
    writeFileSync(join(root.setupPath, 'project-a', 'notes.txt'), 'SYNTHETIC_NOTES');
    const now = new Date('2026-11-04T12:00:00Z'), later = new Date('2300-01-01T00:00:00Z');
    const session = root.commit(db, now, 'never');
    if (session.status !== 'available') throw new Error('Persistent root unavailable');
    try {
      const found = enumerateSyntheticRoot(db, session.handle, now);
      if (!('candidates' in found)) throw new Error('Synthetic scan unavailable');
      const candidate = found.candidates.find(item => item.relativePath === 'project-a');
      const issued = issueSyntheticProjectRead(db, session.handle, candidate?.candidateId, now, 'never');
      if (issued.status !== 'available') throw new Error('Persistent grant unavailable');
      const read = () => readSyntheticFile(db, session.handle, issued.scope, ['project-a', 'PROJECT.md'], 128, later);
      expect(read().status).toBe('available');
      expect(readSyntheticFile(db, session.handle, issued.scope, ['project-a', 'notes.txt'], 128, later).status).toBe('available');
      expect(db.prepare('SELECT count(*) AS n FROM observation_grants').get()?.n).toBe(1);
      expect(pauseSyntheticRoot(db, session.rootId, session.rootEpoch, later).allowed).toBe(true);
      expect(read().status).toBe('unavailable');
      expect(resumeSyntheticRoot(db, session.rootId, session.rootEpoch, later).allowed).toBe(true);
      expect(read().status).toBe('available');
      expect(revokeSyntheticRoot(db, session.rootId, session.rootEpoch, later).allowed).toBe(true);
      expect(read().status).toBe('cancelled');
      expect(resumeSyntheticRoot(db, session.rootId, session.rootEpoch, later).allowed).toBe(false);
    } finally { session.handle.release(); db.close(); }
  });
});
