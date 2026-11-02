/**
 * @fileoverview 任务执行编排器（Orchestrator）
 * 核心调度流水线：Policy Gate 策略门禁 -> Executor 执行 -> Verifier 独立产物核验 -> 终态流转。
 * 强制以数据库为权威事实来源，所有状态流转受契约状态机约束，并具备启动时中断任务对账恢复（S09）能力。
 */

import type { ActionCard, ActionSpec, ApprovalGrant, SourceRef, TaskRun } from '@hearth/contracts';
import { actionDigest, targetDigest } from '@hearth/contracts';
import type { Storage } from '@hearth/storage';
import { evaluatePolicy } from '../policy/policy.js';
import { ACTION_REGISTRY, isRegisteredActionType, maxRisk } from '../policy/action-registry.js';
import { MockExecutor, type ExecutorResult } from './executor.js';
import { IndependentVerifier, type VerifyResult } from '../verify/verifier.js';
import { promises as fsPromises } from 'node:fs';
import { mkdirSync } from 'node:fs';

/** 卡片已过期异常 */
export class CardExpiredError extends Error {
  code = 'CARD_EXPIRED';
  constructor(cardId: string) {
    super(`card ${cardId} expired; rescan required`);
  }
}

/** 实体未找到异常 */
export class NotFoundError extends Error {
  code = 'NOT_FOUND';
  statusCode = 404;
  constructor(what: string) {
    super(what);
  }
}

/** 状态冲突异常 */
export class ConflictError extends Error {
  code = 'CONFLICT';
  statusCode = 409;
  constructor(what: string) {
    super(what);
  }
}

/** Legacy executors are unavailable unless explicitly enabled by an isolated harness. */
export class LegacyActionsDisabledError extends Error {
  code = 'LEGACY_ACTIONS_DISABLED';
  statusCode = 403;
  constructor() { super('Legacy execution is disabled'); }
}

/** 编排器依赖接口 */
export interface OrchestratorDeps {
  storage: Storage;
  artifactRoot: string;
  clock: () => string;
  stepDelayMs?: number;
  onRunUpdate?: (run: TaskRun) => void;
  /** Test-only opt-in for independently isolated synthetic data and artifacts. */
  allowLegacyExecution?: boolean;
}

const CARD_TERMINAL = new Set(['completed', 'failed', 'dismissed', 'expired', 'cancelled']);

/**
 * 任务生命周期编排器
 * 核心流水线：Policy Gate 检查 -> 执行器调度 -> 独立核验器验证 -> 状态流转
 */
export class Orchestrator {
  private readonly executor: MockExecutor;
  private readonly verifier: IndependentVerifier;

  constructor(private readonly deps: OrchestratorDeps) {
    mkdirSync(deps.artifactRoot, { recursive: true });
    this.executor = new MockExecutor({ artifactRoot: deps.artifactRoot, storage: deps.storage, clock: deps.clock, stepDelayMs: deps.stepDelayMs });
    this.verifier = new IndependentVerifier(deps.artifactRoot);
  }

  get legacyExecutionEnabled(): boolean {
    return this.deps.allowLegacyExecution === true;
  }

