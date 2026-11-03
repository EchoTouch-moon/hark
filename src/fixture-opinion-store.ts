import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { Feedback, OpinionBundle, OpinionRevision, Project, ProposedPlan } from './domain-contracts.js';
import { withFixtureAccess, type FixtureFact } from './fixture-chronicle.js';

// Synthetic drafts only: no source connector, model, presentation or executor.
type Revision = z.infer<typeof OpinionRevision>;
type FindFact = (sourceId: string, factId: string) => FixtureFact | null;
const Id = z.string().trim().min(1).max(256);
const Version = z.number().int().nonnegative().safe();
const ChangeReason = z.string().trim().min(1).max(4000);

function projectActive(db: DatabaseSync, projectId: string): boolean {
  return db.prepare("SELECT 1 AS ok FROM fixture_project_profiles WHERE project_id = ? AND state = 'active'").get(projectId) !== undefined;
}

function evidenceMatches(revision: Revision, findFact: FindFact): boolean {
  function find(ref: Revision['counterEvidence'][number]): FixtureFact | null {
    if (ref.kind !== 'observer' || ref.quality !== 'observed') return null;
    const fact = findFact(ref.observerSourceId, ref.eventId);
    if (!fact || fact.projectId !== ref.projectId || fact.epoch !== ref.epoch || fact.observedAt !== ref.observedAt) return null;
    return fact;
  }
  for (const item of revision.facts) {
    const fact = find(item.source);
    if (!fact || item.subject !== 'project' || item.statement !== fact.summary) return false;
  }
  return revision.counterEvidence.every(ref => find(ref) !== null);
}

export function registerFixtureProject(db: DatabaseSync, rawScope: unknown, rawProject: unknown): void {
  const project = Project.parse(rawProject);
  withFixtureAccess(db, rawScope, scope => {
    const row = db.prepare('SELECT name, description FROM projects WHERE id = ?').get(scope.projectId);
    if (project.id !== scope.projectId || project.state !== 'active' || !row || row.name !== project.name || row.description !== project.description) throw new Error('Fixture unavailable');
    db.prepare('INSERT INTO fixture_project_profiles(project_id, state, created_at) VALUES (?, ?, ?)').run(project.id, project.state, project.createdAt);
  });
}

