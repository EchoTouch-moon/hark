import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { withFixtureAccess } from './fixture-chronicle.js';
import { appendFixtureFeedback, readFixtureOpinion, saveFixtureOpinion } from './fixture-opinion-store.js';
import { readSyntheticUnderstanding } from './fixture-understanding.js';
import { getSyntheticProject } from './synthetic-catalog.js';

// Internal demo service only; scope must be derived by a trusted server.
const Id = z.string().trim().min(1).max(256);
const Scope = z.object({ principalId: Id, projectId: Id, grantId: Id, rootId: Id }).strict();
const Challenge = z.object({ requestId: Id, reason: z.string().trim().min(1).max(500), createdAt: z.string().datetime({ offset: true }), expectedVersion: z.number().int().positive().safe().default(1) }).strict();
const initialTime = '2026-11-04T00:00:00.000Z';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const opinionId = (projectId: string) => `opinion-${projectId}`;
const revisionId = (projectId: string, version: number) => `revision-${projectId}-${version}`;

function projectRecord(db: DatabaseSync, scope: z.infer<typeof Scope>) {
  const expected = getSyntheticProject(scope.projectId);
  if (!expected) throw new Error('Fixture unavailable');
  return withFixtureAccess(db, scope, () => {
    const row = db.prepare("SELECT p.name, p.description, f.created_at FROM projects p JOIN fixture_project_profiles f ON f.project_id=p.id WHERE p.id=? AND f.state='active'").get(scope.projectId);
    if (!row || row.name !== expected.title || row.description !== 'synthetic' || typeof row.created_at !== 'string') throw new Error('Fixture unavailable');
    return { id: scope.projectId, name: expected.title, description: 'synthetic', state: 'active' as const, createdAt: row.created_at };
  });
}

/** Read only; never creates an opinion as a side effect of loading a page. */
export function readSyntheticOpinion(db: DatabaseSync, rawScope: unknown) {
  const parsed = Scope.safeParse(rawScope);
  if (!parsed.success) return null;
  const scope = parsed.data, id = opinionId(scope.projectId);
  try {
    const current = withFixtureAccess(db, scope, () => db.prepare('SELECT current_revision FROM fixture_opinions WHERE id=? AND project_id=?').get(id, scope.projectId));
    return current ? readFixtureOpinion(db, scope, id, Number(current.current_revision)) : null;
  } catch { return null; }
}

/** Deterministic explanation, explicitly labeled; it does not analyze the question. */
export function answerSyntheticQuestion(db: DatabaseSync, rawScope: unknown, rawQuestion: unknown) {
  z.string().trim().min(1).max(500).parse(rawQuestion);
  const record = readSyntheticOpinion(db, rawScope);
  if (!record) return null;
  return { synthetic: true as const, mode: 'mock' as const,
    answer: '这是固定的示意回复：当前观点依据下方虚构材料，并未分析你的问题。', facts: record.revision.facts };
}

