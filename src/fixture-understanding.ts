import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { appendFixtureFact, registerFixtureSource, withFixtureAccess } from './fixture-chronicle.js';
import { getSyntheticProject } from './synthetic-catalog.js';

// Internal server-derived scope only. This is a projection of fixed fiction,
// not an observation of a real project or an authentication mechanism.
const Id = z.string().trim().min(1).max(256);
const Scope = z.object({ principalId: Id, projectId: Id, grantId: Id, rootId: Id }).strict();
const observedAt = '2026-11-04T00:00:00.000Z';
const labels = { goal: '目标', result: '成果', todo: '待办' } as const;
type Key = keyof typeof labels;
type Item = { text: string; source: { projectId: string; sourceId: string; factId: string; epoch: number; observedAt: string; synthetic: true } };

function factId(projectId: string, key: Key, epoch: number): string { return `${projectId}-${key}-${epoch}`; }
function extract(text: string, label: string): string | null {
  const matches = text.split('\n').filter(line => line.startsWith(`${label}：`));
  if (matches.length !== 1) return null;
  return matches[0]!.slice(label.length + 1).trim() || null;
}

/** Explicit ingestion, never called by GET. Replay is idempotent per source epoch. */
export function ingestSyntheticUnderstanding(db: DatabaseSync, rawScope: unknown): void {
  const scope = Scope.parse(rawScope), project = getSyntheticProject(scope.projectId);
  if (!project) throw new Error('Fixture unavailable');
  const sourceId = project.source.id;
  const exists = withFixtureAccess(db, scope, () => db.prepare('SELECT project_id, root_id, grant_id FROM fixture_sources WHERE id = ?').get(sourceId));
  if (!exists) registerFixtureSource(db, scope, sourceId);
  const epoch = withFixtureAccess(db, scope, () => {
    const row = db.prepare('SELECT epoch, enabled FROM fixture_sources WHERE id = ? AND project_id = ? AND root_id = ? AND grant_id = ?')
      .get(sourceId, scope.projectId, scope.rootId, scope.grantId);
    if (!row || row.enabled !== 1 || !Number.isSafeInteger(Number(row.epoch)) || Number(row.epoch) < 0) throw new Error('Fixture unavailable');
    return Number(row.epoch);
  });
  for (const key of Object.keys(labels) as Key[]) {
    const summary = extract(project.source.text, labels[key]);
    if (!summary) continue;
    const id = factId(project.id, key, epoch);
    appendFixtureFact(db, scope, { id, projectId: project.id, sourceId, epoch, observedAt, summary,
      sensitivity: 'public', provenance: 'tool_observed', dedupeKey: id });
  }
}

/** A missing, disabled or stale source remains unknown; never fabricate a value. */
export function readSyntheticUnderstanding(db: DatabaseSync, rawScope: unknown): {
  synthetic: true; projectId: string; goal: Item | null; result: Item | null; todo: Item | null; inferences: [];
} | null {
  const parsed = Scope.safeParse(rawScope);
  if (!parsed.success) return null;
  const scope = parsed.data, project = getSyntheticProject(scope.projectId);
  if (!project) return null;
  try {
    return withFixtureAccess(db, scope, (_scope, findFact) => {
      const active = db.prepare("SELECT 1 AS ok FROM fixture_project_profiles WHERE project_id = ? AND state = 'active'").get(scope.projectId);
      if (!active) return null;
      const row = db.prepare('SELECT epoch, enabled FROM fixture_sources WHERE id = ? AND project_id = ? AND root_id = ? AND grant_id = ?')
        .get(project.source.id, scope.projectId, scope.rootId, scope.grantId);
      const epoch = row?.enabled === 1 && Number.isSafeInteger(Number(row.epoch)) ? Number(row.epoch) : -1;
      const item = (key: Key): Item | null => {
        if (epoch < 0) return null;
        const fact = findFact(project.source.id, factId(project.id, key, epoch));
        if (!fact || fact.summary !== extract(project.source.text, labels[key]) || fact.observedAt !== observedAt) return null;
        return { text: fact.summary, source: { projectId: fact.projectId, sourceId: fact.sourceId, factId: fact.id, epoch: fact.epoch, observedAt: fact.observedAt, synthetic: true } };
      };
      return { synthetic: true, projectId: project.id, goal: item('goal'), result: item('result'), todo: item('todo'), inferences: [] };
    });
  } catch { return null; }
}
