/**
 * @fileoverview Group B presentation lab - shared types and validators.
 *
 * EXPERIMENT ONLY. Not imported by apps or packages. See docs/reviews
 * R12 / R12.1 / R12.2 for the frozen specification this file implements.
 *
 * Two rules carried by these types:
 *  - event identity (who arrived) and evidence semantics (did anything change)
 *    are different layers (R12.2 F01);
 *  - what a candidate is allowed to persist (trace) and what the logic may look
 *    at (evaluation output) are different types (R12.2 F06).
 */

export type ProjectId = 'projectA' | 'projectB';
export const PROJECT_IDS: readonly ProjectId[] = ['projectA', 'projectB'];

export type EvidenceKind = 'commit' | 'junit' | 'decision';

/** The comparable part of an evidence item. Message text is deliberately absent. */
export interface EvidenceProjection {
  readonly kind: EvidenceKind;
  readonly contentVersion: string;
  readonly changedPathsHash: string;
  readonly semanticDigest: string;
}

export interface EvidenceRef extends EvidenceProjection {
  readonly id: string;
  readonly projectId: ProjectId;
}

export type ReasonCode =
  | 'NO_NEW_EVIDENCE'
  | 'NO_GOAL_LINK'
  | 'COOLDOWN'
  | 'DEFERRED'
  | 'DAILY_BUDGET'
  | 'PROJECT_NOT_FOCUSED'
  | 'SOURCE_STALE'
  | 'NOT_CLAIMED'
  | 'DELIVERY_UNCERTAIN'
  | 'USER_TYPING'
  | 'PROJECT_SCOPE_DENIED';

export const REASON_CODES: readonly ReasonCode[] = [
  'NO_NEW_EVIDENCE', 'NO_GOAL_LINK', 'COOLDOWN', 'DEFERRED', 'DAILY_BUDGET',
  'PROJECT_NOT_FOCUSED', 'SOURCE_STALE', 'NOT_CLAIMED', 'DELIVERY_UNCERTAIN',
  'USER_TYPING', 'PROJECT_SCOPE_DENIED',
];

export type Disposition =
  | 'would_present' | 'ignored' | 'withheld' | 'blocked' | 'claimed' | 'presented';

export const DISPOSITIONS: readonly Disposition[] = [
  'would_present', 'ignored', 'withheld', 'blocked', 'claimed', 'presented',
];

/** Dispositions that must carry a reason code, and those that must not. */
export function reasonRequired(disposition: Disposition): boolean {
  return disposition === 'ignored' || disposition === 'withheld' || disposition === 'blocked';
}

// --- Trigger layer: one row per arriving event, identity based -------------

export interface TriggerDisposition {
  readonly sourceEventId: string;
  readonly projectId: ProjectId;
  readonly epoch: string;
  readonly contentVersion: string;
  readonly filtered: { readonly code: ReasonCode } | null;
  readonly fanout: readonly string[];
  readonly at: string;
}

// --- Candidate layer: logic view is not the audit view ---------------------

/** Not persisted. Carries the fields a test needs to inspect. */
export interface CandidateEvaluationOutput {
  readonly candidateId: string;
  readonly projectId: ProjectId;
  readonly disposition: Disposition;
  readonly reasonCode: ReasonCode | null;
  readonly evidenceDiffCount: number;
  readonly newEvidenceRefs: readonly EvidenceRef[];
  readonly goalRef: string | null;
  readonly whyNow: string | null;
  readonly decidedAt: string;
}

/** Persisted audit row. Allowlisted fields only, never the candidate body. */
export interface CandidateTrace {
  readonly candidateId: string;
  readonly hash: string;
  readonly projectId: ProjectId;
  readonly ruleRefs: readonly { readonly id: string; readonly version: string }[];
  readonly triggerKind: 'user_requested' | 'system_suggested';
  readonly disposition: Disposition;
  readonly reasonCode: ReasonCode | null;
  readonly boundedCounts: { readonly evidenceDiff: number; readonly hasGoalLink: boolean };
  readonly decidedAt: string;
}

export const TRACE_FIELDS: readonly string[] = [
  'candidateId', 'hash', 'projectId', 'ruleRefs', 'triggerKind',
  'disposition', 'reasonCode', 'boundedCounts', 'decidedAt',
];

export class LabValidationError extends Error {}

const EVENT_ID = /^ev-[a-z0-9-]{1,24}$/;
const CANDIDATE_ID = /^cand-[a-z0-9-]{1,24}$/;
const VERSION = /^[a-z0-9.]{1,40}$/;

/** Field allowlist plus value checks (R12.2 F10): a whitelisted field can still carry junk. */
export function validateTrace(trace: CandidateTrace): void {
  for (const key of Object.keys(trace)) {
    if (!TRACE_FIELDS.includes(key)) throw new LabValidationError(`field not allowed: ${key}`);
  }
  if (!CANDIDATE_ID.test(trace.candidateId)) throw new LabValidationError('candidateId format');
  if (!PROJECT_IDS.includes(trace.projectId)) throw new LabValidationError('projectId not in fixture set');
  if (trace.ruleRefs.length > 16) throw new LabValidationError('ruleRefs too long');
  for (const ref of trace.ruleRefs) {
    if (!VERSION.test(ref.version)) throw new LabValidationError('rule version format');
  }
  if (trace.reasonCode !== null && !REASON_CODES.includes(trace.reasonCode)) {
    throw new LabValidationError('reasonCode not a closed enum member');
  }
  if (reasonRequired(trace.disposition) !== (trace.reasonCode !== null)) {
    throw new LabValidationError('disposition and reasonCode disagree');
  }
  if (!DISPOSITIONS.includes(trace.disposition)) throw new LabValidationError('disposition unknown');
  if (trace.hash.length < 8 || trace.hash.length > 64) throw new LabValidationError('hash length');
}

export function validateTriggerDisposition(row: TriggerDisposition): void {
  if (!EVENT_ID.test(row.sourceEventId)) throw new LabValidationError('sourceEventId format');
  if (!PROJECT_IDS.includes(row.projectId)) throw new LabValidationError('projectId not in fixture set');
  if (row.fanout.length > 16) throw new LabValidationError('fanout too long');
  for (const id of row.fanout) {
    if (!CANDIDATE_ID.test(id)) throw new LabValidationError('fanout id format');
  }
}
