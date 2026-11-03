import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, openDatabase } from '../src/storage.js';
import { advanceFixtureEpoch, appendFixtureFact, readFixtureFact, registerFixtureSource, withFixtureAccess } from '../src/fixture-chronicle.js';

// These fixture records are deliberately fabricated and never read a user project.
const scopeA = { principalId: 'user', projectId: 'A', grantId: 'gA', rootId: 'rootA' };
const scopeB = { principalId: 'user', projectId: 'B', grantId: 'gB', rootId: 'rootB' };
const factA = {
  id: 'fact-a', projectId: 'A', sourceId: 'source-a', epoch: 0,
  observedAt: '2026-11-03T12:00:00.000Z', summary: 'synthetic',
  sensitivity: 'personal', provenance: 'tool_observed', dedupeKey: 'key-a',
};
const factB = { ...factA, id: 'fact-b', projectId: 'B', sourceId: 'source-b', dedupeKey: 'key-b' };

describe('synthetic project observation persistence', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'hearth-chronicle-test-'));
    dirs.push(dir);
    const path = join(dir, 'synthetic.sqlite');
    const db = openDatabase(path);
    db.exec(`INSERT INTO projects VALUES ('A','Synthetic A',''), ('B','Synthetic B','');
      INSERT INTO observation_grants VALUES
        ('gA','user','A','rootA',1,0,'2099-01-01T00:00:00Z',NULL),
        ('gB','user','B','rootB',1,0,'2099-01-01T00:00:00Z',NULL);`);
    registerFixtureSource(db, scopeA, 'source-a');
    registerFixtureSource(db, scopeB, 'source-b');
    return { db, path };
  }

  it('upgrades a populated v1 database and replays v2 without losing prior data', () => {
    const fixtureDb = fixture();
    let db = fixtureDb.db;
    db.exec(`INSERT INTO audit_log VALUES ('audit-1','2026-11-03','synthetic','user','A','{}');
      DROP TABLE fixture_opinion_feedback; DROP TABLE fixture_opinion_plans; DROP TABLE fixture_opinion_revisions;
      DROP TABLE fixture_opinions; DROP TABLE fixture_project_profiles;
      DROP TABLE fixture_facts; DROP TABLE fixture_sources; DROP INDEX observation_grants_scope;
      DELETE FROM schema_migrations WHERE version>=2;`);
    db.close();
    db = openDatabase(fixtureDb.path);
    migrate(db);
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    expect(db.prepare("SELECT name FROM projects WHERE id='A'").get()?.name).toBe('Synthetic A');
    expect(db.prepare("SELECT object_id FROM audit_log WHERE id='audit-1'").get()?.object_id).toBe('A');
    expect(db.prepare("SELECT principal_id FROM observation_grants WHERE id='gA'").get()?.principal_id).toBe('user');
    registerFixtureSource(db, scopeA, 'source-after-upgrade');
    const upgradedFact = { ...factA, sourceId: 'source-after-upgrade' };
    expect(appendFixtureFact(db, scopeA, upgradedFact)).toEqual(upgradedFact);
    db.close();
  });

  it('keeps observations associated with their project after restart', () => {
    const fixtureDb = fixture();
    let db = fixtureDb.db;
    expect(appendFixtureFact(db, scopeA, factA)).toEqual(factA);
    expect(appendFixtureFact(db, scopeB, factB)).toEqual(factB);
    db.close();
    db = openDatabase(fixtureDb.path);
    expect(readFixtureFact(db, scopeA, 'source-a', 'fact-a')).toEqual(factA);
    expect(readFixtureFact(db, scopeB, 'source-b', 'fact-b')).toEqual(factB);
    expect(readFixtureFact(db, scopeA, 'source-b', 'fact-b')).toBeNull();
    expect(readFixtureFact(db, scopeB, 'source-a', 'fact-a')).toBeNull();
    db.close();
  });

  it('does not let a transactional source lookup escape the grant check', () => {
    const { db } = fixture();
    appendFixtureFact(db, scopeA, factA);
    const escaped = withFixtureAccess(db, scopeA, (scope, findFact) => {
      expect(() => Object.assign(scope, scopeB)).toThrow();
      expect(findFact('source-a', 'fact-a')).toEqual(factA);
      return findFact;
    });
    expect(escaped('source-a', 'fact-a')).toBeNull();
    expect(() => withFixtureAccess(db, scopeA, async () => 'not synchronous')).toThrow('synchronous');
    db.close();
  });

  it('rejects forged project, principal, grant or root for reading and writing', () => {
    const { db } = fixture();
    appendFixtureFact(db, scopeA, factA);
    for (const invalidScope of [
      { ...scopeA, principalId: 'other' },
      { ...scopeA, projectId: 'B' },
      { ...scopeA, grantId: 'gB' },
      { ...scopeA, rootId: 'rootB' },
    ]) {
      expect(readFixtureFact(db, invalidScope, 'source-a', 'fact-a')).toBeNull();
      expect(() => appendFixtureFact(db, invalidScope, { ...factA, id: 'attacker', dedupeKey: 'attacker' })).toThrow();
    }
    expect(() => appendFixtureFact(db, scopeA, { ...factA, projectId: 'B', id: 'cross', dedupeKey: 'cross' })).toThrow();
    expect(() => appendFixtureFact(db, scopeA, { ...factA, sourceId: 'source-b', id: 'cross', dedupeKey: 'cross' })).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS count FROM fixture_facts').get()?.count).toBe(1);
    db.close();
  });

  it.each([
    ['revoked', "UPDATE observation_grants SET revoked_at='2026-11-03T00:00:00Z' WHERE id='gA'"],
    ['paused', "UPDATE observation_grants SET paused=1 WHERE id='gA'"],
    ['disabled', "UPDATE observation_grants SET enabled=0 WHERE id='gA'"],
    ['expired', "UPDATE observation_grants SET expires_at='2000-01-01T00:00:00Z' WHERE id='gA'"],
  ])('rechecks a %s grant before every operation, including after restart', (_label, sql) => {
    const fixtureDb = fixture();
    let db = fixtureDb.db;
    appendFixtureFact(db, scopeA, factA);
    db.exec(sql);
    expect(readFixtureFact(db, scopeA, 'source-a', 'fact-a')).toBeNull();
    expect(() => appendFixtureFact(db, scopeA, { ...factA, id: 'after', dedupeKey: 'after' })).toThrow();
    expect(() => advanceFixtureEpoch(db, scopeA, 'source-a')).toThrow();
    db.close();
    db = openDatabase(fixtureDb.path);
    expect(readFixtureFact(db, scopeA, 'source-a', 'fact-a')).toBeNull();
    db.close();
  });

  it('withholds prior epochs while keeping their records and accepting new observations', () => {
    const { db } = fixture();
    appendFixtureFact(db, scopeA, factA);
    expect(advanceFixtureEpoch(db, scopeA, 'source-a')).toBe(1);
    expect(readFixtureFact(db, scopeA, 'source-a', 'fact-a')).toBeNull();
    expect(() => appendFixtureFact(db, scopeA, { ...factA, id: 'old', dedupeKey: 'old' })).toThrow();
    const fresh = { ...factA, id: 'fact-a2', epoch: 1 };
    expect(appendFixtureFact(db, scopeA, fresh)).toEqual(fresh);
    expect(readFixtureFact(db, scopeA, 'source-a', 'fact-a2')).toEqual(fresh);
    expect(db.prepare('SELECT COUNT(*) AS count FROM fixture_facts').get()?.count).toBe(2);
    db.close();
  });

  it('accepts an exact replay only and protects the stored observation from mutation', () => {
    const { db } = fixture();
    expect(appendFixtureFact(db, scopeA, factA)).toEqual(factA);
    expect(appendFixtureFact(db, scopeA, { ...factA })).toEqual(factA);
    expect(() => appendFixtureFact(db, scopeA, { ...factA, summary: 'changed' })).toThrow();
    expect(() => appendFixtureFact(db, scopeA, { ...factA, id: 'other-id' })).toThrow();
    expect(() => appendFixtureFact(db, scopeA, { ...factA, dedupeKey: 'other-key' })).toThrow();
    expect(() => db.exec("UPDATE fixture_facts SET data_json='{}' WHERE id='fact-a'")).toThrow();
    expect(() => db.exec("DELETE FROM fixture_facts WHERE id='fact-a'")).toThrow();
    expect(() => db.exec("INSERT OR REPLACE INTO fixture_facts SELECT * FROM fixture_facts WHERE id='fact-a'")).toThrow();
    expect(readFixtureFact(db, scopeA, 'source-a', 'fact-a')).toEqual(factA);
    expect(db.prepare('SELECT COUNT(*) AS count FROM fixture_facts').get()?.count).toBe(1);
    db.close();
  });

  it('fails closed on disabled sources and malformed synthetic records', () => {
    const { db } = fixture();
    for (const invalid of [
      { ...factA, observedAt: 'not-a-time' },
      { ...factA, summary: '' },
      { ...factA, epoch: -1 },
      { ...factA, provenance: 'model_inferred' },
      { ...factA, unauthorized: true },
    ]) expect(() => appendFixtureFact(db, scopeA, invalid)).toThrow();
    appendFixtureFact(db, scopeA, factA);
    db.exec("UPDATE fixture_sources SET enabled=0 WHERE id='source-a'");
    expect(readFixtureFact(db, scopeA, 'source-a', 'fact-a')).toBeNull();
    expect(() => appendFixtureFact(db, scopeA, { ...factA, id: 'next', dedupeKey: 'next' })).toThrow();
    db.close();
  });

  it('does not serve corrupted persisted data as an authorized observation', () => {
    const { db } = fixture();
    const insert = db.prepare('INSERT INTO fixture_facts(id,project_id,source_id,epoch,dedupe_key,data_json) VALUES (?,?,?,?,?,?)');
    insert.run('invalid-json', 'A', 'source-a', 0, 'key-1', '{');
    insert.run('wrong-project', 'A', 'source-a', 0, 'key-2', JSON.stringify({ ...factA, id: 'wrong-project', projectId: 'B', dedupeKey: 'key-2' }));
    insert.run('wrong-epoch', 'A', 'source-a', 0, 'key-3', JSON.stringify({ ...factA, id: 'wrong-epoch', epoch: 1, dedupeKey: 'key-3' }));
    insert.run('wrong-id', 'A', 'source-a', 0, 'key-4', JSON.stringify({ ...factA, id: 'some-other-id', dedupeKey: 'key-4' }));
    insert.run('wrong-key', 'A', 'source-a', 0, 'key-5', JSON.stringify({ ...factA, id: 'wrong-key', dedupeKey: 'another-key' }));
    for (const id of ['invalid-json', 'wrong-project', 'wrong-epoch', 'wrong-id', 'wrong-key']) {
      expect(readFixtureFact(db, scopeA, 'source-a', id), id).toBeNull();
    }
    db.close();
  });

  it('rejects replay when persisted identity disagrees with its stored JSON', () => {
    const { db } = fixture();
    const forged = { ...factA, id: 'claimed-id', dedupeKey: 'corrupt-key' };
    db.prepare('INSERT INTO fixture_facts(id,project_id,source_id,epoch,dedupe_key,data_json) VALUES (?,?,?,?,?,?)')
      .run('different-id', 'A', 'source-a', 0, 'corrupt-key', JSON.stringify(forged));
    expect(() => appendFixtureFact(db, scopeA, forged)).toThrow();
    expect(readFixtureFact(db, scopeA, 'source-a', 'claimed-id')).toBeNull();
    db.close();
  });
});
