import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advanceFixtureEpoch, appendFixtureFact, registerFixtureSource } from '../src/fixture-chronicle.js';
import { ingestSyntheticUnderstanding, readSyntheticUnderstanding } from '../src/fixture-understanding.js';
import { openDatabase } from '../src/storage.js';

const scopeA = { principalId: 'demo', projectId: 'project-a', grantId: 'grant-a', rootId: 'synthetic-root' };
const scopeB = { principalId: 'demo', projectId: 'project-b', grantId: 'grant-b', rootId: 'synthetic-root' };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'hearth-understanding-')); dirs.push(dir);
  const path = join(dir, 'demo.sqlite'); const db = openDatabase(path);
  db.exec(`INSERT INTO projects VALUES ('project-a','星光书签','synthetic'), ('project-b','雨滴记录','synthetic');
    INSERT INTO observation_grants VALUES
      ('grant-a','demo','project-a','synthetic-root',1,0,'2099-01-01T00:00:00Z',NULL),
      ('grant-b','demo','project-b','synthetic-root',1,0,'2099-01-01T00:00:00Z',NULL);
    INSERT INTO fixture_project_profiles VALUES
      ('project-a','active','2026-11-04T00:00:00Z'), ('project-b','active','2026-11-04T00:00:00Z');`);
  return { db, path };
}

describe('synthetic understanding backed by Chronicle', () => {
  it('persists project-scoped source references and survives replay and restart', () => {
    const f = setup(); let db = f.db;
    ingestSyntheticUnderstanding(db, scopeA); ingestSyntheticUnderstanding(db, scopeA);
    ingestSyntheticUnderstanding(db, scopeB);
    const a = readSyntheticUnderstanding(db, scopeA);
    expect(a?.synthetic).toBe(true);
    expect(a?.goal?.text).toContain('阅读笔记');
    expect(a?.result?.text).toContain('分类方案');
    expect(a?.todo?.text).toContain('主题筛选');
    expect(a?.goal?.source).toMatchObject({ projectId: 'project-a', sourceId: 'source-project-a-1', synthetic: true });
    expect(a?.inferences).toEqual([]);
    expect(readSyntheticUnderstanding(db, scopeB)?.goal?.text).toContain('天气');
    expect(db.prepare('SELECT count(*) AS n FROM fixture_facts').get()?.n).toBe(6);
    db.close(); db = openDatabase(f.path);
    expect(readSyntheticUnderstanding(db, scopeA)).toEqual(a);
    expect(readSyntheticUnderstanding(db, { ...scopeA, projectId: 'project-b' })).toBeNull();
    db.close();
  });
  it('withholds records after revocation or source epoch changes, including restart', () => {
    const f = setup(); let db = f.db;
    ingestSyntheticUnderstanding(db, scopeA);
    advanceFixtureEpoch(db, scopeA, 'source-project-a-1');
    const stale = readSyntheticUnderstanding(db, scopeA);
    expect(stale?.goal).toBeNull(); expect(stale?.todo).toBeNull();
    ingestSyntheticUnderstanding(db, scopeA);
    expect(readSyntheticUnderstanding(db, scopeA)?.goal?.source.epoch).toBe(1);
    db.exec("UPDATE observation_grants SET revoked_at='2026-11-04T00:00:00Z', enabled=0 WHERE id='grant-a'");
    expect(readSyntheticUnderstanding(db, scopeA)).toBeNull();
    expect(() => ingestSyntheticUnderstanding(db, scopeA)).toThrow();
    db.close(); db = openDatabase(f.path);
    expect(readSyntheticUnderstanding(db, scopeA)).toBeNull(); db.close();
  });
  it('does not invent absent sources, accept forged scope or cross project', () => {
    const { db } = setup();
    expect(readSyntheticUnderstanding(db, scopeA)?.goal).toBeNull();
    expect(readSyntheticUnderstanding(db, { ...scopeA, principalId: 'other' })).toBeNull();
    expect(() => ingestSyntheticUnderstanding(db, { ...scopeA, grantId: 'grant-b' })).toThrow();
    expect(() => ingestSyntheticUnderstanding(db, { ...scopeA, projectId: '../project-a' })).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM fixture_facts').get()?.n).toBe(0);
    db.close();
  });
  it('withholds deleted project profiles and disabled sources', () => {
    const { db } = setup(); ingestSyntheticUnderstanding(db, scopeA);
    db.exec("UPDATE fixture_sources SET enabled=0 WHERE id='source-project-a-1'");
    expect(readSyntheticUnderstanding(db, scopeA)?.goal).toBeNull();
    db.exec("UPDATE fixture_project_profiles SET state='deleting' WHERE project_id='project-a'");
    expect(readSyntheticUnderstanding(db, scopeA)).toBeNull(); db.close();
  });
  it('does not display a fabricated stored fact as fixed source material', () => {
    const { db } = setup(); registerFixtureSource(db, scopeA, 'source-project-a-1');
    appendFixtureFact(db, scopeA, { id: 'project-a-goal-0', projectId: 'project-a', sourceId: 'source-project-a-1', epoch: 0,
      observedAt: '2026-11-04T00:00:00.000Z', summary: 'fabricated', sensitivity: 'public', provenance: 'tool_observed', dedupeKey: 'project-a-goal-0' });
    expect(readSyntheticUnderstanding(db, scopeA)?.goal).toBeNull();
    expect(() => ingestSyntheticUnderstanding(db, scopeA)).toThrow('idempotency conflict');
    db.close();
  });
});
