import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ACTION_POLICIES, revalidateBeforeExecution } from '../src/action-policy.js';
import { ActionSpec, ApprovalGrant } from '../src/contracts.js';
import { actionDigests, idempotencyKeyForAction } from '../src/digests.js';

type ActionSpecValue = z.infer<typeof ActionSpec>;

const NOW = new Date('2026-11-03T22:30:00.000Z');

function buildAction(overrides: Partial<ActionSpecValue> = {}): ActionSpecValue {
  const draft: ActionSpecValue = {
    id: 'action-1',
    actionType: 'report.generate',
    projectId: 'project-A',
    target: { resourceId: 'project-A' },
    params: { format: 'markdown', title: '合成项目报告' },
    allowedCapabilities: ['artifact.write'],
    risk: 'L1',
    effect: 'local_create',
    maxSteps: 3,
    timeoutMs: 30_000,
    maxCostUsd: 0,
    idempotencyKey: 'pending',
    expectedSourceVersion: 'v1',
    verification: { kind: 'artifact_sha256', artifactPath: 'artifacts/report.md' },
    ...overrides,
  };
  return { ...draft, idempotencyKey: idempotencyKeyForAction(draft) };
}

function basis(action: ActionSpecValue = buildAction()) {
  const { actionDigest, targetDigest, idempotencyKey } = actionDigests(action);
  const grant: z.infer<typeof ApprovalGrant> = {
    id: 'grant-1', principalId: 'principal-1', cardId: 'card-1',
    actionDigest, targetDigest, risk: 'L1', authorizedCapabilities: ['artifact.write'],
    grantedAt: '2026-11-03T22:00:00.000Z', expiresAt: '2026-11-03T23:00:00.000Z',
  };
  return {
    request: {
      principalId: 'principal-1',
      runId: 'run-1',
      cardId: 'card-1',
      actionId: action.id,
      projectId: action.projectId,
      approvalMode: 'stored_grant',
    },
    persisted: {
      run: { id: 'run-1', cardId: 'card-1', actionId: action.id, idempotencyKey, state: 'awaiting_approval' },
      card: {
        id: 'card-1', candidateId: 'candidate-1', projectId: action.projectId,
        status: 'ready', expiresAt: '2026-11-04T00:00:00.000Z',
      },
      candidate: { id: 'candidate-1', projectId: action.projectId },
      action,
      grant,
      currentSourceVersion: 'v1',
    },
  };
}

const allChecksBeforeEnablement = [
  'run_identity', 'card_binding', 'candidate_binding', 'project_binding', 'action_identity',
  'idempotency_key', 'card_status', 'card_expiry', 'run_state', 'parameter_policy', 'risk_floor',
  'risk_ceiling', 'effect_policy', 'capability_policy', 'budget_policy', 'grant_principal',
  'grant_card', 'grant_consumption', 'grant_expiry', 'grant_risk', 'grant_capabilities', 'digests',
  'source_version',
];

