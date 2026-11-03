import { z } from 'zod';
import { ActionSpec, ActionType, ApprovalGrant, Risk, RunState } from './contracts.js';
import { actionDigests } from './digests.js';

type RiskLevel = z.infer<typeof Risk>;
type ActionTypeValue = z.infer<typeof ActionType>;
type RunStateValue = z.infer<typeof RunState>;
type ActionSpecValue = z.infer<typeof ActionSpec>;
type ApprovalGrantValue = z.infer<typeof ApprovalGrant>;

/** Frozen server-side constraints for one action type. A type is not usable until `enabled` is reviewed. */
export type ActionPolicyDefinition = {
  readonly params: z.ZodTypeAny;
  readonly riskFloor: RiskLevel;
  readonly effect: ActionSpecValue['effect'];
  readonly capabilities: readonly string[];
  readonly limits: {
    readonly maxSteps: number;
    readonly timeoutMs: number;
    readonly maxCostUsd: number;
  };
  readonly enabled: boolean;
};

// Every parameter object is optional-only and strict: unknown keys and unreviewed values are rejected.
const reportParams = z.object({
  format: z.literal('markdown').optional(),
  title: z.string().trim().min(1).max(200).optional(),
}).strict();
const checklistParams = z.object({
  maxItems: z.number().int().min(1).max(50).optional(),
}).strict();
const draftParams = z.object({
  tone: z.enum(['neutral', 'concise']).optional(),
}).strict();
const diagnoseParams = z.object({
  depth: z.number().int().min(0).max(3).optional(),
}).strict();

/**
 * Frozen per-type policy. `enabled` stays false: parameter review and risk floors do not grant
 * permission, and no executor exists. Enabling a type requires a reviewed contract change.
 */
export const ACTION_POLICIES = {
  'report.generate': {
    params: reportParams, riskFloor: 'L1', effect: 'local_create',
    capabilities: ['artifact.write'], limits: { maxSteps: 5, timeoutMs: 60_000, maxCostUsd: 0 }, enabled: false,
  },
  'checklist.generate': {
    params: checklistParams, riskFloor: 'L0', effect: 'local_create',
    capabilities: ['artifact.write'], limits: { maxSteps: 3, timeoutMs: 30_000, maxCostUsd: 0 }, enabled: false,
  },
  'draft.generate': {
    params: draftParams, riskFloor: 'L1', effect: 'local_create',
    capabilities: ['artifact.write'], limits: { maxSteps: 3, timeoutMs: 60_000, maxCostUsd: 0 }, enabled: false,
  },
  'repo.read_diagnose': {
    params: diagnoseParams, riskFloor: 'L0', effect: 'read',
    capabilities: ['repo.read'], limits: { maxSteps: 10, timeoutMs: 120_000, maxCostUsd: 0 }, enabled: false,
  },
} satisfies Record<ActionTypeValue, ActionPolicyDefinition>;

const riskRank: Readonly<Record<RiskLevel, number>> = { L0: 0, L1: 1, L2: 2, L3: 3 };

const CardStatus = z.enum([
  'proposed', 'dismissed', 'snoozed', 'expired', 'ready', 'awaiting_approval',
  'executing', 'verifying', 'completed', 'failed', 'blocked',
]);
const cardStatusesReadyForRun: readonly z.infer<typeof CardStatus>[] = ['ready', 'awaiting_approval'];
const runStatesReadyForRun: readonly RunStateValue[] = ['queued', 'awaiting_approval'];

const id = z.string().min(1).max(256);
const date = z.string().datetime({ offset: true });

const ExecutionRequest = z.object({
  principalId: id,
  runId: id,
  cardId: id,
  actionId: id,
  projectId: id,
  approvalMode: z.enum(['stored_grant', 'online_explicit']),
}).strict();

/** Persisted rows a future store adapter must read inside one transaction before any side effect. */
const PersistedExecutionBasis = z.object({
  run: z.object({ id, cardId: id, actionId: id, idempotencyKey: id, state: RunState }).strict(),
  card: z.object({ id, candidateId: id, projectId: id, status: CardStatus, expiresAt: date }).strict(),
  candidate: z.object({ id, projectId: id }).strict(),
  action: ActionSpec,
  grant: ApprovalGrant,
  currentSourceVersion: z.string().min(1).max(256).nullable(),
}).strict();

