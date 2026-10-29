/**
 * @fileoverview 业务信号提取器（Signal Extractor）
 * 从低级系统观察事件（ObserverEvent）中纯函数式提炼高层业务信号（ExtractedSignal），
 * 包括：Git HEAD 跃迁、分支切换、工作区脏状态、测试报告失败与测试结果指标变化。
 * 计算确定性 signalKey，保证无论如何重放，信号 ID 完全恒定。
 */

import { TestSummarySchema, type ObserverEvent, type ProjectSnapshot, type TestSummary } from '@hearth/project-observer';
import { canonicalSerialize, sha256Hex } from '../canonical.js';
import {
  EXTRACTOR_VERSION,
  mapP0EvidenceQuality,
  reportSourceSubjectKey,
  type EvidenceQuality,
  type EvidenceRef,
  type ExtractedSignal,
  type HeadBinding,
  type P0EvidenceQuality,
  type SignalKind,
} from '../contracts.js';

/** 信号提取上下文 */
export interface ExtractContext {
  streamEpoch: number;
  fromSnapshot: ProjectSnapshot | null;
  toSnapshot: ProjectSnapshot | null;
  legacyOrderReconstructed: boolean;
}

const HEAD_BINDING: HeadBinding = 'UNDETERMINED';

/**
 * 确定性派生信号唯一键（Signal Key）
 */
export function signalKeyFor(input: {
  projectId: string;
  streamEpoch: number;
  sourceEventId: string;
  kind: SignalKind;
  subject: string;
}): string {
  return sha256Hex(
    canonicalSerialize({
      extractorVersion: EXTRACTOR_VERSION,
      kind: input.kind,
      projectId: input.projectId,
      sourceEventId: input.sourceEventId,
      streamEpoch: input.streamEpoch,
      subject: input.subject,
    }),
  );
}

function p0Quality(value: string): P0EvidenceQuality {
  if (value === 'STALE' || value === 'UNKNOWN' || value === 'OBSERVED') return value;
  return 'UNKNOWN';
}

function qualityFor(event: ObserverEvent, snapshot: ProjectSnapshot | null): EvidenceQuality {
  const accessibility = snapshot?.accessibility === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'OK';
  return mapP0EvidenceQuality(p0Quality(event.evidence.quality), accessibility);
}

function refsFor(event: ObserverEvent, ctx: ExtractContext, quality: EvidenceQuality): EvidenceRef[] {
  const refs: EvidenceRef[] = [
    {
      kind: 'observer_event',
      projectId: event.projectId,
      id: event.eventId,
      observedAt: event.observedAt,
      quality,
      role: 'trigger',
    },
    {
      kind: 'observation_run',
      projectId: event.projectId,
      id: event.evidence.observationRunId,
      observedAt: event.observedAt,
      quality,
      role: 'context',
    },
  ];
  if (ctx.fromSnapshot !== null) {
    refs.push({
      kind: 'observer_snapshot',
      projectId: event.projectId,
      id: ctx.fromSnapshot.id,
      observedAt: ctx.fromSnapshot.observedAt,
      quality: ctx.fromSnapshot.accessibility === 'UNAVAILABLE' ? 'UNAVAILABLE' : quality,
      role: 'baseline',
    });
  }
  if (ctx.toSnapshot !== null) {
    refs.push({
      kind: 'observer_snapshot',
      projectId: event.projectId,
      id: ctx.toSnapshot.id,
      observedAt: ctx.toSnapshot.observedAt,
      quality: ctx.toSnapshot.accessibility === 'UNAVAILABLE' ? 'UNAVAILABLE' : quality,
      role: 'context',
    });
  }
  return refs.slice(0, 12);
}

function baseFacts(event: ObserverEvent, ctx: ExtractContext): Record<string, unknown> {
  return {
    appendSeq: event.appendSeq ?? null,
    eventType: event.type,
    legacyOrderReconstructed: ctx.legacyOrderReconstructed,
    orderUncertainty: ctx.legacyOrderReconstructed ? 'reconstructed_rowid' : 'append_seq',
  };
}

function signal(
  event: ObserverEvent,
  ctx: ExtractContext,
  kind: SignalKind,
  subject: string,
  quality: EvidenceQuality,
  comparable: boolean,
  facts: Record<string, unknown>,
): ExtractedSignal {
  const appendSeq = event.appendSeq;
  if (appendSeq === undefined) {
    throw new Error('extractSignalsFromEvent requires appendSeq');
  }
  const fromSnapshotId = event.fromSnapshotId ?? undefined;
  const toSnapshotId = event.toSnapshotId ?? undefined;
  return {
    signalKey: signalKeyFor({
      projectId: event.projectId,
      streamEpoch: ctx.streamEpoch,
      sourceEventId: event.eventId,
      kind,
      subject,
    }),
    projectId: event.projectId,
    kind,
    observedAt: event.observedAt,
    sourceEventIds: [event.eventId],
    ...(fromSnapshotId === undefined ? {} : { fromSnapshotId }),
    ...(toSnapshotId === undefined ? {} : { toSnapshotId }),
    evidenceQuality: quality,
    comparable,
    headBinding: HEAD_BINDING,
    facts: { ...baseFacts(event, ctx), ...facts },
    streamEpoch: ctx.streamEpoch,
    appendSeq,
    subject,
    extractorVersion: EXTRACTOR_VERSION,
    evidenceRefs: refsFor(event, ctx, quality),
  };
}