describe('frozen action policy', () => {
  it('registers every action type with execution disabled and no cost budget', () => {
    expect(Object.keys(ACTION_POLICIES).sort()).toEqual(
      ['checklist.generate', 'draft.generate', 'repo.read_diagnose', 'report.generate'],
    );
    for (const policy of Object.values(ACTION_POLICIES)) {
      expect(policy.enabled).toBe(false);
      expect(policy.limits.maxCostUsd).toBe(0);
      expect(policy.limits.maxSteps).toBeGreaterThan(0);
      expect(policy.limits.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('rejects unreviewed parameters and values outside the frozen ranges', () => {
    expect(ACTION_POLICIES['report.generate'].params.safeParse({ format: 'markdown', title: 'x' }).success).toBe(true);
    for (const bad of [{ format: 'pdf' }, { title: '' }, { title: 'x', shell: 'rm' }, { title: 'x'.repeat(201) }]) {
      expect(ACTION_POLICIES['report.generate'].params.safeParse(bad).success).toBe(false);
    }
    expect(ACTION_POLICIES['checklist.generate'].params.safeParse({ maxItems: 50 }).success).toBe(true);
    for (const bad of [{ maxItems: 0 }, { maxItems: 51 }, { maxItems: 2.5 }]) {
      expect(ACTION_POLICIES['checklist.generate'].params.safeParse(bad).success).toBe(false);
    }
    expect(ACTION_POLICIES['draft.generate'].params.safeParse({ tone: 'concise' }).success).toBe(true);
    expect(ACTION_POLICIES['draft.generate'].params.safeParse({ tone: 'loud' }).success).toBe(false);
    expect(ACTION_POLICIES['repo.read_diagnose'].params.safeParse({ depth: 3 }).success).toBe(true);
    for (const bad of [{ depth: 4 }, { depth: -1 }, { depth: '1' }]) {
      expect(ACTION_POLICIES['repo.read_diagnose'].params.safeParse(bad).success).toBe(false);
    }
  });
});

describe('pre-execution recheck', () => {
  it('passes every binding check and still stops at the closed action enablement', () => {
    expect(revalidateBeforeExecution(basis(), NOW)).toEqual({
      allowed: false,
      reason: 'action_disabled',
      blockedAt: 'action_enablement',
      passedChecks: allChecksBeforeEnablement,
    });
  });

  it('rejects malformed input and an unusable clock', () => {
    expect(revalidateBeforeExecution({}, NOW)).toEqual({
      allowed: false, reason: 'invalid_request', blockedAt: null, passedChecks: [],
    });
    const extra = { ...basis(), unexpected: true };
    expect(revalidateBeforeExecution(extra, NOW).reason).toBe('invalid_request');
    expect(revalidateBeforeExecution(basis(), new Date('invalid')).reason).toBe('invalid_clock');
  });

  it('rejects a run, card, candidate or action that does not line up', () => {
    const runCard = basis();
    runCard.persisted.run.cardId = 'card-2';
    expect(revalidateBeforeExecution(runCard, NOW).reason).toBe('run_identity_mismatch');

    const runAction = basis();
    runAction.persisted.run.actionId = 'action-2';
    expect(revalidateBeforeExecution(runAction, NOW).reason).toBe('run_identity_mismatch');

    const card = basis();
    card.persisted.card.id = 'card-2';
    expect(revalidateBeforeExecution(card, NOW).reason).toBe('card_binding_mismatch');

    const candidate = basis();
    candidate.persisted.candidate.id = 'candidate-2';
    expect(revalidateBeforeExecution(candidate, NOW).reason).toBe('candidate_binding_mismatch');

    const action = basis();
    action.persisted.action.id = 'action-2';
    expect(revalidateBeforeExecution(action, NOW).reason).toBe('action_identity_mismatch');

    const project = basis();
    project.persisted.card.projectId = 'project-B';
    expect(revalidateBeforeExecution(project, NOW).reason).toBe('project_binding_mismatch');

    const requested = basis();
    requested.request.projectId = 'project-B';
    expect(revalidateBeforeExecution(requested, NOW).reason).toBe('project_binding_mismatch');
  });

  it('rejects a forged idempotency key', () => {
    const input = basis();
    input.persisted.run.idempotencyKey = 'forged';
    expect(revalidateBeforeExecution(input, NOW)).toMatchObject({
      reason: 'idempotency_mismatch', blockedAt: 'idempotency_key',
    });
  });

  it('rejects a card that is not ready or has expired', () => {
    const dismissed = basis();
    dismissed.persisted.card.status = 'dismissed';
    expect(revalidateBeforeExecution(dismissed, NOW).reason).toBe('card_not_ready');

    const expired = basis();
    expired.persisted.card.expiresAt = '2026-11-03T22:29:59.000Z';
    expect(revalidateBeforeExecution(expired, NOW).reason).toBe('card_expired');
  });

  it('rejects a run that is already terminal', () => {
    const input = basis();
    input.persisted.run.state = 'completed';
    expect(revalidateBeforeExecution(input, NOW).reason).toBe('run_not_startable');
  });

  it('rejects parameters outside the frozen schema', () => {
    const input = basis(buildAction({ actionType: 'repo.read_diagnose', params: { depth: 4 } }));
    expect(revalidateBeforeExecution(input, NOW)).toMatchObject({
      reason: 'params_not_allowed', blockedAt: 'parameter_policy',
    });
  });

  it('rejects risk below the floor, L3 and L2 without online approval', () => {
    const belowFloor = basis(buildAction({ risk: 'L0' }));
    expect(revalidateBeforeExecution(belowFloor, NOW).reason).toBe('risk_below_floor');

    const forbidden = basis(buildAction({ risk: 'L3' }));
    forbidden.persisted.grant.risk = 'L3';
    expect(revalidateBeforeExecution(forbidden, NOW).reason).toBe('risk_l3_forbidden');

    const l2 = basis(buildAction({ risk: 'L2' }));
    l2.persisted.grant.risk = 'L2';
    expect(revalidateBeforeExecution(l2, NOW).reason).toBe('online_approval_required');

    l2.request.approvalMode = 'online_explicit';
    expect(revalidateBeforeExecution(l2, NOW).reason).toBe('action_disabled');
  });

  it('rejects a different effect, unreviewed capability or over-budget action', () => {
    const effect = basis(buildAction({ effect: 'external_write' }));
    expect(revalidateBeforeExecution(effect, NOW).reason).toBe('effect_not_permitted');

    const capability = basis(buildAction({ allowedCapabilities: ['artifact.write', 'shell.exec'] }));
    expect(revalidateBeforeExecution(capability, NOW).reason).toBe('capability_not_permitted');

    const steps = basis(buildAction({ maxSteps: 6 }));
    expect(revalidateBeforeExecution(steps, NOW).reason).toBe('budget_not_permitted');

    const timeout = basis(buildAction({ timeoutMs: 60_001 }));
    expect(revalidateBeforeExecution(timeout, NOW).reason).toBe('budget_not_permitted');

    const cost = basis(buildAction({ maxCostUsd: 0.01 }));
    expect(revalidateBeforeExecution(cost, NOW).reason).toBe('budget_not_permitted');
  });

  it('rejects a grant issued to another principal or card', () => {
    const principal = basis();
    principal.persisted.grant.principalId = 'principal-2';
    expect(revalidateBeforeExecution(principal, NOW).reason).toBe('principal_mismatch');

    const card = basis();
    card.persisted.grant.cardId = 'card-2';
    expect(revalidateBeforeExecution(card, NOW).reason).toBe('grant_card_mismatch');
  });

  it('rejects a consumed, expired or not-yet-valid grant', () => {
    const consumed = basis();
    consumed.persisted.grant.consumedAt = '2026-11-03T22:20:00.000Z';
    expect(revalidateBeforeExecution(consumed, NOW).reason).toBe('grant_consumed');

    const expired = basis();
    expired.persisted.grant.expiresAt = '2026-11-03T22:29:59.000Z';
    expect(revalidateBeforeExecution(expired, NOW).reason).toBe('grant_expired');

    const future = basis();
    future.persisted.grant.grantedAt = '2026-11-03T23:00:00.000Z';
    expect(revalidateBeforeExecution(future, NOW).reason).toBe('grant_not_yet_valid');
  });

  it('rejects a grant with insufficient risk or missing capability', () => {
    const risk = basis();
    risk.persisted.grant.risk = 'L0';
    expect(revalidateBeforeExecution(risk, NOW).reason).toBe('grant_risk_insufficient');

    const l3 = basis();
    l3.persisted.grant.risk = 'L3';
    expect(revalidateBeforeExecution(l3, NOW).reason).toBe('grant_risk_insufficient');

    const capability = basis();
    capability.persisted.grant.authorizedCapabilities = ['repo.read'];
    expect(revalidateBeforeExecution(capability, NOW).reason).toBe('grant_capability_missing');
  });

  it('rejects tampered action or target digests', () => {
    const actionDigest = basis();
    actionDigest.persisted.grant.actionDigest = '0'.repeat(64);
    expect(revalidateBeforeExecution(actionDigest, NOW)).toMatchObject({
      reason: 'digest_mismatch', blockedAt: 'digests',
    });

    const targetDigest = basis();
    targetDigest.persisted.grant.targetDigest = '1'.repeat(64);
    expect(revalidateBeforeExecution(targetDigest, NOW).reason).toBe('digest_mismatch');
  });

  it('rejects an action whose expected source version has moved', () => {
    const input = basis();
    input.persisted.currentSourceVersion = 'v2';
    expect(revalidateBeforeExecution(input, NOW)).toMatchObject({
      reason: 'source_version_changed', blockedAt: 'source_version',
    });
  });

  it('never returns an allowed result for any action type', () => {
    for (const actionType of Object.keys(ACTION_POLICIES) as (keyof typeof ACTION_POLICIES)[]) {
      const result = revalidateBeforeExecution(basis(buildAction({ actionType })), NOW);
      expect(result.allowed).toBe(false);
    }
  });
});