const ExecutionPrecheck = z.object({
  request: ExecutionRequest,
  persisted: PersistedExecutionBasis,
}).strict();

export type ExecutionCheckName =
  | 'request_shape' | 'run_identity' | 'card_binding' | 'candidate_binding' | 'project_binding'
  | 'action_identity' | 'idempotency_key' | 'card_status' | 'card_expiry' | 'run_state'
  | 'parameter_policy' | 'risk_floor' | 'risk_ceiling' | 'effect_policy' | 'capability_policy'
  | 'budget_policy' | 'grant_principal' | 'grant_card' | 'grant_consumption' | 'grant_expiry'
  | 'grant_risk' | 'grant_capabilities' | 'digests' | 'source_version' | 'action_enablement'
  | 'execution_channel';

export type ExecutionBlockReason =
  | 'invalid_request' | 'invalid_clock' | 'run_identity_mismatch' | 'card_binding_mismatch'
  | 'candidate_binding_mismatch' | 'project_binding_mismatch' | 'action_identity_mismatch'
  | 'idempotency_mismatch' | 'card_not_ready' | 'card_expired' | 'run_not_startable'
  | 'params_not_allowed' | 'risk_below_floor' | 'risk_l3_forbidden' | 'online_approval_required'
  | 'effect_not_permitted' | 'capability_not_permitted' | 'budget_not_permitted'
  | 'principal_mismatch' | 'grant_card_mismatch' | 'grant_consumed' | 'grant_expired'
  | 'grant_not_yet_valid' | 'grant_risk_insufficient' | 'grant_capability_missing'
  | 'digest_mismatch' | 'source_version_changed' | 'action_disabled'
  | 'execution_not_implemented';

/**
 * Result of the pre-execution recheck. It can never be `allowed: true`: the executor, the atomic
 * grant reservation and the independent verifier are not implemented.
 */
export type ExecutionGateResult = {
  readonly allowed: false;
  readonly reason: ExecutionBlockReason;
  readonly blockedAt: ExecutionCheckName | null;
  readonly passedChecks: readonly ExecutionCheckName[];
};

type Check = { readonly name: ExecutionCheckName; readonly failure: ExecutionBlockReason | null };

function deriveDigests(action: ActionSpecValue): ReturnType<typeof actionDigests> | null {
  try {
    return actionDigests(action);
  } catch {
    return null;
  }
}

function withinBudget(action: ActionSpecValue, limits: ActionPolicyDefinition['limits']): boolean {
  return action.maxSteps <= limits.maxSteps
    && action.timeoutMs <= limits.timeoutMs
    && action.maxCostUsd <= limits.maxCostUsd;
}

function grantTimingFailure(grant: ApprovalGrantValue, nowMs: number): ExecutionBlockReason | null {
  if (Date.parse(grant.grantedAt) > nowMs) return 'grant_not_yet_valid';
  if (Date.parse(grant.expiresAt) <= nowMs) return 'grant_expired';
  return null;
}

/**
 * Pure recheck of a persisted approval immediately before a would-be side effect. Callers must still
 * read every row inside a transaction, reserve the grant and re-check the target afterwards.
 */
