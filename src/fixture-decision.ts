import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { FixtureDecision, withFixtureAccess } from './fixture-chronicle.js';

const Id = z.string().trim().min(1).max(256);
const Version = z.number().int().positive().safe();

/** Synthetic user choice. Caller identity must be established by a trusted server. */
export function recordFixtureDecision(db: DatabaseSync, rawScope: unknown, rawDecision: unknown): FixtureDecision {
  const decision = FixtureDecision.parse(rawDecision);
  return withFixtureAccess(db, rawScope, scope => {
    const project = db.prepare("SELECT 1 AS ok FROM fixture_project_profiles WHERE project_id = ? AND state = 'active'").get(scope.projectId);
    if (!project || decision.projectId !== scope.projectId) throw new Error('Fixture unavailable');
    const existing = db.prepare('SELECT root_id, grant_id, statement, recorded_at, status FROM fixture_decisions WHERE id = ? AND project_id = ? AND revision = ?')
      .get(decision.id, scope.projectId, decision.revision);
    if (existing) {
      if (existing.root_id !== scope.rootId || existing.grant_id !== scope.grantId || existing.statement !== decision.statement || existing.recorded_at !== decision.recordedAt || existing.status !== 'active') throw new Error('Fixture decision conflict');
      return decision;
    }
    const previous = db.prepare('SELECT root_id, grant_id, revision FROM fixture_decisions WHERE id = ? AND project_id = ? ORDER BY revision DESC LIMIT 1')
      .get(decision.id, scope.projectId);
    const expected = previous ? Number(previous.revision) + 1 : 1;
    if (decision.revision !== expected || (previous && (previous.root_id !== scope.rootId || previous.grant_id !== scope.grantId))) throw new Error('Fixture decision conflict');
    db.prepare("UPDATE fixture_decisions SET status = 'superseded' WHERE id = ? AND project_id = ? AND status = 'active'")
      .run(decision.id, scope.projectId);
    db.prepare('INSERT INTO fixture_decisions(id, project_id, root_id, grant_id, revision, statement, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(decision.id, scope.projectId, scope.rootId, scope.grantId, decision.revision, decision.statement, decision.recordedAt);
    return decision;
  });
}

export function withdrawFixtureDecision(db: DatabaseSync, rawScope: unknown, rawId: unknown, rawRevision: unknown): void {
  const id = Id.parse(rawId), revision = Version.parse(rawRevision);
  withFixtureAccess(db, rawScope, scope => {
    const project = db.prepare("SELECT 1 AS ok FROM fixture_project_profiles WHERE project_id = ? AND state = 'active'").get(scope.projectId);
    if (!project) throw new Error('Fixture unavailable');
    const updated = db.prepare("UPDATE fixture_decisions SET status = 'withdrawn' WHERE id = ? AND project_id = ? AND root_id = ? AND grant_id = ? AND revision = ? AND status = 'active'")
      .run(id, scope.projectId, scope.rootId, scope.grantId, revision);
    if (Number(updated.changes) !== 1) throw new Error('Fixture unavailable');
  });
}

export function readFixtureDecision(db: DatabaseSync, rawScope: unknown, rawId: unknown, rawRevision: unknown): FixtureDecision | null {
  const id = Id.safeParse(rawId), revision = Version.safeParse(rawRevision);
  if (!id.success || !revision.success) return null;
  try { return withFixtureAccess(db, rawScope, (_scope, _findFact, findDecision) => findDecision(id.data, revision.data)); }
  catch { return null; }
}
