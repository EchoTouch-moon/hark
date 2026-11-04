import { z } from 'zod';

const id = z.string().min(1).max(256);
const date = z.string().datetime({ offset: true });
const text = z.string().min(1);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const Risk = z.enum(['L0', 'L1', 'L2', 'L3']);
export const Sensitivity = z.enum(['public', 'personal', 'restricted']);
export const Provenance = z.enum(['user_confirmed', 'tool_observed', 'model_inferred']);
export const SourceRef = z.object({ sourceType: z.enum(['fixture', 'vault', 'github', 'calendar', 'mail']), uri: text, sourceId: id, observedAt: date, contentHash: digest.optional() }).strict();
export const Event = z.object({ id, type: text, projectId: id, source: SourceRef, occurredAt: date, observedAt: date, expiresAt: date.optional(), summary: text, dedupeKey: id, sensitivity: Sensitivity, provenance: Provenance, payloadRef: text.optional(), tags: z.array(text) }).strict();
export const ActionType = z.enum(['report.generate', 'checklist.generate', 'draft.generate', 'repo.read_diagnose']);
export const ActionSpec = z.object({
  id, actionType: ActionType, projectId: id,
  target: z.object({ resourceId: id, path: text.optional() }).strict(),
  params: z.record(z.unknown()), allowedCapabilities: z.array(text), risk: Risk,
  effect: z.enum(['read', 'local_create', 'external_write']), maxSteps: z.number().int().positive(),
  timeoutMs: z.number().int().positive(), maxCostUsd: z.number().nonnegative().finite(), idempotencyKey: id,
  expectedSourceVersion: text.optional(), verification: z.object({ kind: z.enum(['artifact_sha256', 'json_schema', 'remote_readback']), artifactPath: text.optional(), expectedHash: digest.optional() }).strict(),
}).strict();
export const Candidate = z.object({ id, projectId: id, eventIds: z.array(id), title: text, whyNow: text, evidence: z.array(SourceRef).min(1), suggestedAction: ActionSpec, score: z.number().finite(), confidence: z.number().min(0).max(1), risk: Risk, expiresAt: date, suppressionKey: id, status: z.enum(['candidate', 'suppressed', 'proposed']) }).strict().superRefine((value, context) => {
  if (value.projectId !== value.suggestedAction.projectId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['suggestedAction', 'projectId'], message: 'Action project does not match candidate' });
});
export const ActionCard = z.object({ id, candidateId: id, projectId: id, title: text, whyNow: text, evidence: z.array(SourceRef).min(1), action: ActionSpec, createdAt: date, expiresAt: date, status: z.enum(['proposed', 'dismissed', 'snoozed', 'expired', 'ready', 'awaiting_approval', 'executing', 'verifying', 'completed', 'failed', 'blocked']), snoozedUntil: date.optional(), userFeedback: z.enum(['useful', 'not_useful', 'irrelevant']).optional() }).strict().superRefine((value, context) => {
  if (value.projectId !== value.action.projectId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['action', 'projectId'], message: 'Action project does not match card' });
});
export const ApprovalGrant = z.object({ id, principalId: id, cardId: id, actionDigest: digest, targetDigest: digest, risk: Risk, authorizedCapabilities: z.array(text), expiresAt: date, grantedAt: date, consumedAt: date.optional() }).strict();
export const RunState = z.enum(['queued', 'awaiting_approval', 'executing', 'verifying', 'completed', 'pending_verification', 'failed', 'blocked', 'cancelled']);
export type RunState = z.infer<typeof RunState>;
export const TaskRun = z.object({ id, cardId: id, actionId: id, idempotencyKey: id, state: RunState, createdAt: date, startedAt: date.optional(), endedAt: date.optional(), resultArtifactRefs: z.array(text), verificationVerdict: z.enum(['pass', 'fail', 'unknown']).optional(), failureClass: z.enum(['timeout', 'policy', 'dependency', 'executor', 'verification', 'unknown']).optional() }).strict();
export const PanelSpec = z.object({ id, kind: z.enum(['metric', 'list', 'timeline', 'activity']), projectId: id.optional(), dataQueryId: id, refreshSeconds: z.number().int().positive(), components: z.array(z.object({ type: z.enum(['text', 'metric', 'list', 'status', 'link']), field: id, label: text.optional() }).strict()) }).strict();

// Observation grants do not confer research, network or execution permission.
// 'never' represents a lasting folder authorization; dated legacy records remain readable.
export const ObservationExpiry = z.union([date, z.literal('never')]);
export const ObservationGrant = z.object({ id, principalId: id, projectId: id, rootId: id, enabled: z.boolean(), paused: z.boolean(), expiresAt: ObservationExpiry, revokedAt: date.nullable() }).strict();