/** Explicit write operation, not a GET; creates a source-backed synthetic opinion. */
export function ensureSyntheticOpinion(db: DatabaseSync, rawScope: unknown) {
  const scope = Scope.parse(rawScope), knowledge = readSyntheticUnderstanding(db, scope);
  if (!knowledge?.todo) return null;
  const id = opinionId(scope.projectId);
  const current = withFixtureAccess(db, scope, () => db.prepare('SELECT current_revision FROM fixture_opinions WHERE id=? AND project_id=?').get(id, scope.projectId));
  if (current) return readFixtureOpinion(db, scope, id, Number(current.current_revision));
  const project = projectRecord(db, scope), fact = knowledge.todo;
  const rid = revisionId(scope.projectId, 1), pid = `plan-${rid}`;
  const steps = ['核对这条合成待办'];
  const bundle = {
    contractVersion: '1' as const, project,
    opinion: { id, projectId: scope.projectId, topicKey: 'synthetic-next-step', currentRevision: 1, status: 'draft' as const },
    revision: { id: rid, opinionId: id, projectId: scope.projectId, version: 1,
      facts: [{ statement: fact.text, subject: 'project' as const, source: { kind: 'observer' as const, projectId: scope.projectId,
        observerSourceId: fact.source.sourceId, epoch: fact.source.epoch, eventId: fact.source.factId, observedAt: fact.source.observedAt, quality: 'observed' as const } }],
      inferences: ['可以先核对现有待办；这只是合成规则推断。'], counterEvidence: [], counterEvidenceLimitation: '预置样本没有其他反证。',
      uncertainties: ['材料为虚构示例，不能说明真实项目情况。'], opinion: '可以考虑先查看现有待办，再决定下一步。', whyNow: '虚构材料中记录了一项待办。',
      alternatives: ['先补充背景'], changeMyMindWhen: ['出现新的合成材料'], proposedPlanId: pid, createdAt: initialTime },
    plan: { id: pid, projectId: scope.projectId, revisionId: rid, versionHash: digest(JSON.stringify({ projectId: scope.projectId, steps })),
      steps, risks: [], validation: ['对照预置来源'], executable: false as const }, feedback: [],
  };
  try { saveFixtureOpinion(db, scope, bundle, 0); }
  catch (error) {
    const existing = readFixtureOpinion(db, scope, id, 1);
    if (!existing) throw error;
    return existing;
  }
  return readFixtureOpinion(db, scope, id, 1);
}

/** Feedback is persisted separately from facts; revisions only adjust the wording. */
export function challengeSyntheticOpinion(db: DatabaseSync, rawScope: unknown, rawChallenge: unknown) {
  const scope = Scope.parse(rawScope), input = Challenge.parse(rawChallenge), id = opinionId(scope.projectId);
  const previous = readFixtureOpinion(db, scope, id, input.expectedVersion);
  if (!previous) throw new Error('Fixture unavailable');
  const nextVersion = input.expectedVersion + 1;
  if (!Number.isSafeInteger(nextVersion)) throw new Error('Revision conflict');
  const feedbackId = `feedback-${digest(`${scope.projectId}\0${input.requestId}`)}`;
  appendFixtureFeedback(db, scope, { contractVersion: '2', id: feedbackId, projectId: scope.projectId,
    revisionId: previous.revision.id, choice: 'challenge', reason: input.reason, createdAt: input.createdAt }, `challenge-${input.requestId}`);
  const reason = `用户反馈 ${feedbackId}：${input.reason}`;
  const already = readFixtureOpinion(db, scope, id, nextVersion);
  if (already) {
    if (already.change?.reason !== reason) throw new Error('Revision conflict');
    const refreshed = readFixtureOpinion(db, scope, id, input.expectedVersion);
    if (!refreshed) throw new Error('Fixture unavailable');
    return { previous: refreshed, current: already };
  }
  const project = projectRecord(db, scope), rid = revisionId(scope.projectId, nextVersion), pid = `plan-${rid}`;
  const steps = ['重新核对这条合成待办'];
  const revision = { ...previous.revision, id: rid, version: nextVersion, proposedPlanId: pid, createdAt: input.createdAt,
    opinion: '可以先核对这项待办；是否立即处理仍需要更多背景。',
    inferences: ['根据用户质疑调整了语气；反馈本身不构成事实或反证。'] };
  const bundle = { contractVersion: '1' as const, project,
    opinion: { id, projectId: scope.projectId, topicKey: 'synthetic-next-step', currentRevision: nextVersion, status: 'draft' as const },
    revision, plan: { id: pid, projectId: scope.projectId, revisionId: rid, versionHash: digest(JSON.stringify({ projectId: scope.projectId, steps })),
      steps, risks: [], validation: ['对照预置来源'], executable: false as const }, feedback: [] };
  try { saveFixtureOpinion(db, scope, bundle, input.expectedVersion, reason); }
  catch (error) {
    const concurrent = readFixtureOpinion(db, scope, id, nextVersion);
    if (!concurrent || concurrent.change?.reason !== reason) throw error;
  }
  const updated = readFixtureOpinion(db, scope, id, nextVersion);
  const updatedPrevious = readFixtureOpinion(db, scope, id, input.expectedVersion);
  if (!updated || !updatedPrevious) throw new Error('Fixture unavailable');
  return { previous: updatedPrevious, current: updated };
}