  /** Entry point for POST /cards/:id/execute. Returns the (possibly existing) run. */
  async executeCard(
    cardId: string,
    principal: string,
    opts: { awaitCompletion?: boolean } = {},
  ): Promise<{ run: TaskRun; alreadyRunning: boolean; card: ActionCard }> {
    if (!this.legacyExecutionEnabled) throw new LegacyActionsDisabledError();
    const { storage } = this.deps;
    const card = storage.getCard(cardId);
    if (!card) throw new NotFoundError(`card ${cardId} not found`);
    const now = this.deps.clock();

    if (now >= card.expiresAt) {
      storage.updateCard(cardId, { status: 'expired' });
      storage.audit('card.expired', principal, cardId, {});
      throw new CardExpiredError(cardId);
    }
    if (card.status === 'dismissed' || card.status === 'expired') {
      throw new ConflictError(`card ${cardId} is ${card.status}`);
    }
    if (card.status === 'completed') {
      const prior = storage.getRunByCard(cardId);
      if (prior) return { run: prior, alreadyRunning: true, card };
      throw new ConflictError('card completed without run record');
    }

    const existing = storage.getRunByCard(cardId);
    if (existing && !['completed', 'failed', 'cancelled', 'blocked'].includes(existing.state)) {
      return { run: existing, alreadyRunning: true, card };
    }

    const runId = `run-${cardId.replace('card-', '')}-${card.action.idempotencyKey.slice(0, 8)}`;
    const { run, existing: dup } = storage.createRun(
      {
        id: runId,
        cardId,
        actionId: card.action.id,
        idempotencyKey: card.action.idempotencyKey,
        state: 'queued',
        createdAt: now,
        resultArtifactRefs: [],
      },
      card.action,
    );
    storage.audit('run.queued', principal, run.id, { cardId });
    this.emit(run);

    if (dup) return { run, alreadyRunning: true, card };

    const pipeline = this.process(run, card, principal);
    if (opts.awaitCompletion) await pipeline;
    else void pipeline.catch((err) => this.deps.storage.audit('run.pipeline_error', 'system', run.id, { error: String(err) }));
    return { run: storage.getRun(run.id) ?? run, alreadyRunning: false, card };
  }

  /** POST /approvals/:runId — explicit approve/deny for awaiting_approval runs. */
  async decideApproval(runId: string, decision: 'approve' | 'deny', principal: string): Promise<TaskRun> {
    if (!this.legacyExecutionEnabled) throw new LegacyActionsDisabledError();
    const { storage } = this.deps;
    const run = storage.getRun(runId);
    if (!run) throw new NotFoundError(`run ${runId} not found`);
    if (run.state !== 'awaiting_approval') throw new ConflictError(`run ${runId} is ${run.state}, not awaiting_approval`);
    const card = storage.getCard(run.cardId);
    const spec = storage.getRunActionSnapshot(runId);
    if (!card || !spec) throw new NotFoundError('card or action snapshot missing');

    if (decision === 'deny') {
      const updated = storage.transitionRun(runId, 'blocked', { endedAt: this.deps.clock(), failureClass: 'policy' }, { actor: principal, details: { decision } });
      storage.updateCard(card.id, { status: 'blocked' });
      storage.audit('approval.denied', principal, runId, {});
      this.emit(updated);
      return updated;
    }

    const now = this.deps.clock();
    const grant: ApprovalGrant = {
      id: `appr-${runId}`,
      principalId: principal,
      cardId: card.id,
      actionDigest: actionDigest(spec),
      targetDigest: targetDigest(spec),
      risk: spec.risk,
      authorizedCapabilities: spec.allowedCapabilities,
      expiresAt: new Date(new Date(now).getTime() + 10 * 60_000).toISOString(),
      grantedAt: now,
    };
    storage.insertGrant(grant);
    storage.audit('approval.granted', principal, runId, {
      actionDigest: grant.actionDigest.slice(0, 12),
      expiresAt: grant.expiresAt,
    });

    const updated = storage.getRun(runId)!;
    const pipeline = this.process(updated, card, principal);
    await pipeline;
    return storage.getRun(runId)!;
  }

  async cancel(runId: string, principal: string): Promise<TaskRun> {
    const { storage } = this.deps;
    const run = storage.getRun(runId);
    if (!run) throw new NotFoundError(`run ${runId} not found`);
    if (['completed', 'failed', 'cancelled'].includes(run.state)) return run;
    if (run.state === 'blocked') return run;
    if (run.state === 'pending_verification') return run;
    if (run.state === 'verifying') {
      // A previous effect may already have happened; do not claim it was undone.
      const updated = storage.transitionRun(runId, 'pending_verification', { failureClass: 'unknown' }, { actor: principal, details: { cancellation: 'verification-interrupted' } });
      storage.audit('run.cancel_requested', principal, runId, { result: 'pending_verification' });
      this.emit(updated);
      return updated;
    }
    const updated = storage.transitionRun(runId, 'cancelled', { endedAt: this.deps.clock() }, { actor: principal });
    // contract has no `cancelled` card status: a cancelled run returns the card to proposal
    storage.updateCard(run.cardId, { status: 'proposed' });
    storage.audit('run.cancelled', principal, runId, {});
    this.emit(updated);
    return updated;
  }

