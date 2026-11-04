import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFixtureOpinion, saveFixtureOpinion } from '../fixture-opinion-store.js';
import { ModelError } from './types.js';
import type { BoundEvidence } from './output.js';

type Scope = { principalId: string; projectId: string; grantId: string; rootId: string };
interface DraftResult { suggestedOpinion: { statement: string; uncertainties: string[] } | null; evidence: BoundEvidence[]; }

/** A model answer never becomes a fact. This writes a draft only after an explicit save request. */
export function saveModelOpinionDraft(db: DatabaseSync, scope: Scope, runId: string, result: DraftResult, now: string): { opinionId: string; version: number; synthetic: true; verified: false } {
  const existing = db.prepare('SELECT opinion_id FROM model_opinion_links WHERE run_id=? AND project_id=?').get(runId, scope.projectId);
  if (existing && typeof existing.opinion_id === 'string') {
    const saved = readFixtureOpinion(db, scope, existing.opinion_id, 1);
    if (!saved) throw new ModelError('rejected', '观点草案不可用', 403);
    return { opinionId: existing.opinion_id, version: saved.revision.version, synthetic: true, verified: false };
  }
  if (!result.suggestedOpinion || result.evidence.length === 0) throw new ModelError('rejected', '没有可保存的证据草案', 409);
  const project = db.prepare("SELECT p.name, p.description, f.created_at FROM projects p JOIN fixture_project_profiles f ON f.project_id=p.id WHERE p.id=? AND f.state='active'").get(scope.projectId);
  if (!project || typeof project.name !== 'string' || project.description !== 'synthetic' || typeof project.created_at !== 'string') throw new ModelError('rejected', '项目不可用', 403);
  const opinionId = `opinion-${runId}`; const revisionId = `revision-${runId}`; const planId = `plan-${runId}`;
  const steps = ['仅保存观点草案，不修改项目，也不执行命令'];
  const bundle = {
    contractVersion: '1' as const,
    project: { id: scope.projectId, name: project.name, description: 'synthetic', state: 'active' as const, createdAt: project.created_at },
    opinion: { id: opinionId, projectId: scope.projectId, topicKey: 'model-draft', currentRevision: 1, status: 'draft' as const },
    revision: {
      id: revisionId, opinionId, projectId: scope.projectId, version: 1,
      facts: result.evidence.map(item => ({ statement: item.statement, subject: 'project' as const, source: { kind: 'observer' as const, projectId: scope.projectId, observerSourceId: item.sourceId, epoch: item.epoch, eventId: item.id, observedAt: item.observedAt, quality: 'observed' as const } })),
      inferences: ['这是模型草案，不是已验证观察。'], counterEvidence: [], counterEvidenceLimitation: '模型草案没有反证。',
      uncertainties: result.suggestedOpinion.uncertainties, opinion: result.suggestedOpinion.statement, whyNow: '用户明确要求保存这次模型草案。',
      alternatives: ['不保存'], changeMyMindWhen: ['来源失效或用户撤回'], proposedPlanId: planId, createdAt: now,
    },
    plan: { id: planId, projectId: scope.projectId, revisionId, versionHash: createHash('sha256').update(JSON.stringify(steps)).digest('hex'), steps, risks: ['草案可能不准确'], validation: ['核对证据是否仍有效'], executable: false as const },
    feedback: [],
  };
  let version = 1;
  try { version = saveFixtureOpinion(db, scope, bundle, 0); }
  catch (error) {
    const saved = readFixtureOpinion(db, scope, opinionId, 1);
    if (!saved) throw error;
    version = saved.revision.version;
  }
  const link = db.prepare('SELECT opinion_id FROM model_opinion_links WHERE run_id=?').get(runId);
  if (!link) db.prepare('INSERT INTO model_opinion_links(run_id, project_id, opinion_id, created_at) VALUES (?,?,?,?)').run(runId, scope.projectId, opinionId, now);
  return { opinionId, version, synthetic: true, verified: false };
}
