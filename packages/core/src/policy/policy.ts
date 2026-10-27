import type { ActionSpec, ApprovalGrant, Risk } from '@hearth/contracts';
import { actionDigest, targetDigest } from '@hearth/contracts';
import { ACTION_REGISTRY, isRegisteredActionType, maxRisk, riskAtLeast } from './action-registry.js';
import { resolveArtifactPath, validateRealpathContainment } from './artifact-path.js';

export type DenyCode =
  | 'UNKNOWN_ACTION'
  | 'L3_FORBIDDEN'
  | 'PROJECT_ACL'
  | 'STALE_SOURCE'
  | 'ARTIFACT_PATH'
  | 'GRANT_DIGEST_MISMATCH'
  | 'GRANT_EXPIRED'
  | 'GRANT_CONSUMED'
  | 'GRANT_RISK'
  | 'GRANT_CAPABILITY'
  | 'COST_FORBIDDEN';

export type PolicyDecision =
  | { decision: 'permit'; effectiveRisk: Risk; effectiveEffect: string; reason: string }
  | { decision: 'await_approval'; effectiveRisk: Risk; reason: string }
  | { decision: 'deny'; effectiveRisk: Risk; code: DenyCode; reason: string };

export interface PolicyContext {
  now: string;
  /** Projects the acting principal is allowed to touch (server ACL). */
  allowedProjectIds: readonly string[];
  /** Persisted approval grants relevant to the card (server reads from DB). */
  grants: readonly ApprovalGrant[];
  /** Current version of the source backing the card, re-read before execute. */
  actualSourceVersion?: string;
  /** Demo artifacts root for local_create containment. */
  demoArtifactRoot: string;
  /** Optional fs hooks so the policy stays testable without a real disk. */
  fs?: {
    realpath(p: string): Promise<string>;
    stat(p: string): Promise<{ isDirectory(): boolean } | null>;
  };
}

/** Validate a single persisted grant against the action spec being executed. */
export function validateGrant(
  grant: ApprovalGrant,
  spec: ActionSpec,
  ctx: Pick<PolicyContext, 'now'>,
): { ok: true } | { ok: false; code: DenyCode; reason: string } {
  if (grant.actionDigest !== actionDigest(spec)) {
    return { ok: false, code: 'GRANT_DIGEST_MISMATCH', reason: 'action digest mismatch (S06)' };
  }
  if (grant.targetDigest !== targetDigest(spec)) {
    return { ok: false, code: 'GRANT_DIGEST_MISMATCH', reason: 'target digest mismatch (S06)' };
  }
  if (grant.expiresAt <= ctx.now) {
    return { ok: false, code: 'GRANT_EXPIRED', reason: 'grant expired (S07)' };
  }
  if (grant.consumedAt) {
    return { ok: false, code: 'GRANT_CONSUMED', reason: 'grant already consumed' };
  }
  if (!riskAtLeast(grant.risk, 'L2')) {
    return { ok: false, code: 'GRANT_RISK', reason: 'grant risk below L2' };
  }
  const missing = spec.allowedCapabilities.filter((c) => !grant.authorizedCapabilities.includes(c));
  if (missing.length > 0) {
    return { ok: false, code: 'GRANT_CAPABILITY', reason: `grant lacks capabilities: ${missing.join(',')}` };
  }
  return { ok: true };
}

function findUsableGrant(spec: ActionSpec, ctx: PolicyContext) {
  const digest = actionDigest(spec);
  let boundInvalidReason: string | null = null;
  for (const grant of ctx.grants) {
    const v = validateGrant(grant, spec, ctx);
    if (v.ok) return { grant, invalidReasons: null as string | null };
    // Remember why a grant *bound to this action* failed, for explainability.
    if (grant.actionDigest === digest && boundInvalidReason === null) {
      boundInvalidReason = v.reason;
    }
  }
  return { grant: null, invalidReasons: boundInvalidReason };
}

/**
 * The single gate every execution must pass. Server-authoritative:
 * risk floors, effect types and capabilities come from ACTION_REGISTRY,
 * never from client-submitted values.
 */
export async function evaluatePolicy(spec: ActionSpec, ctx: PolicyContext): Promise<PolicyDecision> {
  if (!isRegisteredActionType(spec.actionType)) {
    return {
      decision: 'deny',
      effectiveRisk: spec.risk,
      code: 'UNKNOWN_ACTION',
      reason: `actionType ${spec.actionType} not in registry`,
    };
  }
  const reg = ACTION_REGISTRY[spec.actionType];
  const effectiveRisk = maxRisk(spec.risk, reg.riskFloor);
  const effectiveEffect = reg.effect; // registry wins over client claim

  if (effectiveRisk === 'L3') {
    return { decision: 'deny', effectiveRisk, code: 'L3_FORBIDDEN', reason: 'L3 forbidden unconditionally' };
  }
  if (!ctx.allowedProjectIds.includes(spec.projectId)) {
    return {
      decision: 'deny',
      effectiveRisk,
      code: 'PROJECT_ACL',
      reason: `project ${spec.projectId} outside allowed scope (S04)`,
    };
  }
  if (spec.maxCostUsd > 0) {
    return { decision: 'deny', effectiveRisk, code: 'COST_FORBIDDEN', reason: 'nonzero cost not allowed in P0' };
  }
  if (spec.expectedSourceVersion !== undefined) {
    if (ctx.actualSourceVersion === undefined) {
      return {
        decision: 'deny',
        effectiveRisk,
        code: 'STALE_SOURCE',
        reason: 'source version unavailable; rescan required (S10)',
      };
    }
    if (ctx.actualSourceVersion !== spec.expectedSourceVersion) {
      return {
        decision: 'deny',
        effectiveRisk,
        code: 'STALE_SOURCE',
        reason: `source moved from ${spec.expectedSourceVersion} to ${ctx.actualSourceVersion}; rescan required (S10)`,
      };
    }
  }

  const needsApproval = effectiveRisk === 'L2' || effectiveEffect === 'external_write';
  if (needsApproval) {
    const { grant, invalidReasons } = findUsableGrant(spec, ctx);
    if (!grant) {
      return {
        decision: 'await_approval',
        effectiveRisk,
        reason: 'L2/external_write requires human approval (S05)',
      };
    }
    if (invalidReasons) {
      // A grant exists for this action but no longer valid: hold for approval again.
      return { decision: 'await_approval', effectiveRisk, reason: invalidReasons };
    }
    // Valid grant: fall through to effect-specific checks, then permit.
  }

  if (effectiveEffect === 'local_create') {
    const rel = spec.verification.artifactPath;
    if (!rel) {
      return { decision: 'deny', effectiveRisk, code: 'ARTIFACT_PATH', reason: 'local_create needs verification.artifactPath' };
    }
    const resolved = resolveArtifactPath(ctx.demoArtifactRoot, rel);
    if (!resolved.ok) {
      return { decision: 'deny', effectiveRisk, code: 'ARTIFACT_PATH', reason: resolved.reason };
    }
    if (ctx.fs) {
      const real = await validateRealpathContainment(resolved.absPath, ctx.demoArtifactRoot, ctx.fs.realpath, ctx.fs.stat);
      if (!real.ok) {
        return { decision: 'deny', effectiveRisk, code: 'ARTIFACT_PATH', reason: real.reason };
      }
    }
  }

  return {
    decision: 'permit',
    effectiveRisk,
    effectiveEffect,
    reason: needsApproval
      ? 'approved grant validated (digest+expiry+capabilities)'
      : `within ${effectiveRisk} bounds for ${spec.actionType}`,
  };
}
