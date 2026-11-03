import { z } from 'zod';

// These are structural contracts. They do not establish provenance, access, or truth.
const Id = z.string().trim().min(1).max(256);
const Text = z.string().trim().min(1).max(4000);
const Title = z.string().trim().min(1).max(256);
const DateTime = z.string().datetime({ offset: true });
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Version = z.number().int().positive().safe();
const TextList = z.array(Text).max(32);

export const Project = z.object({
  id: Id, name: Title, description: z.string().trim().max(4000), state: z.enum(['active', 'deleting', 'deleted']), createdAt: DateTime,
}).strict();

export const GoalRevision = z.object({
  projectId: Id, goalId: Id, revision: Version, statement: Text, author: z.literal('user'), createdAt: DateTime,
}).strict();

export const ObserverEvidenceRef = z.object({
  kind: z.literal('observer'), projectId: Id, observerSourceId: Id, epoch: z.number().int().nonnegative().safe(),
  eventId: Id, observedAt: DateTime, quality: z.enum(['observed', 'stale', 'unknown']),
}).strict();
export const ResearchSourceRef = z.object({
  kind: z.literal('research'), projectId: Id, researchSourceId: Id, accessedAt: DateTime, contentHash: Hash,
  availability: z.enum(['available', 'stale', 'unavailable']),
}).strict();
export const UserDecisionRef = z.object({
  kind: z.literal('decision'), projectId: Id, decisionId: Id, revision: Version, recordedAt: DateTime,
  status: z.enum(['active', 'withdrawn']),
}).strict();
export const EvidenceRef = z.discriminatedUnion('kind', [ObserverEvidenceRef, ResearchSourceRef, UserDecisionRef]);

export const GroundedFact = z.object({
  statement: Text, subject: z.enum(['project', 'external', 'user_decision']), source: EvidenceRef,
}).strict().superRefine((value, context) => {
  const expected = { project: 'observer', external: 'research', user_decision: 'decision' } as const;
  if (value.source.kind !== expected[value.subject]) context.addIssue({ code: z.ZodIssueCode.custom, path: ['source'], message: 'Evidence type does not support this subject' });
});

export const Opinion = z.object({
  id: Id, projectId: Id, topicKey: Title, currentRevision: Version,
  status: z.enum(['draft', 'ready', 'presented', 'acknowledged', 'deferred', 'withdrawn']),
}).strict();

export const OpinionRevision = z.object({
  id: Id, opinionId: Id, projectId: Id, version: Version,
  facts: z.array(GroundedFact).min(1).max(32), inferences: TextList,
  counterEvidence: z.array(EvidenceRef).max(32), counterEvidenceLimitation: Text.optional(),
  uncertainties: TextList.min(1), opinion: Text, whyNow: Text, alternatives: TextList,
  changeMyMindWhen: TextList.min(1), proposedPlanId: Id, createdAt: DateTime,
}).strict().superRefine((value, context) => {
  for (const [index, fact] of value.facts.entries()) {
    if (fact.source.projectId !== value.projectId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['facts', index, 'source', 'projectId'], message: 'Evidence project does not match revision' });
  }
  for (const [index, ref] of value.counterEvidence.entries()) {
    if (ref.projectId !== value.projectId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['counterEvidence', index, 'projectId'], message: 'Evidence project does not match revision' });
  }
  if (value.counterEvidence.length === 0 && !value.counterEvidenceLimitation) context.addIssue({ code: z.ZodIssueCode.custom, path: ['counterEvidenceLimitation'], message: 'Explain missing counter-evidence' });
});

export const ProposedPlan = z.object({
  id: Id, projectId: Id, revisionId: Id, versionHash: Hash,
  steps: TextList.min(1), risks: TextList, validation: TextList.min(1), executable: z.literal(false),
}).strict();

export const Feedback = z.object({
  id: Id, projectId: Id, revisionId: Id, choice: z.enum(['accept', 'modify', 'defer', 'challenge']),
  reason: Text.optional(), deferUntil: DateTime.optional(), createdAt: DateTime,
}).strict().superRefine((value, context) => {
  if (value.choice === 'challenge' && !value.reason) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A challenge requires a reason' });
  if ((value.choice === 'defer') !== Boolean(value.deferUntil)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['deferUntil'], message: 'Only a deferral requires a deferral time' });
});

// Version 1 remains unchanged; rejection is a user choice, not factual refutation.
export const FeedbackV2 = z.object({
  contractVersion: z.literal('2'), id: Id, projectId: Id, revisionId: Id,
  choice: z.enum(['accept', 'modify', 'defer', 'challenge', 'reject']),
  reason: Text.optional(), deferUntil: DateTime.optional(), createdAt: DateTime,
}).strict().superRefine((value, context) => {
  if (value.choice === 'challenge' && !value.reason) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A challenge requires a reason' });
  if ((value.choice === 'defer') !== Boolean(value.deferUntil)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['deferUntil'], message: 'Only a deferral requires a deferral time' });
});

/** Checks consistency of the supplied records, not their existence or authorization. */
export const OpinionBundle = z.object({
  contractVersion: z.literal('1'), project: Project, opinion: Opinion, revision: OpinionRevision, plan: ProposedPlan, feedback: z.array(Feedback).max(100),
}).strict().superRefine((value, context) => {
  const { project, opinion, revision, plan } = value;
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  if (opinion.projectId !== project.id) issue(['opinion', 'projectId'], 'Opinion project mismatch');
  if (revision.projectId !== project.id) issue(['revision', 'projectId'], 'Revision project mismatch');
  if (revision.opinionId !== opinion.id) issue(['revision', 'opinionId'], 'Revision opinion mismatch');
  if (revision.version !== opinion.currentRevision) issue(['revision', 'version'], 'Current revision mismatch');
  if (plan.projectId !== project.id) issue(['plan', 'projectId'], 'Plan project mismatch');
  if (plan.revisionId !== revision.id) issue(['plan', 'revisionId'], 'Plan revision mismatch');
  if (revision.proposedPlanId !== plan.id) issue(['revision', 'proposedPlanId'], 'Revision plan mismatch');
  value.feedback.forEach((item, index) => {
    if (item.projectId !== project.id) issue(['feedback', index, 'projectId'], 'Feedback project mismatch');
    if (item.revisionId !== revision.id) issue(['feedback', index, 'revisionId'], 'Feedback revision mismatch');
  });
});

export const RevisionPair = z.object({ previous: OpinionRevision, current: OpinionRevision, reason: Text }).strict().superRefine((value, context) => {
  if (value.previous.projectId !== value.current.projectId || value.previous.opinionId !== value.current.opinionId)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['current'], message: 'Revisions must belong to the same project and opinion' });
  if (value.previous.id === value.current.id || value.current.version !== value.previous.version + 1)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['current', 'version'], message: 'Revisions must have distinct IDs and consecutive versions' });
});
