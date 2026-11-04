import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beginSyntheticRoot, enumerateSyntheticRoot, issueSyntheticProjectRead, posixDirAdapterAvailable, readSyntheticFile } from '../src/fixture-discovery.js';
import { openDatabase } from '../src/storage.js';

const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
describe.skipIf(!posixDirAdapterAvailable())('synthetic candidate identity', () => {
  it('does not read a different project substituted at an already authorized path', () => {
    const db = openDatabase(':memory:'), root = beginSyntheticRoot(); paths.push(root.setupPath);
    for (const [name, content] of [['project-a', 'SYNTHETIC_A'], ['project-b', 'SYNTHETIC_B']]) {
      mkdirSync(join(root.setupPath, name!));
      writeFileSync(join(root.setupPath, name!, 'PROJECT.md'), 'synthetic');
      writeFileSync(join(root.setupPath, name!, 'data.txt'), content!);
    }
    const now = new Date('2026-11-04T12:00:00.000Z'), expires = '2099-01-01T00:00:00.000Z';
    const session = root.commit(db, now, expires);
    if (session.status !== 'available') throw new Error('Synthetic adapter unavailable');
    try {
      const found = enumerateSyntheticRoot(db, session.handle, now);
      if (!('candidates' in found)) throw new Error('Synthetic scan unavailable');
      const a = found.candidates.find(candidate => candidate.relativePath === 'project-a');
      const grant = issueSyntheticProjectRead(db, session.handle, a?.candidateId, now, expires);
      if (grant.status !== 'available') throw new Error('Synthetic grant unavailable');
      renameSync(join(root.setupPath, 'project-a'), join(root.setupPath, 'parked-a'));
      renameSync(join(root.setupPath, 'project-b'), join(root.setupPath, 'project-a'));
      expect(readSyntheticFile(db, session.handle, grant.scope, ['project-a', 'data.txt'], 1024, now)).toHaveProperty('status', 'unavailable');
    } finally { session.handle.release(); db.close(); }
  });
});
