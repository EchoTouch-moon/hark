/**
 * @fileoverview 快照比对引擎（Snapshot Differ）
 * 比较新旧两次 ProjectSnapshot，精细检测出变更项并派生原子事件：
 * - REPOSITORY_HEAD_CHANGED (commit 更新)
 * - REPOSITORY_BRANCH_CHANGED (分支切换/分离头指针)
 * - WORKTREE_STATE_CHANGED (工作区脏文件变化)
 * - TEST_REPORT_UPDATED (测试结果更新)
 * - OBSERVATION_GAP (服务停机或间隙超过阈值)
 * - REPOSITORY_UNAVAILABLE / REPOSITORY_RECOVERED (仓库物理可达性变化)
 */

import type {
  Evidence,
  EventType,
  ObserverEvent,
  ProjectSnapshot,
  ScanReason,
} from './contracts.js';
import { newId } from './ids.js';

/** 快照比对上下文参数 */
export interface DiffContext {
  projectId: string;
  runId: string;
  observedAt: string;
  reason: ScanReason;
  previous: ProjectSnapshot | null;
  current: ProjectSnapshot;
  lastOk: ProjectSnapshot | null;
  lastSuccessAt: string | null;
  lastGapAt: string | null;
  gapThresholdMs: number;
  emitGap: boolean;
  fastForward: boolean | null;
}

/** 辅助构造 ObserverEvent */
function event(
  ctx: DiffContext,
  type: EventType,
  payload: unknown,
  evidence: Omit<Evidence, 'observationRunId'>,
  from: string | null,
  to: string | null,
): ObserverEvent {
  return {
    eventId: newId('evt'),
    projectId: ctx.projectId,
    type,
    observedAt: ctx.observedAt,
    fromSnapshotId: from,
    toSnapshotId: to,
    payload,
    evidence: { ...evidence, observationRunId: ctx.runId },
  };
}

/** 检查工作区状态是否发生变化 */
function worktreeChanged(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
  return JSON.stringify(a.worktree) !== JSON.stringify(b.worktree);
}

/** 检查测试报告与结果是否发生变化 */
function testChanged(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
  return (
    a.test.result !== b.test.result ||
    a.test.evidenceQuality !== b.test.evidenceQuality ||
    a.test.reportFingerprint !== b.test.reportFingerprint ||
    a.test.stale !== b.test.stale ||
    a.test.relativePath !== b.test.relativePath
  );
}

/** 比对具体的字段变更并生成对应事件 */
function fieldEvents(ctx: DiffContext, from: ProjectSnapshot, to: ProjectSnapshot): ObserverEvent[] {
  const events: ObserverEvent[] = [];
  const fromId = from.id;
  const toId = to.id;
  const gitEvidence = { source: 'git' as const, quality: 'OBSERVED' as const };

  if (from.headSha !== to.headSha) {
    events.push(
      event(
        ctx,
        'REPOSITORY_HEAD_CHANGED',
        {
          previous: from.headSha,
          current: to.headSha,
          fastForward: from.headSha !== null && to.headSha !== null ? ctx.fastForward : null,
        },
        gitEvidence,
        fromId,
        toId,
      ),
    );
  }
  if (from.branch !== to.branch || from.detached !== to.detached) {
    events.push(
      event(
        ctx,
        'REPOSITORY_BRANCH_CHANGED',
        {
          previous: from.branch,
          current: to.branch,
          previousDetached: from.detached,
          currentDetached: to.detached,
        },
        gitEvidence,
        fromId,
        toId,
      ),
    );
  }
  if (worktreeChanged(from, to)) {
    events.push(
      event(
        ctx,
        'WORKTREE_STATE_CHANGED',
        { previous: from.worktree, current: to.worktree },
        gitEvidence,
        fromId,
        toId,
      ),
    );
  }
  if (testChanged(from, to)) {
    events.push(
      event(
        ctx,
        'TEST_REPORT_UPDATED',
        { previous: from.test, current: to.test },
        { source: 'junit', quality: to.test.evidenceQuality },
        fromId,
        toId,
      ),
    );
  }
  return events;
}

/**
 * 核心比对函数：根据比对上下文生成变更事件流
 * @param ctx 快照差异比对上下文
 * @returns 派生的观察者事件数组
 */
export function diffSnapshots(ctx: DiffContext): ObserverEvent[] {
  const events: ObserverEvent[] = [];
  if (ctx.emitGap && ctx.lastSuccessAt !== null) {
    const gapMs = Date.parse(ctx.observedAt) - Date.parse(ctx.lastSuccessAt);
    const alreadyDescribed =
      ctx.lastGapAt !== null && Date.parse(ctx.lastGapAt) >= Date.parse(ctx.lastSuccessAt);
    if (Number.isFinite(gapMs) && gapMs >= ctx.gapThresholdMs && !alreadyDescribed) {
      events.push(
        event(
          ctx,
          'OBSERVATION_GAP',
          {
            lastObservedAt: ctx.lastSuccessAt,
            resumedAt: ctx.observedAt,
            gapMs,
            reason: ctx.reason,
          },
          { source: 'system', quality: 'OBSERVED' },
          ctx.previous?.id ?? null,
          ctx.current.id,
        ),
      );
    }
  }

  if (ctx.previous === null) {
    if (ctx.reason === 'register') {
      events.push(
        event(
          ctx,
          'PROJECT_REGISTERED',
          {
            gitIdentity: ctx.current.gitIdentity,
            branch: ctx.current.branch,
            headSha: ctx.current.headSha,
            unborn: ctx.current.unborn,
            detached: ctx.current.detached,
          },
          { source: 'system', quality: 'OBSERVED' },
          null,
          ctx.current.id,
        ),
      );
    }
    return events;
  }

  if (ctx.previous.accessibility === 'OK' && ctx.current.accessibility === 'UNAVAILABLE') {
    events.push(
      event(
        ctx,
        'REPOSITORY_UNAVAILABLE',
        { previousFingerprint: ctx.previous.fingerprint },
        { source: 'git', quality: 'UNKNOWN' },
        ctx.previous.id,
        ctx.current.id,
      ),
    );
    return events;
  }

  if (ctx.previous.accessibility === 'UNAVAILABLE' && ctx.current.accessibility === 'OK') {
    events.push(
      event(
        ctx,
        'REPOSITORY_RECOVERED',
        { currentFingerprint: ctx.current.fingerprint },
        { source: 'git', quality: 'OBSERVED' },
        ctx.previous.id,
        ctx.current.id,
      ),
    );
    const baseline = ctx.lastOk ?? ctx.previous;
    events.push(...fieldEvents(ctx, baseline, ctx.current));
    return events;
  }

  events.push(...fieldEvents(ctx, ctx.previous, ctx.current));
  return events;
}
