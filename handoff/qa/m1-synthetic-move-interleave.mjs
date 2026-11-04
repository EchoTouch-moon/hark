// Deterministic scheduling of a synthetic rename between the final check and read.
// This is a limitation reproduction, not a safety PASS. No real project is used.
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const nativePath = require.resolve(`../../build/hearth_posix_dir-${process.platform}-${process.arch}.node`);
const actual = require(nativePath);
let beforeRead = () => {};
const wrapped = {
  available: actual.available,
  openRoot: (...args) => actual.openRoot(...args),
  openAt: (...args) => actual.openAt(...args),
  fstat: (...args) => actual.fstat(...args),
  list: (...args) => actual.list(...args),
  read: (...args) => { beforeRead(); beforeRead = () => {}; return actual.read(...args); },
  close: (...args) => actual.close(...args),
};
require.cache[nativePath].exports = wrapped;
const { beginSyntheticRoot, enumerateSyntheticRoot, issueSyntheticProjectRead, readSyntheticFile } = await import('../../dist/fixture-discovery.js');
const { openDatabase } = await import('../../dist/storage.js');
const outside = mkdtempSync(join(tmpdir(), 'hark-interleave-proof-'));
const root = beginSyntheticRoot(), db = openDatabase(':memory:');
let session;
try {
  mkdirSync(join(root.setupPath, 'project-a'));
  mkdirSync(join(root.setupPath, 'project-a', 'sub'));
  writeFileSync(join(root.setupPath, 'project-a', 'PROJECT.md'), 'SYNTHETIC');
  writeFileSync(join(root.setupPath, 'project-a', 'sub', 'data.txt'), 'SYNTHETIC_A');
  const now = new Date('2026-11-04T12:00:00Z');
  session = root.commit(db, now, 'never');
  if (session.status !== 'available') throw new Error('Synthetic adapter unavailable');
  const scan = enumerateSyntheticRoot(db, session.handle, now);
  if (!('candidates' in scan)) throw new Error('Synthetic scan unavailable');
  const candidate = scan.candidates.find(item => item.relativePath === 'project-a');
  const granted = issueSyntheticProjectRead(db, session.handle, candidate?.candidateId, now, 'never');
  if (granted.status !== 'available') throw new Error('Synthetic grant unavailable');
  beforeRead = () => {
    renameSync(join(root.setupPath, 'project-a', 'sub'), join(outside, 'moved'));
    writeFileSync(join(outside, 'moved', 'data.txt'), 'SYNTHETIC_B');
  };
  const result = readSyntheticFile(db, session.handle, granted.scope, ['project-a', 'sub', 'data.txt'], 128, now);
  const escaped = result.status === 'available' && result.bytes.toString() === 'SYNTHETIC_B';
  console.log(`high-level read returned synthetic content written outside after the last check: ${escaped}`);
  if (!escaped) throw new Error('Expected interleaving did not reproduce');
} finally {
  beforeRead = () => {};
  if (session?.status === 'available') session.handle.release();
  db.close();
  rmSync(root.setupPath, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}