function asTestSummary(value: unknown): TestSummary | null {
  const parsed = TestSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function hasObservedFailures(test: TestSummary): boolean {
  if (test.evidenceQuality === 'UNKNOWN') return false;
  if (test.result === 'FAIL' || test.result === 'MIXED') return true;
  return (test.failed ?? 0) > 0 || (test.errors ?? 0) > 0;
}

function countsComparable(previous: TestSummary, current: TestSummary): boolean {
  if (previous.relativePath === undefined || current.relativePath === undefined) return false;
  if (previous.relativePath !== current.relativePath) return false;
  if (previous.reportFingerprint === undefined || current.reportFingerprint === undefined) return false;
  if (previous.evidenceQuality === 'UNKNOWN' || current.evidenceQuality === 'UNKNOWN') return false;
  return previous.tests !== undefined && current.tests !== undefined;
}

function statsChanged(previous: TestSummary, current: TestSummary): boolean {
  return (
    previous.result !== current.result ||
    previous.failed !== current.failed ||
    previous.errors !== current.errors ||
    previous.passed !== current.passed ||
    previous.tests !== current.tests ||
    previous.skipped !== current.skipped
  );
}

function payloadRecord(event: ObserverEvent): Record<string, unknown> {
  return event.payload !== null && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : {};
}

/**
 * Pure extractor. Never infers HEAD binding from headBound:false.
 * Does not emit TEST_EVIDENCE_NOT_CURRENT (R-TEST-EVIDENCE-GAP stays off).
 */
export function extractSignalsFromEvent(event: ObserverEvent, ctx: ExtractContext): ExtractedSignal[] {
  if (event.appendSeq === undefined) return [];
  const quality = qualityFor(event, ctx.toSnapshot ?? ctx.fromSnapshot);
  const payload = payloadRecord(event);

  switch (event.type) {
    case 'PROJECT_REGISTERED':
      return [];
    case 'REPOSITORY_HEAD_CHANGED':
      return [
        signal(event, ctx, 'REPOSITORY_HEAD_CHANGED', 'git:head', quality, true, {
          previous: payload['previous'] ?? null,
          current: payload['current'] ?? null,
          fastForward: payload['fastForward'] ?? null,
        }),
      ];
    case 'REPOSITORY_BRANCH_CHANGED':
      return [
        signal(event, ctx, 'REPOSITORY_BRANCH_CHANGED', 'git:branch', quality, true, {
          previous: payload['previous'] ?? null,
          current: payload['current'] ?? null,
        }),
      ];
    case 'WORKTREE_STATE_CHANGED':
      return [
        signal(event, ctx, 'WORKTREE_STATE_CHANGED', 'git:worktree', quality, true, {
          previous: payload['previous'] ?? null,
          current: payload['current'] ?? null,
        }),
      ];
    case 'OBSERVATION_GAP':
      return [
        signal(event, ctx, 'OBSERVATION_GAP_DETECTED', 'observer:gap', quality, false, {
          lastObservedAt: payload['lastObservedAt'] ?? null,
          resumedAt: payload['resumedAt'] ?? null,
          gapMs: payload['gapMs'] ?? null,
        }),
      ];
    case 'ADAPTER_ERROR': {
      const relativePath = typeof payload['relativePath'] === 'string' ? payload['relativePath'] : undefined;
      const subject = relativePath === undefined ? 'observer:adapter' : reportSourceSubjectKey(relativePath);
      return [
        signal(event, ctx, 'ADAPTER_ERROR_OBSERVED', subject, 'UNKNOWN', false, {
          errorCode: payload['errorCode'] ?? event.evidence.errorCode ?? null,
          relativePath: relativePath ?? null,
        }),
      ];
    }
    case 'REPOSITORY_UNAVAILABLE':
      return [
        signal(event, ctx, 'REPOSITORY_UNAVAILABLE_OBSERVED', 'git:repository', 'UNAVAILABLE', false, {
          previousFingerprint: payload['previousFingerprint'] ?? null,
        }),
      ];
    case 'REPOSITORY_RECOVERED':
      return [
        signal(event, ctx, 'REPOSITORY_RECOVERED', 'git:repository', quality, false, {
          currentFingerprint: payload['currentFingerprint'] ?? null,
        }),
      ];
    case 'TEST_REPORT_UPDATED': {
      const previous = asTestSummary(payload['previous']);
      const current = asTestSummary(payload['current']);
      if (current === null) return [];
      const relativePath = current.relativePath ?? previous?.relativePath;
      if (relativePath === undefined) return [];
      const subject = reportSourceSubjectKey(relativePath);
      const out: ExtractedSignal[] = [];
      const testQuality = current.evidenceQuality === 'STALE' ? 'STALE' : quality;
      if (hasObservedFailures(current)) {
        out.push(
          signal(event, ctx, 'TEST_REPORT_FAILURE_OBSERVED', subject, testQuality, false, {
            relativePath,
            result: current.result,
            failed: current.failed ?? null,
            errors: current.errors ?? null,
            stale: current.stale,
            headBound: current.headBound,
            reportFingerprint: current.reportFingerprint ?? null,
            claimedHeadBinding: HEAD_BINDING,
          }),
        );
      }
      if (previous !== null && countsComparable(previous, current) && statsChanged(previous, current)) {
        out.push(
          signal(event, ctx, 'TEST_REPORT_RESULT_CHANGED', subject, testQuality, true, {
            relativePath,
            previousResult: previous.result,
            currentResult: current.result,
            previousFailed: previous.failed ?? null,
            currentFailed: current.failed ?? null,
            previousErrors: previous.errors ?? null,
            currentErrors: current.errors ?? null,
            headBound: current.headBound,
            claimedHeadBinding: HEAD_BINDING,
          }),
        );
      }
      return out;
    }
    default:
      return [];
  }
}