  /** S09: on boot, interrupted executing/verifying runs are reconciled, never blindly re-executed. */
  async recoverInterrupted(principal = 'system'): Promise<TaskRun[]> {
    const { storage } = this.deps;
    const interrupted = [...storage.listRunsInStates(['executing']), ...storage.listRunsInStates(['verifying'])];
    const recovered: TaskRun[] = [];
    for (const run of interrupted) {
      // Outside an explicitly isolated test harness, never turn legacy runs
      // into new completion claims during startup recovery.
      if (!this.legacyExecutionEnabled) {
        const updated = storage.transitionRun(run.id, 'pending_verification', { failureClass: 'unknown' }, { actor: principal, details: { recovery: 'legacy-disabled' } });
        recovered.push(updated);
        this.emit(updated);
        continue;
      }
      const spec = storage.getRunActionSnapshot(run.id);
      if (!spec) {
        const updated = storage.transitionRun(run.id, 'pending_verification', { failureClass: 'unknown' }, { actor: principal, details: { recovery: 'snapshot-missing' } });
        recovered.push(updated);
        continue;
      }
      const verdict = await this.verifier.verify(spec, { ok: true, artifactRelPath: spec.verification.artifactPath });
      if (verdict.verdict === 'pass') {
        const updated = storage.transitionRun(
          run.id,
          run.state === 'verifying' ? 'completed' : 'verifying',
          run.state === 'verifying' ? { verificationVerdict: 'pass', endedAt: this.deps.clock(), resultArtifactRefs: verdict.artifactPath ? [verdict.artifactPath] : [] } : {},
          { actor: principal, details: { recovery: 'artifact-reverified' } },
        );
        if (run.state === 'executing' && updated.state === 'verifying') {
          const done = storage.transitionRun(run.id, 'completed', { verificationVerdict: 'pass', endedAt: this.deps.clock() }, { actor: principal, details: { recovery: 'artifact-reverified' } });
          recovered.push(done);
        } else {
          recovered.push(updated);
        }
        storage.updateCard(run.cardId, { status: 'completed' });
      } else {
        const updated = storage.transitionRun(run.id, 'pending_verification', { failureClass: 'unknown' }, { actor: principal, details: { recovery: 'artifact-not-confirmable', verdict: verdict.verdict } });
        recovered.push(updated);
        storage.updateCard(run.cardId, { status: 'verifying' });
      }
      this.emit(updated_run(storage, run.id));
    }
    return recovered;
  }

