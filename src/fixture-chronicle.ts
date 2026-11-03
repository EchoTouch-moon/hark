import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { checkStoredObservation } from './storage.js';

// This module stores synthetic records only. It never reads project files or
// verifies that a statement is true. It is not a real observation connector.
// Scope is internal and must be derived from an authenticated server context;
// supplying a principalId is not authentication or authority to create a grant.
const Id = z.string().trim().min(1).max(256);
const Scope = z.object({ principalId: Id, projectId: Id, grantId: Id, rootId: Id }).strict();
type Scope = z.infer<typeof Scope>;
export const FixtureFact = z.object({
  id: Id, projectId: Id, sourceId: Id, epoch: z.number().int().nonnegative().safe(),
  observedAt: z.string().datetime({ offset: true }), summary: z.string().trim().min(1).max(4000),
  sensitivity: z.enum(['public', 'personal', 'restricted']), provenance: z.literal('tool_observed'), dedupeKey: Id,
}).strict();
export type FixtureFact = z.infer<typeof FixtureFact>;

function authorized(db: DatabaseSync, scope: Scope): boolean {
  return checkStoredObservation(db, scope.grantId, {
    principalId: scope.principalId, projectId: scope.projectId, rootId: scope.rootId, operation: 'observe',
  }).allowed;
}

function source(db: DatabaseSync, scope: Scope, sourceId: string) {
  return db.prepare('SELECT epoch, enabled FROM fixture_sources WHERE id = ? AND project_id = ? AND root_id = ? AND grant_id = ?')
    .get(sourceId, scope.projectId, scope.rootId, scope.grantId);
}

// BEGIN IMMEDIATE serializes each grant check with concurrent revocation/reset.
function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function readWithinTransaction(db: DatabaseSync, scope: Scope, sourceId: string, factId: string): FixtureFact | null {
  const current = source(db, scope, sourceId);
  if (!current || current.enabled !== 1) return null;
  const row = db.prepare('SELECT dedupe_key, data_json FROM fixture_facts WHERE id = ? AND project_id = ? AND source_id = ? AND epoch = ?')
    .get(factId, scope.projectId, sourceId, current.epoch as number);
  if (!row || typeof row.data_json !== 'string') return null;
  try {
    const fact = FixtureFact.parse(JSON.parse(row.data_json));
    if (fact.id !== factId || fact.projectId !== scope.projectId || fact.sourceId !== sourceId || fact.epoch !== Number(current.epoch) || fact.dedupeKey !== row.dedupe_key) return null;
    return fact;
  } catch { return null; }
}

/** Internal synchronous composition: scope must be server-authenticated, never from a client. */
export function withFixtureAccess<T>(db: DatabaseSync, rawScope: unknown, work: (scope: Readonly<Scope>, findFact: (sourceId: string, factId: string) => FixtureFact | null) => T): T {
  const scope = Object.freeze(Scope.parse(rawScope));
  return transaction(db, () => {
    if (!authorized(db, scope)) throw new Error('Fixture unavailable');
    let active = true;
    try {
      const result = work(scope, (sourceId, factId) => active ? readWithinTransaction(db, scope, Id.parse(sourceId), Id.parse(factId)) : null);
      if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result) throw new Error('Fixture transactions require synchronous work');
      return result;
    } finally { active = false; }
  });
}

export function registerFixtureSource(db: DatabaseSync, rawScope: unknown, rawSourceId: unknown): void {
  const scope = Scope.parse(rawScope);
  const sourceId = Id.parse(rawSourceId);
  transaction(db, () => {
    if (!authorized(db, scope)) throw new Error('Fixture unavailable');
    db.prepare('INSERT INTO fixture_sources(id, project_id, root_id, grant_id) VALUES (?, ?, ?, ?)')
      .run(sourceId, scope.projectId, scope.rootId, scope.grantId);
  });
}

export function appendFixtureFact(db: DatabaseSync, rawScope: unknown, rawFact: unknown): FixtureFact {
  const scope = Scope.parse(rawScope);
  const fact = FixtureFact.parse(rawFact);
  return transaction(db, () => {
    if (!authorized(db, scope) || fact.projectId !== scope.projectId) throw new Error('Fixture unavailable');
    const current = source(db, scope, fact.sourceId);
    if (!current || current.enabled !== 1 || Number(current.epoch) !== fact.epoch) throw new Error('Fixture unavailable');
    const data = JSON.stringify(fact);
    const existing = db.prepare('SELECT id, data_json FROM fixture_facts WHERE project_id = ? AND source_id = ? AND epoch = ? AND dedupe_key = ?')
      .get(scope.projectId, fact.sourceId, fact.epoch, fact.dedupeKey);
    if (existing) {
      if (existing.id !== fact.id || existing.data_json !== data) throw new Error('Fixture idempotency conflict');
      return fact;
    }
    db.prepare('INSERT INTO fixture_facts(id, project_id, source_id, epoch, dedupe_key, data_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(fact.id, fact.projectId, fact.sourceId, fact.epoch, fact.dedupeKey, data);
    return fact;
  });
}

export function readFixtureFact(db: DatabaseSync, rawScope: unknown, rawSourceId: unknown, rawFactId: unknown): FixtureFact | null {
  const parsedScope = Scope.safeParse(rawScope), parsedSource = Id.safeParse(rawSourceId), parsedId = Id.safeParse(rawFactId);
  if (!parsedScope.success || !parsedSource.success || !parsedId.success) return null;
  const scope = parsedScope.data;
  return transaction(db, () => {
    if (!authorized(db, scope)) return null;
    return readWithinTransaction(db, scope, parsedSource.data, parsedId.data);
  });
}

export function advanceFixtureEpoch(db: DatabaseSync, rawScope: unknown, rawSourceId: unknown): number {
  const scope = Scope.parse(rawScope), sourceId = Id.parse(rawSourceId);
  return transaction(db, () => {
    if (!authorized(db, scope)) throw new Error('Fixture unavailable');
    const current = source(db, scope, sourceId);
    const epoch = Number(current?.epoch);
    if (!current || current.enabled !== 1 || !Number.isSafeInteger(epoch) || epoch >= Number.MAX_SAFE_INTEGER) throw new Error('Fixture unavailable');
    db.prepare('UPDATE fixture_sources SET epoch = ? WHERE id = ? AND project_id = ?').run(epoch + 1, sourceId, scope.projectId);
    return epoch + 1;
  });
}
