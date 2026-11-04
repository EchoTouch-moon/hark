import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/storage.js';
import { ingestSyntheticUnderstanding } from '../src/fixture-understanding.js';
import { readSyntheticInventory } from '../src/fixture-global-inventory.js';

const a = { principalId: 'demo', projectId: 'project-a', grantId: 'grant-a', rootId: 'synthetic-root' };
const b = { principalId: 'demo', projectId: 'project-b', grantId: 'grant-b', rootId: 'synthetic-root' };
function setup() {
  const db = openDatabase(':memory:');
  db.exec(`INSERT INTO projects VALUES ('project-a','星光书签','synthetic'), ('project-b','雨滴记录','synthetic');
    INSERT INTO observation_grants VALUES ('grant-a','demo','project-a','synthetic-root',1,0,'2099-01-01T00:00:00Z',NULL),
    ('grant-b','demo','project-b','synthetic-root',1,0,'2099-01-01T00:00:00Z',NULL);
    INSERT INTO fixture_project_profiles VALUES ('project-a','active','2026-11-04T00:00:00Z'), ('project-b','active','2026-11-04T00:00:00Z');`);
  return db;
}
describe('synthetic global inventory', () => {
  it('reports coverage without joining or leaking unauthorized project material', () => {
    const db = setup(); ingestSyntheticUnderstanding(db, a);
    const before = readSyntheticInventory(db, [a, b]);
    expect(before.projects.map(p => [p.id, p.coverage])).toEqual([['project-a', 'available'], ['project-b', 'incomplete']]);
    expect(before.unassigned[0]?.attribution).toBe('unknown');
    db.exec("UPDATE observation_grants SET revoked_at='2026-11-04T00:00:00Z', enabled=0 WHERE id='grant-a'");
    const after = readSyntheticInventory(db, [a, b]);
    expect(after.projects.map(p => p.id)).toEqual(['project-b']);
    expect(after.unavailableCount).toBe(1);
    expect(JSON.stringify(after)).not.toContain('阅读笔记');
    db.close();
  });
  it('rejects duplicated or malformed internal scopes and does not elevate an invented grant', () => {
    const db = setup(); ingestSyntheticUnderstanding(db, a);
    expect(() => readSyntheticInventory(db, [a, a])).toThrow();
    expect(() => readSyntheticInventory(db, [{ ...a, path: '/tmp' }])).toThrow();
    const result = readSyntheticInventory(db, [{ ...a, grantId: 'wrong' }]);
    expect(result.projects).toEqual([]); expect(result.unavailableCount).toBe(2);
    db.close();
  });
});
