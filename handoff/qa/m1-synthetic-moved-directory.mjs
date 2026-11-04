// Checks the completed-move case only; it does not prove rename/read atomicity.
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginSyntheticRoot } from '../../dist/fixture-discovery.js';
import { openChild } from '../../dist/posix-dir-handle.js';
import { openDatabase } from '../../dist/storage.js';

const outside = mkdtempSync(join(tmpdir(), 'hark-move-proof-'));
const root = beginSyntheticRoot();
const db = openDatabase(':memory:');
let session;
try {
  mkdirSync(join(root.setupPath, 'project-a'));
  writeFileSync(join(root.setupPath, 'project-a', 'data.txt'), 'SYNTHETIC_MOVE_PROOF');
  session = root.commit(db, new Date('2026-11-04T12:00:00Z'), '2099-01-01T00:00:00Z');
  if (session.status !== 'available') throw new Error('Synthetic adapter unavailable');
  const directory = openChild(session.handle.rootDescriptor(), 'project-a', true);
  if ('reason' in directory) throw new Error('Synthetic directory unavailable');
  renameSync(join(root.setupPath, 'project-a'), join(outside, 'project-a'));
  const file = openChild(directory.fd, 'data.txt', false);
  const blocked = 'reason' in file;
  console.log(`moved synthetic child rejected: ${blocked}`);
  if (!blocked) throw new Error('Moved synthetic child was still readable');
} finally {
  if (session?.status === 'available') session.handle.release();
  db.close();
  rmSync(root.setupPath, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}
