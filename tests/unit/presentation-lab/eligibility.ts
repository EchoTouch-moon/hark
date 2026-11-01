/**
 * @fileoverview G0-05 section 5 - the four presentation gates, as a pure function.
 *
 * EXPERIMENT ONLY. No I/O, no clock reads, no randomness: `now` is always an
 * argument (R12.1 section 5.2 rule 4).
 *
 * Order matters and is asserted by the cases:
 *   scope block -> source staleness -> new evidence -> goal link
 *   -> deferral -> cooldown -> focus -> quota
 * Scope is checked first so a leak is stopped before any "is it worth saying"
 * reasoning happens (R12.2 F04).
 */

import type { EvidenceProjection, EvidenceRef, ProjectId, ReasonCode } from './types.js';

export interface GoalFacts {
  readonly id: string;
  readonly statement: string;
  /** Token that must appear in whyNow; a generic sentence must not pass. */
  readonly anchor: string;
  readonly impactBoundary: { readonly paths: readonly string[]; readonly suites: readonly string[] };
}

export interface PresentationRecord {
  readonly projectId: ProjectId;
  readonly at: Date;
  readonly state: 'presented' | 'delivery_uncertain';
}

export interface EligibilityInput {
  readonly candidateProjectId: ProjectId;
  readonly focusedProjectId: ProjectId | null;
  readonly now: Date;
  readonly evidence: readonly EvidenceRef[];
  readonly presentedProjections: readonly EvidenceProjection[];
  readonly goal: GoalFacts | null;
  readonly whyNow: string;
  readonly deferUntil: Date | null;
  readonly cooldownUntil: Date | null;
  readonly presentationLog: readonly PresentationRecord[];
  readonly maxPerProjectPer24h: number;
  readonly sourceStale: boolean;
}

export type Eligibility =
  | { readonly kind: 'eligible'; readonly newEvidenceRefs: readonly EvidenceRef[]; readonly goalRef: string }
  | { readonly kind: 'not_eligible'; readonly reasonCode: ReasonCode }
  | { readonly kind: 'blocked'; readonly reasonCode: ReasonCode };

const DAY_MS = 24 * 60 * 60 * 1000;

function sameProjection(a: EvidenceProjection, b: EvidenceProjection): boolean {
  // Message text is absent from the projection on purpose: two commits with the
  // same message but different content must not compare equal (R12.2 F01).
  return a.kind === b.kind
    && a.contentVersion === b.contentVersion
    && a.changedPathsHash === b.changedPathsHash
    && a.semanticDigest === b.semanticDigest;
}

export function newEvidence(input: EligibilityInput): EvidenceRef[] {
  return input.evidence.filter((item) => !input.presentedProjections.some((seen) => sameProjection(seen, item)));
}

/** Sliding 24h window per project, counted on records that may have reached the user. */
export function presentedWithin24h(input: EligibilityInput): number {
  const from = input.now.getTime() - DAY_MS;
  return input.presentationLog.filter(
    (row) => row.projectId === input.candidateProjectId
      && row.at.getTime() > from
      && row.at.getTime() <= input.now.getTime(),
  ).length;
}

export function evaluateEligibility(input: EligibilityInput): Eligibility {
  // 1. scope: the candidate and every one of its evidence items must belong to
  //    the candidate's own project. A leak is blocked, not "ignored".
  if (input.evidence.some((item) => item.projectId !== input.candidateProjectId)) {
    return { kind: 'blocked', reasonCode: 'PROJECT_SCOPE_DENIED' };
  }

  // 2. source trust. Stale means "I cannot judge", which is reported through the
  //    observation channel, not by pushing a new opinion (R12.2 F08).
  if (input.sourceStale) return { kind: 'not_eligible', reasonCode: 'SOURCE_STALE' };

  // 3. new evidence, compared by semantic projection.
  const fresh = newEvidence(input);
  if (fresh.length === 0) return { kind: 'not_eligible', reasonCode: 'NO_NEW_EVIDENCE' };

  // 4. goal link: a goal must exist and whyNow must name its anchor, otherwise
  //    a generic sentence would pass as a reason.
  if (input.goal === null || !input.whyNow.includes(input.goal.anchor)) {
    return { kind: 'not_eligible', reasonCode: 'NO_GOAL_LINK' };
  }

  // 5. user-chosen deferral.
  if (input.deferUntil !== null && input.deferUntil.getTime() > input.now.getTime()) {
    return { kind: 'not_eligible', reasonCode: 'DEFERRED' };
  }

  // 6. cooldown after a dismissal.
  if (input.cooldownUntil !== null && input.cooldownUntil.getTime() > input.now.getTime()) {
    return { kind: 'not_eligible', reasonCode: 'COOLDOWN' };
  }

  // 7. focus: opinions are shown against the focused project only.
  if (input.focusedProjectId !== input.candidateProjectId) {
    return { kind: 'not_eligible', reasonCode: 'PROJECT_NOT_FOCUSED' };
  }

  // 8. quota: G0-05 section 5 item 4, sliding 24h, per project.
  if (presentedWithin24h(input) >= input.maxPerProjectPer24h) {
    return { kind: 'not_eligible', reasonCode: 'DAILY_BUDGET' };
  }

  return { kind: 'eligible', newEvidenceRefs: fresh, goalRef: input.goal.id };
}