export function revalidateBeforeExecution(input: unknown, now: Date = new Date()): ExecutionGateResult {
  const parsed = ExecutionPrecheck.safeParse(input);
  if (!parsed.success) return { allowed: false, reason: 'invalid_request', blockedAt: null, passedChecks: [] };
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return { allowed: false, reason: 'invalid_clock', blockedAt: null, passedChecks: [] };

  const { request, persisted } = parsed.data;
  const { run, card, candidate, action, grant } = persisted;
  const policy = ACTION_POLICIES[action.actionType];
  const derived = deriveDigests(action);

  const checks: readonly Check[] = [
    {
      name: 'run_identity',
      failure: run.id !== request.runId || run.cardId !== request.cardId || run.actionId !== request.actionId
        ? 'run_identity_mismatch' : null,
    },
    {
      name: 'card_binding',
      failure: card.id !== request.cardId || card.id !== run.cardId ? 'card_binding_mismatch' : null,
    },
    {
      name: 'candidate_binding',
      failure: candidate.id !== card.candidateId ? 'candidate_binding_mismatch' : null,
    },
    {
      name: 'project_binding',
      failure: new Set([request.projectId, card.projectId, candidate.projectId, action.projectId]).size === 1
        ? null : 'project_binding_mismatch',
    },
    {
      name: 'action_identity',
      failure: action.id !== request.actionId || action.id !== run.actionId ? 'action_identity_mismatch' : null,
    },
    {
      name: 'idempotency_key',
      failure: derived === null || derived.idempotencyKey !== run.idempotencyKey ? 'idempotency_mismatch' : null,
    },
    {
      name: 'card_status',
      failure: cardStatusesReadyForRun.includes(card.status) ? null : 'card_not_ready',
    },
    {
      name: 'card_expiry',
      failure: Date.parse(card.expiresAt) > nowMs ? null : 'card_expired',
    },
    {
      name: 'run_state',
      failure: runStatesReadyForRun.includes(run.state) ? null : 'run_not_startable',
    },
    {
      name: 'parameter_policy',
      failure: policy.params.safeParse(action.params).success ? null : 'params_not_allowed',
    },
    {
      name: 'risk_floor',
      failure: riskRank[action.risk] >= riskRank[policy.riskFloor] ? null : 'risk_below_floor',
    },
    {
      name: 'risk_ceiling',
      failure: action.risk === 'L3' ? 'risk_l3_forbidden'
        : action.risk === 'L2' && request.approvalMode !== 'online_explicit' ? 'online_approval_required' : null,
    },
    {
      name: 'effect_policy',
      failure: action.effect === policy.effect ? null : 'effect_not_permitted',
    },
    {
      name: 'capability_policy',
      failure: action.allowedCapabilities.every(capability => policy.capabilities.includes(capability))
        ? null : 'capability_not_permitted',
    },
    {
      name: 'budget_policy',
      failure: withinBudget(action, policy.limits) ? null : 'budget_not_permitted',
    },
    {
      name: 'grant_principal',
      failure: grant.principalId === request.principalId ? null : 'principal_mismatch',
    },
    {
      name: 'grant_card',
      failure: grant.cardId === card.id ? null : 'grant_card_mismatch',
    },
    {
      name: 'grant_consumption',
      failure: grant.consumedAt === undefined ? null : 'grant_consumed',
    },
    {
      name: 'grant_expiry',
      failure: grantTimingFailure(grant, nowMs),
    },
    {
      name: 'grant_risk',
      // L3 never authorizes anything, even when the action itself is lower risk.
      failure: grant.risk === 'L3' || riskRank[grant.risk] < riskRank[action.risk] ? 'grant_risk_insufficient' : null,
    },
    {
      name: 'grant_capabilities',
      failure: action.allowedCapabilities.every(capability => grant.authorizedCapabilities.includes(capability))
        ? null : 'grant_capability_missing',
    },
    {
      name: 'digests',
      failure: derived !== null && grant.actionDigest === derived.actionDigest && grant.targetDigest === derived.targetDigest
        ? null : 'digest_mismatch',
    },
    {
      name: 'source_version',
      failure: action.expectedSourceVersion === undefined || action.expectedSourceVersion === persisted.currentSourceVersion
        ? null : 'source_version_changed',
    },
    {
      name: 'action_enablement',
      failure: policy.enabled ? null : 'action_disabled',
    },
    {
      // No executor exists. This stays closed even if a policy were enabled without an execution contract.
      name: 'execution_channel',
      failure: 'execution_not_implemented',
    },
  ];

  const failureIndex = checks.findIndex(check => check.failure !== null);
  if (failureIndex === -1) {
    return {
      allowed: false,
      reason: 'execution_not_implemented',
      blockedAt: 'execution_channel',
      passedChecks: checks.map(check => check.name),
    };
  }

  const failed = checks[failureIndex]!;
  return {
    allowed: false,
    reason: failed.failure!,
    blockedAt: failed.name,
    passedChecks: checks.slice(0, failureIndex).map(check => check.name),
  };
}
