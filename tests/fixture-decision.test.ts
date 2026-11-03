import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/storage.js';
import { registerFixtureProject } from '../src/fixture-opinion-store.js';
import { readFixtureDecision, recordFixtureDecision, withdrawFixtureDecision } from '../src/fixture-decision.js';

// All projects, grants, and decisions below are synthetic.
const timestamp = '2026-11-03T12:00:00Z';
const scopeA = { principalId: 'user', projectId: 'A', grantId: 'gA', rootId: 'rootA' };
const scopeB = { principalId: 'user', projectId: 'B', grantId: 'gB', rootId: 'rootB' };
const scopeC = { principalId: 'user', projectId: 'C', grantId: 'gC', rootId: 'rootC' };
const projectA = { id: 'A', name: 'Synthetic A', description: '', state: 'active', createdAt: timestamp };
const projectB = { id: 'B', name: 'Synthetic B', description: '', state: 'active', createdAt: timestamp };
const first = { id: 'decision-a', projectId: 'A', revision: 1, statement: 'synthetic user choice', recordedAt: timestamp };
const second = { ...first, revision: 2, statement: 'synthetic revised choice' };
const decisionB = { ...first, id: 'decision-b', projectId: 'B', statement: 'another synthetic choice' };

describe('fixture user decisions', () => {
  const dirs: string[] = [];
  const handles = new Set<DatabaseSync>();
  afterEach(() => {
    for (const db of handles) db.close();
    handles.clear();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function open(path: string) {
    const db = openDatabase(path);
    handles.add(db);
    return db;
  }
  function close(db: DatabaseSync) { db.close(); handles.delete(db); }
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'hearth-decision-'));
    dirs.push(dir);
    const path = join(dir, 'synthetic.sqlite');
    const db = open(path);
    db.exec(`INSERT INTO projects VALUES ('A','Synthetic A',''), ('B','Synthetic B',''), ('C','Synthetic C','');
      INSERT INTO observation_grants VALUES
        ('gA','user','A','rootA',1,0,'2099-01-01T00:00:00Z',NULL),
        ('gB','user','B','rootB',1,0,'2099-01-01T00:00:00Z',NULL),
        ('gC','user','C','rootC',1,0,'2099-01-01T00:00:00Z',NULL);`);
    registerFixtureProject(db, scopeA, projectA);
    registerFixtureProject(db, scopeB, projectB);
    return { db, path };
  }

  it('records a user choice idempotently and preserves it across restart', () => {
    const setup = fixture();
    let db = setup.db;
    recordFixtureDecision(db, scopeA, first);
    recordFixtureDecision(db, scopeA, { ...first });
    expect(readFixtureDecision(db, scopeA, first.id, 1)).toEqual(first);
    expect(db.prepare('SELECT COUNT(*) AS n FROM fixture_decisions').get()?.n).toBe(1);
    close(db);
    db = open(setup.path);
    expect(readFixtureDecision(db, scopeA, first.id, 1)).toEqual(first);
  });

  it('rejects changed data for the same decision and revision without overwriting', () => {
    const { db } = fixture();
    recordFixtureDecision(db, scopeA, first);
    expect(() => recordFixtureDecision(db, scopeA, { ...first, statement: 'different' })).toThrow();
    expect(() => recordFixtureDecision(db, scopeA, { ...first, recordedAt: '2026-11-04T12:00:00Z' })).toThrow();
    expect(readFixtureDecision(db, scopeA, first.id, 1)).toEqual(first);
    expect(db.prepare('SELECT COUNT(*) AS n FROM fixture_decisions').get()?.n).toBe(1);
  });

  it('keeps versions sequential and withholds a superseded choice', () => {
    const { db } = fixture();
    expect(() => recordFixtureDecision(db, scopeA, second)).toThrow();
    expect(() => recordFixtureDecision(db, scopeA, { ...first, revision: 3 })).toThrow();
    recordFixtureDecision(db, scopeA, first);
    expect(() => recordFixtureDecision(db, scopeA, { ...first, revision: 3 })).toThrow();
    expect(readFixtureDecision(db, scopeA, first.id, 1)).toEqual(first);
    recordFixtureDecision(db, scopeA, second);
    expect(readFixtureDecision(db, scopeA, first.id, 1)).toBeNull();
    expect(readFixtureDecision(db, scopeA, first.id, 2)).toEqual(second);
    expect(() => recordFixtureDecision(db, scopeA, { ...first, revision: 4 })).toThrow();
    expect(db.prepare('SELECT revision, status FROM fixture_decisions WHERE id=? ORDER BY revision').all(first.id)).toEqual([
      { revision: 1, status: 'superseded' }, { revision: 2, status: 'active' },
    ]);
  });

  it('isolates A and B even if a request supplies another project or grant', () => {
    const { db } = fixture();
    recordFixtureDecision(db, scopeA, first);
    recordFixtureDecision(db, scopeB, decisionB);
    expect(readFixtureDecision(db, scopeA, decisionB.id, 1)).toBeNull();
    expect(readFixtureDecision(db, scopeB, first.id, 1)).toBeNull();
    expect(readFixtureDecision(db, { ...scopeA, principalId: 'other' }, first.id, 1)).toBeNull();
    expect(readFixtureDecision(db, { ...scopeA, projectId: 'B' }, first.id, 1)).toBeNull();
    expect(readFixtureDecision(db, { ...scopeA, grantId: 'gB' }, first.id, 1)).toBeNull();
    expect(readFixtureDecision(db, { ...scopeA, rootId: 'rootB' }, first.id, 1)).toBeNull();
    expect(() => recordFixtureDecision(db, scopeA, decisionB)).toThrow();
    expect(() => withdrawFixtureDecision(db, scopeB, first.id, 1)).toThrow();
    expect(readFixtureDecision(db, scopeA, first.id, 1)).toEqual(first);
  });

  it.each([
    ['revoked', "UPDATE observation_grants SET revoked_at='2026-11-03T00:00:00Z' WHERE id='gA'"],
    ['paused', "UPDATE observation_grants SET paused=1 WHERE id='gA'"],
    ['disabled', "UPDATE observation_grants SET enabled=0 WHERE id='gA'"],
    ['expired', "UPDATE observation_grants SET expires_at='2000-01-01T00:00:00Z' WHERE id='gA'"],
  ])('denies read and writes when the persisted grant is %s, including after restart', (_label, sql) => {
    const setup = fixture();
    let db = setup.db;
    recordFixtureDecision(db, scopeA, first);
    db.exec(sql);
    expect(readFixtureDecision(db, scopeA, first.id, 1)).toBeNull();
    expect(() => recordFixtureDecision(db, scopeA, second)).toThrow();
    expect(() => withdrawFixtureDecision(db, scopeA, first.id, 1)).toThrow();
    close(db);
    db = open(setup.path);
    expect(readFixtureDecision(db, scopeA, first.id, 1)).toBeNull();
  });

  it('withdraws only the current active decision and keeps its history unavailable', () => {
    const setup = fixture();
    let db = setup.db;
    recordFixtureDecision(db, scopeA, first);
    recordFixtureDecision(db, scopeA, second);
    expect(() => withdrawFixtureDecision(db, scopeA, first.id, 1)).toThrow();
    expect(readFixtureDecision(db, scopeA, first.id, 2)).toEqual(second);
    withdrawFixtureDecision(db, scopeA, first.id, 2);
    expect(readFixtureDecision(db, scopeA, first.id, 2)).toBeNull();
    expect(() => withdrawFixtureDecision(db, scopeA, first.id, 2)).toThrow();
    expect(db.prepare('SELECT revision, status FROM fixture_decisions WHERE id=? ORDER BY revision').all(first.id)).toEqual([
      { revision: 1, status: 'superseded' }, { revision: 2, status: 'withdrawn' },
    ]);
    close(db);
    db = open(setup.path);
    expect(readFixtureDecision(db, scopeA, first.id, 1)).toBeNull();
    expect(readFixtureDecision(db, scopeA, first.id, 2)).toBeNull();
  });

  it('requires a registered active project and rejects invalid inputs', () => {
    const { db } = fixture();
    expect(() => recordFixtureDecision(db, scopeC, { ...first, id: 'decision-c', projectId: 'C' })).toThrow();
    for (const value of [
      { ...first, revision: 0 }, { ...first, revision: -1 }, { ...first, statement: '' },
      { ...first, recordedAt: 'not-a-date' }, { ...first, status: 'active' },
    ]) expect(() => recordFixtureDecision(db, scopeA, value)).toThrow();
    recordFixtureDecision(db, scopeA, first);
    db.exec("UPDATE fixture_project_profiles SET state='deleting' WHERE project_id='A'");
    expect(readFixtureDecision(db, scopeA, first.id, 1)).toBeNull();
    expect(() => recordFixtureDecision(db, scopeA, second)).toThrow();
    expect(() => withdrawFixtureDecision(db, scopeA, first.id, 1)).toThrow();
  });

  it('protects decision content, identity and terminal statuses from direct SQL changes', () => {
    const { db } = fixture();
    recordFixtureDecision(db, scopeA, first);
    expect(() => db.exec("UPDATE fixture_decisions SET statement='tampered' WHERE id='decision-a'")).toThrow();
    expect(() => db.exec("UPDATE fixture_decisions SET project_id='B' WHERE id='decision-a'")).toThrow();
    expect(() => db.exec("UPDATE fixture_decisions SET revision=42 WHERE id='decision-a'")).toThrow();
    expect(() => db.exec("DELETE FROM fixture_decisions WHERE id='decision-a'")).toThrow();
    expect(() => db.exec("INSERT OR REPLACE INTO fixture_decisions SELECT * FROM fixture_decisions WHERE id='decision-a'")).toThrow();
    recordFixtureDecision(db, scopeA, second);
    expect(() => db.exec("UPDATE fixture_decisions SET status='active' WHERE id='decision-a' AND revision=1")).toThrow();
    withdrawFixtureDecision(db, scopeA, first.id, 2);
    expect(() => db.exec("UPDATE fixture_decisions SET status='active' WHERE id='decision-a' AND revision=2")).toThrow();
    expect(() => db.exec("UPDATE fixture_decisions SET status='withdrawn' WHERE id='decision-a' AND revision=1")).toThrow();
  });

  it('upgrades a populated v3 database to v4 without losing existing project records', () => {
    const setup = fixture();
    let db = setup.db;
    db.exec('DROP TABLE fixture_decisions; DELETE FROM schema_migrations WHERE version=4;');
    close(db);
    db = open(setup.path);
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
    expect(db.prepare("SELECT name FROM projects WHERE id='A'").get()?.name).toBe('Synthetic A');
    recordFixtureDecision(db, scopeA, first);
    expect(readFixtureDecision(db, scopeA, first.id, 1)).toEqual(first);
  });
});
