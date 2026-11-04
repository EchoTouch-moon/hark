import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beginSyntheticRoot, posixDirAdapterAvailable, revokeSyntheticRoot } from '../src/fixture-discovery.js';
import { closeDescriptor, listDirectory, openChild, readOpened } from '../src/posix-dir-handle.js';
import { openDatabase } from '../src/storage.js';

const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe.skipIf(!posixDirAdapterAvailable())('revoked synthetic root handle lifecycle', () => {
  it('does not revive old access or close a later root when the OS reuses a descriptor', () => {
    const db = openDatabase(':memory:');
    const a = beginSyntheticRoot(), b = beginSyntheticRoot();
    paths.push(a.setupPath, b.setupPath);
    mkdirSync(join(a.setupPath, 'synthetic-a'));
    mkdirSync(join(b.setupPath, 'synthetic-b'));
    const now = new Date('2026-11-04T12:00:00.000Z'), expires = '2099-01-01T00:00:00.000Z';
    const rootA = a.commit(db, now, expires);
    expect(rootA.status).toBe('available');
    if (rootA.status !== 'available') throw new Error('Synthetic adapter unavailable');
    let closeB: (() => void) | undefined;
    try {
      const old = rootA.handle.rootDescriptor();
      const child = openChild(old, 'synthetic-a', true);
      expect(child).toHaveProperty('fd');
      if (!('fd' in child)) throw new Error('Synthetic child unavailable');
      expect(listDirectory(JSON.parse(JSON.stringify(old)))).toHaveProperty('reason');
      expect(revokeSyntheticRoot(db, rootA.rootId, rootA.rootEpoch, now).allowed).toBe(true);
      const rootB = b.commit(db, now, expires);
      expect(rootB.status).toBe('available');
      if (rootB.status !== 'available') throw new Error('Synthetic adapter unavailable');
      closeB = () => rootB.handle.release();
      expect(listDirectory(old)).toHaveProperty('reason');
      expect(openChild(old, 'synthetic-b', true)).toHaveProperty('reason');
      expect(readOpened(old, 100)).toHaveProperty('reason');
      expect(listDirectory(child.fd)).toHaveProperty('reason');
      expect(openChild(child.fd, 'anything', true)).toHaveProperty('reason');
      expect(readOpened(child.fd, 100)).toHaveProperty('reason');
      closeDescriptor(child.fd);
      closeDescriptor(old);
      expect(listDirectory(rootB.handle.rootDescriptor())).toEqual({ names: expect.arrayContaining(['synthetic-b']) });
    } finally {
      closeB?.(); rootA.handle.release(); db.close();
    }
  });
});
