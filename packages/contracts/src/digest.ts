import type { ActionSpec, ActionTarget } from './action.js';
import { canonicalDigest, sha256Hex } from './canonical.js';

/**
 * idempotencyKey is stably bound to
 * (actionType, projectId, canonical target, normalized params, sourceVersion)
 * per docs/04-CONTRACTS.md.
 */
export function deriveIdempotencyKey(input: {
  actionType: string;
  projectId: string;
  target: ActionTarget;
  params: Record<string, unknown>;
  sourceVersion?: string;
}): string {
  return canonicalDigest({
    actionType: input.actionType,
    projectId: input.projectId,
    target: input.target,
    params: input.params,
    sourceVersion: input.sourceVersion ?? null,
  });
}

/**
 * Digest of the action's semantic content — what an ApprovalGrant binds to.
 * Deliberately excludes ids/timestamps and includes everything with an effect.
 */
export function actionDigest(spec: ActionSpec): string {
  return canonicalDigest({
    actionType: spec.actionType,
    projectId: spec.projectId,
    target: spec.target,
    params: spec.params,
    risk: spec.risk,
    effect: spec.effect,
    expectedSourceVersion: spec.expectedSourceVersion ?? null,
    verification: spec.verification,
  });
}

/** Digest of the target alone (S06: changed target must invalidate a grant). */
export function targetDigest(spec: ActionSpec): string {
  return canonicalDigest({
    actionType: spec.actionType,
    projectId: spec.projectId,
    target: spec.target,
  });
}

/** Short stable run/trace ids derived from content. */
export function digestId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${sha256Hex(parts.join('\u0000')).slice(0, 12)}`;
}
