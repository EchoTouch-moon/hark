import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { evaluateAdmission } from '../src/policy.js';
import { checkStoredObservation, migrate, openDatabase, transitionRun } from '../src/storage.js';

const grant = { id: 'g', principalId: 'user', projectId: 'A', rootId: 'root', enabled: true, paused: false, expiresAt: '2099-01-01T00:00:00Z', revokedAt: null };
const request = { principalId: 'user', projectId: 'A', rootId: 'root', operation: 'observe' };

describe('fail-closed admission', () => {
  it('allows only matching, enabled observation and denies inactive or mismatched grants', () => {
    expect(evaluateAdmission(request, grant)).toEqual({ allowed: true });
    for (const bad of [{ ...grant, principalId: 'other' }, { ...grant, projectId: 'B' }, { ...grant, rootId: 'other' }, { ...grant, enabled: false }, { ...grant, paused: true }, { ...grant, expiresAt: '2000-01-01T00:00:00Z' }, { ...grant, revokedAt: '2026-11-03T00:00:00Z' }, null]) {
      expect(evaluateAdmission(request, bad).allowed).toBe(false);
    }
  });
  it('denies forged inputs and every unavailable external capability', () => {
    expect(evaluateAdmission({ ...request, approved: true }, grant).allowed).toBe(false);
    for (const operation of ['research', 'model', 'execute']) expect(evaluateAdmission({ ...request, operation }, grant).allowed).toBe(false);
  });
});

describe('database migration and integrity', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  const database = () => { const dir = mkdtempSync(join(tmpdir(), 'hearth-test-')); dirs.push(dir); return join(dir, 'test.db'); };
  it('replays migrations, survives restart and enforces foreign keys, idempotency and append-only audit', () => {
    const path = database();
    let db = openDatabase(path);
    migrate(db);
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toHaveLength(1);
    expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    expect(() => db.prepare("INSERT INTO sources VALUES ('s','missing','fixture','fixture',1)").run()).toThrow();
    db.exec("INSERT INTO projects VALUES ('A','A',''); INSERT INTO candidates VALUES ('c','A','k','candidate','{}'); INSERT INTO cards VALUES ('card','c','proposed','{}'); INSERT INTO runs VALUES ('r','card','a','same-key','queued'); INSERT INTO audit_log VALUES ('l','2026-11-03','test','system','A','{}');");
    expect(() => db.exec("INSERT INTO runs VALUES ('r2','card','a','same-key','queued')")).toThrow();
    expect(() => db.exec("UPDATE audit_log SET actor='other' WHERE id='l'")).toThrow();
    expect(() => db.exec("DELETE FROM audit_log WHERE id='l'")).toThrow();
    expect(() => db.exec("INSERT OR REPLACE INTO audit_log VALUES ('l','2026-11-03','test','other','A','{}')")).toThrow();
    db.exec("INSERT INTO projects VALUES ('B','B',''); INSERT INTO sources VALUES ('s','A','fixture','fixture',1)");
    expect(() => db.exec("INSERT INTO events VALUES ('e','B','s','d','{}')")).toThrow();
    expect(() => transitionRun(db, 'r', 'executing')).toThrow('Execution admission not implemented');
    expect(() => transitionRun(db, 'r', 'completed')).toThrow();
    // Simulate recovery of a previously executing run; production admission remains closed.
    db.exec("UPDATE runs SET state='executing' WHERE id='r'");
    transitionRun(db, 'r', 'verifying');
    expect(() => transitionRun(db, 'r', 'completed')).toThrow();
    db.close();
    db = openDatabase(path);
    expect(db.prepare("SELECT state FROM runs WHERE id='r'").get()?.state).toBe('verifying');
    expect(db.prepare('SELECT count(*) AS n FROM audit_log').get()?.n).toBe(1);
    db.close();
  });
  it('fails closed on an unknown migration and preserves database state', () => {
    const path = database();
    const db = openDatabase(path);
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(2, 'future');
    expect(() => migrate(db)).toThrow('Unknown or non-contiguous');
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toHaveLength(2);
    db.close();
    expect(() => openDatabase(path)).toThrow('Unknown or non-contiguous');
  });
  it('rolls back the migration and version table when a schema change fails', () => {
    const path = database();
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE projects (existing INTEGER)');
    expect(() => migrate(db)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").get()).toBeUndefined();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'projects'").get()?.name).toBe('projects');
    db.close();
  });
  it('reads the persisted grant again and observes revocation even after restarting', () => {
    const path = database();
    let db = openDatabase(path);
    db.exec("INSERT INTO projects VALUES ('A','A',''); INSERT INTO observation_grants VALUES ('g','user','A','root',1,0,'2099-01-01T00:00:00Z',NULL)");
    expect(checkStoredObservation(db, 'g', request).allowed).toBe(true);
    db.exec("UPDATE observation_grants SET revoked_at='2026-11-03T00:00:00Z' WHERE id='g'");
    expect(checkStoredObservation(db, 'g', request).allowed).toBe(false);
    db.close();
    db = openDatabase(path);
    expect(checkStoredObservation(db, 'g', request).allowed).toBe(false);
    expect(checkStoredObservation(db, 'unknown', request).allowed).toBe(false);
    db.close();
  });
});