  private async process(run: TaskRun, card: ActionCard, principal: string): Promise<void> {
    const { storage } = this.deps;
    const spec = storage.getRunActionSnapshot(run.id);
    if (!spec) throw new NotFoundError(`action snapshot for ${run.id} missing`);

    // 1) policy gate (re-read from DB — never trust the request)
    const candidate = storage.getCandidate(card.candidateId);
    const eventId = candidate?.eventIds[0];
    const actualSourceVersion = eventId ? storage.getSourceVersion(eventId) : undefined;
    const decision = await evaluatePolicy(spec, {
      now: this.deps.clock(),
      allowedProjectIds: storage.listProjects().map((p) => p.id),
      grants: storage.listGrantsForCard(card.id),
      actualSourceVersion: actualSourceVersion ?? undefined,
      demoArtifactRoot: this.deps.artifactRoot,
      fs: { realpath: (p) => fsPromises.realpath(p), stat: (p) => fsPromises.stat(p).then((s) => s, () => null) },
    });
    storage.audit(`policy.${decision.decision}`, principal, run.id, { reason: decision.reason, code: 'code' in decision ? decision.code : undefined });

    if (decision.decision === 'deny') {
      const updated = storage.transitionRun(run.id, 'blocked', { endedAt: this.deps.clock(), failureClass: 'policy' }, { actor: principal });
      storage.updateCard(card.id, { status: 'blocked' });
      this.emit(updated);
      return;
    }
    if (decision.decision === 'await_approval') {
      const updated = storage.transitionRun(run.id, 'awaiting_approval', {}, { actor: principal });
      storage.updateCard(card.id, { status: 'awaiting_approval' });
      this.emit(updated);
      return;
    }

    // 2) execute
    let executing = storage.transitionRun(run.id, 'executing', { startedAt: this.deps.clock() }, { actor: principal });
    storage.updateCard(card.id, { status: 'executing' });
    this.emit(executing);

    const result: ExecutorResult = await this.executor.execute({
      runId: run.id,
      spec,
      isCancelled: async () => {
        const cur = storage.getRun(run.id);
        return cur === null || cur.state === 'cancelled';
      },
    });

    if (!result.ok) {
      const cancelled = (storage.getRun(run.id)?.state ?? '') === 'cancelled';
      if (cancelled || result.error === 'cancelled') {
        const updated = storage.getRun(run.id)!;
        storage.updateCard(card.id, { status: 'proposed' });
        this.emit(updated);
        return;
      }
      const updated = storage.transitionRun(
        run.id,
        'failed',
        { endedAt: this.deps.clock(), failureClass: result.failureClass ?? 'executor' },
        { actor: principal, details: { error: result.error } },
      );
      storage.updateCard(card.id, { status: 'failed' });
      this.emit(updated);
      return;
    }

    // 3) verify (independent)
    executing = storage.transitionRun(run.id, 'verifying', {}, { actor: principal });
    storage.updateCard(card.id, { status: 'verifying' });
    this.emit(executing);

    const verdict: VerifyResult = await this.verifier.verify(spec, result);
    if (verdict.verdict === 'pass') {
      const updated = storage.transitionRun(
        run.id,
        'completed',
        {
          verificationVerdict: 'pass',
          endedAt: this.deps.clock(),
          resultArtifactRefs: verdict.artifactPath ? [verdict.artifactPath] : [],
        },
        { actor: 'verifier', details: { kind: verdict.kind, sha256: verdict.sha256 } },
      );
      storage.addEvidence({
        id: `evd-${run.id}`,
        runId: run.id,
        sourceRef: card.evidence[0] as SourceRef,
        sha256: verdict.sha256 ?? 'unknown',
        kind: verdict.kind,
        artifactPath: verdict.artifactPath,
        createdAt: this.deps.clock(),
      });
      storage.updateCard(card.id, { status: 'completed', userFeedback: card.userFeedback });
      this.emit(updated);
      return;
    }
    if (verdict.verdict === 'fail') {
      const updated = storage.transitionRun(
        run.id,
        'failed',
        { endedAt: this.deps.clock(), failureClass: 'verification', verificationVerdict: 'fail' },
        { actor: 'verifier', details: { reason: verdict.reason } },
      );
      storage.updateCard(card.id, { status: 'failed' });
      this.emit(updated);
      return;
    }
    const updated = storage.transitionRun(run.id, 'pending_verification', { failureClass: 'unknown' }, { actor: 'verifier', details: { reason: verdict.reason } });
    storage.updateCard(card.id, { status: 'verifying' });
    this.emit(updated);
  }

  private emit(run: TaskRun): void {
    this.deps.onRunUpdate?.(run);
  }
}

function updated_run(storage: Storage, runId: string): TaskRun {
  return storage.getRun(runId)!;
}

export { ACTION_REGISTRY, isRegisteredActionType, maxRisk };