export function saveFixtureOpinion(db: DatabaseSync, rawScope: unknown, rawBundle: unknown, rawExpectedRevision: unknown, rawChangeReason?: unknown): number {
  const bundle = OpinionBundle.parse(rawBundle), expected = Version.parse(rawExpectedRevision);
  if (expected === 0 && rawChangeReason !== undefined) throw new Error('Initial revision has no predecessor');
  const changeReason = expected > 0 ? ChangeReason.parse(rawChangeReason) : null;
  return withFixtureAccess(db, rawScope, (scope, findFact) => {
    const { project, opinion, revision, plan } = bundle;
    const stored = db.prepare('SELECT p.name, p.description, f.state, f.created_at FROM projects p JOIN fixture_project_profiles f ON f.project_id = p.id WHERE p.id = ?').get(scope.projectId);
    if (!stored || stored.state !== 'active' || project.id !== scope.projectId || project.state !== 'active' || project.name !== stored.name || project.description !== stored.description || project.createdAt !== stored.created_at || opinion.status !== 'draft' || bundle.feedback.length !== 0 || revision.version !== expected + 1 || !evidenceMatches(revision, findFact)) throw new Error('Fixture unavailable');
    let previousRevisionId: string | null = null;
    if (expected === 0) {
      db.prepare('INSERT INTO fixture_opinions(id, project_id, topic_key, current_revision) VALUES (?, ?, ?, 0)').run(opinion.id, scope.projectId, opinion.topicKey);
    } else {
      const prior = db.prepare('SELECT topic_key, current_revision FROM fixture_opinions WHERE id = ? AND project_id = ?').get(opinion.id, scope.projectId);
      if (!prior || prior.topic_key !== opinion.topicKey || Number(prior.current_revision) !== expected) throw new Error('Revision conflict');
      const previous = db.prepare('SELECT id FROM fixture_opinion_revisions WHERE opinion_id = ? AND project_id = ? AND version = ?').get(opinion.id, scope.projectId, expected);
      if (!previous || typeof previous.id !== 'string') throw new Error('Revision conflict');
      previousRevisionId = previous.id;
    }
    db.prepare('INSERT INTO fixture_opinion_revisions(id, project_id, opinion_id, version, data_json, previous_revision_id, change_reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(revision.id, scope.projectId, opinion.id, revision.version, JSON.stringify(revision), previousRevisionId, changeReason);
    db.prepare('INSERT INTO fixture_opinion_plans(id, project_id, revision_id, data_json) VALUES (?, ?, ?, ?)')
      .run(plan.id, scope.projectId, revision.id, JSON.stringify(plan));
    const updated = db.prepare('UPDATE fixture_opinions SET current_revision = ? WHERE id = ? AND project_id = ? AND current_revision = ?')
      .run(revision.version, opinion.id, scope.projectId, expected);
    if (Number(updated.changes) !== 1) throw new Error('Revision conflict');
    return revision.version;
  });
}

function loadRevision(db: DatabaseSync, projectId: string, opinionId: string, version: number, findFact: FindFact) {
  if (!projectActive(db, projectId)) return null;
  const row = db.prepare(`SELECT r.id, r.data_json AS revision_json, r.previous_revision_id, r.change_reason, p.id AS plan_id, p.data_json AS plan_json
    FROM fixture_opinion_revisions r JOIN fixture_opinion_plans p ON p.revision_id = r.id AND p.project_id = r.project_id
    WHERE r.project_id = ? AND r.opinion_id = ? AND r.version = ?`).get(projectId, opinionId, version);
  if (!row || typeof row.revision_json !== 'string' || typeof row.plan_json !== 'string') return null;
  try {
    const revision = OpinionRevision.parse(JSON.parse(row.revision_json));
    const plan = ProposedPlan.parse(JSON.parse(row.plan_json));
    if (revision.id !== row.id || revision.projectId !== projectId || revision.opinionId !== opinionId || revision.version !== version || revision.proposedPlanId !== row.plan_id || plan.id !== row.plan_id || plan.revisionId !== revision.id || plan.projectId !== projectId || !evidenceMatches(revision, findFact)) return null;
    let change: { previousRevisionId: string; reason: string } | null = null;
    if (version === 1) {
      if (row.previous_revision_id !== null || row.change_reason !== null) return null;
    } else {
      const previousId = Id.parse(row.previous_revision_id), reason = ChangeReason.parse(row.change_reason);
      const prior = db.prepare('SELECT id FROM fixture_opinion_revisions WHERE id = ? AND project_id = ? AND opinion_id = ? AND version = ?').get(previousId, projectId, opinionId, version - 1);
      if (!prior) return null;
      change = { previousRevisionId: previousId, reason };
    }
    return { revision, plan, change };
  } catch { return null; }
}

export function readFixtureOpinion(db: DatabaseSync, rawScope: unknown, rawOpinionId: unknown, rawVersion: unknown) {
  const opinionId = Id.safeParse(rawOpinionId), version = Version.safeParse(rawVersion);
  if (!opinionId.success || !version.success || version.data === 0) return null;
  try {
    return withFixtureAccess(db, rawScope, (scope, findFact) => {
      const result = loadRevision(db, scope.projectId, opinionId.data, version.data, findFact);
      if (!result) return null;
      const rows = db.prepare('SELECT id, dedupe_key, data_json FROM fixture_opinion_feedback WHERE project_id = ? AND revision_id = ? ORDER BY rowid').all(scope.projectId, result.revision.id);
      try {
        const feedback = rows.map(row => {
          if (typeof row.data_json !== 'string') throw new Error('Invalid fixture');
          const item = Feedback.parse(JSON.parse(row.data_json));
          if (item.id !== row.id || item.projectId !== scope.projectId || item.revisionId !== result.revision.id || typeof row.dedupe_key !== 'string' || !Id.safeParse(row.dedupe_key).success) throw new Error('Invalid fixture');
          return item;
        });
        return { ...result, feedback };
      } catch { return null; }
    });
  } catch { return null; }
}

export function appendFixtureFeedback(db: DatabaseSync, rawScope: unknown, rawFeedback: unknown, rawDedupeKey: unknown) {
  const feedback = Feedback.parse(rawFeedback), dedupeKey = Id.parse(rawDedupeKey);
  return withFixtureAccess(db, rawScope, (scope, findFact) => {
    if (feedback.projectId !== scope.projectId || !projectActive(db, scope.projectId)) throw new Error('Fixture unavailable');
    const ref = db.prepare('SELECT opinion_id, version FROM fixture_opinion_revisions WHERE id = ? AND project_id = ?').get(feedback.revisionId, scope.projectId);
    if (!ref || typeof ref.opinion_id !== 'string' || !loadRevision(db, scope.projectId, ref.opinion_id, Number(ref.version), findFact)) throw new Error('Fixture unavailable');
    const data = JSON.stringify(feedback);
    const existing = db.prepare('SELECT id, revision_id, data_json FROM fixture_opinion_feedback WHERE project_id = ? AND dedupe_key = ?').get(scope.projectId, dedupeKey);
    if (existing) {
      if (existing.id !== feedback.id || existing.revision_id !== feedback.revisionId || existing.data_json !== data) throw new Error('Fixture idempotency conflict');
      return feedback;
    }
    db.prepare('INSERT INTO fixture_opinion_feedback(id, project_id, revision_id, dedupe_key, data_json) VALUES (?, ?, ?, ?, ?)')
      .run(feedback.id, scope.projectId, feedback.revisionId, dedupeKey, data);
    return feedback;
  });
}
