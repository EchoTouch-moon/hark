// Synthetic, self-contained reproduction; run after `pnpm build`.
import { mkdtempSync, writeFileSync, linkSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beginSyntheticRoot, enumerateSyntheticRoot, readSyntheticFile, revokeSyntheticRoot } from '../../dist/fixture-discovery.js';
import { listDirectory } from '../../dist/posix-dir-handle.js';
import { openDatabase } from '../../dist/storage.js';

const scratch = mkdtempSync(join(tmpdir(), 'hearth-review-'));
const oldTmp = process.env.TMPDIR;
process.env.TMPDIR = scratch;
try {
  const outside = mkdtempSync(join(scratch, 'outside-'));
  const dbdir = mkdtempSync(join(scratch, 'db-'));
  writeFileSync(join(outside, 'fixture.txt'), 'SYNTHETIC_OUTSIDE_CONTENT');
  const db = openDatabase(join(dbdir, 'fixture.db'));
  try {
    const session = beginSyntheticRoot();
    mkdirSync(join(session.setupPath, 'project-a'));
    writeFileSync(join(session.setupPath, 'project-a', 'local.txt'), 'SYNTHETIC_PROJECT_CONTENT');
    linkSync(join(outside, 'fixture.txt'), join(session.setupPath, 'project-a', 'data.txt'));
    const now = new Date('2026-11-04T12:00:00Z');
    const root = session.commit(db, now, '2099-01-01T00:00:00Z');
    if (root.status !== 'available') {
      console.log(`BLOCKED: adapter ${root.reason}`);
      process.exitCode = 2;
    } else {
      try {
        const result = readSyntheticFile(db, root.handle, ['project-a', 'data.txt'], 1024, now);
        const local = readSyntheticFile(db, root.handle, ['project-a', 'local.txt'], 1024, now);
        const grants = db.prepare('SELECT COUNT(*) AS n FROM observation_grants').get().n;
        const returned = result.status === 'available' && result.bytes.toString() === 'SYNTHETIC_OUTSIDE_CONTENT';
        console.log(`project grants: ${grants}`);
        console.log(`project content returned without project grant: ${local.status === 'available'}`);
        console.log(`hard-linked external synthetic file returned: ${returned}`);
        if (returned || local.status === 'available') process.exitCode = 1;
      } finally { root.handle.release(); }
    }
    const second = beginSyntheticRoot();
    mkdirSync(join(second.setupPath, 'project-b'));
    writeFileSync(join(second.setupPath, 'project-b', 'PROJECT.md'), 'synthetic');
    const secondRoot = second.commit(db, now, '2099-01-01T00:00:00Z');
    if (secondRoot.status !== 'available') {
      console.log(`BLOCKED: second adapter ${secondRoot.reason}`);
      process.exitCode = 2;
    } else {
      try {
        enumerateSyntheticRoot(db, secondRoot.handle, now);
        const project = join(second.setupPath, 'project-b');
        const parked = join(scratch, 'temporarily-moved');
        renameSync(project, parked);
        enumerateSyntheticRoot(db, secondRoot.handle, now);
        renameSync(parked, project);
        try {
          console.log(`returned candidate scan: ${enumerateSyntheticRoot(db, secondRoot.handle, now).status}`);
        } catch (error) {
          console.log(`returned candidate scan throws: ${error.message}`);
          process.exitCode = 1;
        }
      } finally { secondRoot.handle.release(); }
    }
    const third = beginSyntheticRoot();
    mkdirSync(join(third.setupPath, 'project-c'));
    const thirdRoot = third.commit(db, now, '2099-01-01T00:00:00Z');
    if (thirdRoot.status !== 'available') {
      console.log(`BLOCKED: third adapter ${thirdRoot.reason}`);
      process.exitCode = 2;
    } else {
      try {
        revokeSyntheticRoot(db, thirdRoot.rootId, thirdRoot.rootEpoch, now);
        const rawStillUsable = 'names' in listDirectory(thirdRoot.handle.fd);
        console.log(`raw descriptor usable after revocation: ${rawStillUsable}`);
        db.prepare('UPDATE fixture_roots SET revoked_at=NULL, enabled=1 WHERE root_id=? AND root_epoch=?').run(thirdRoot.rootId, thirdRoot.rootEpoch);
        const reactivated = enumerateSyntheticRoot(db, thirdRoot.handle, now).status !== 'unavailable';
        console.log(`database reactivated revoked grant: ${reactivated}`);
        if (rawStillUsable || reactivated) process.exitCode = 1;
      } finally { thirdRoot.handle.release(); }
    }
  } finally { db.close(); }
} finally {
  if (oldTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = oldTmp;
  rmSync(scratch, { recursive: true, force: true });
}
