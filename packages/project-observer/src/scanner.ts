/**
 * @fileoverview 项目状态扫描主流程（Project Scanner）
 * 协调采集 Git 信息（HEAD、分支、工作区状态）、测试报告（JUnit XML），
 * 计算状态指纹（fingerprint）、与上一版本快照比对产生增量事件（ObserverEvent），并写入数据库。
 */

import {
  unknownTestSummary,
  type CollectionStatus,
  type ObservationRun,
  type ObserverEvent,
  type ObserverHealth,
  type ProjectSnapshot,
  type ScanReason,
  type TestSummary,
  type WatchStatus,
} from './contracts.js';
import { ObserverError } from './errors.js';
import { diffSnapshots } from './differ.js';
import { snapshotFingerprint } from './fingerprint.js';
import { GitSource } from './git/source.js';
import { newId } from './ids.js';
import { redactText } from './redact.js';
import { TestReportSource } from './reports/source.js';
import type { ObserverStore, TxFault } from './state/store.js';
import type { Clock } from './time.js';
import { nowUtcIso } from './time.js';

/** 扫描执行上下文依赖 */
export interface ScanDeps {
  store: ObserverStore;
  git: GitSource;
  reports: TestReportSource;
  clock: Clock;
  gapThresholdMs: number;
  fault?: TxFault;
}

/**
 * 对指定项目执行单次完整状态采集与增量快照计算
 * @param deps 扫描依赖集合
 * @param projectId 目标项目唯一 ID
 * @param reason 触发本次扫描的原因（如 watch, reconcile, manual 等）
 * @returns 扫描运行结果报告（包含成功或错误信息）
 */
export async function scanProject(deps: ScanDeps, projectId: string, reason: ScanReason): Promise<ObservationRun> {
  const project = deps.store.getProject(projectId);
  if (project === null) {
    throw new ObserverError('PROJECT_NOT_FOUND', `project ${projectId} not found`);
  }
  const startedAt = nowUtcIso(deps.clock);
  const run: ObservationRun = {
    id: newId('run'),
    projectId,
    startedAt,
    finishedAt: null,
    status: 'ok',
    source: reason,
    errorCode: null,
    errorMessage: null,
  };

  const previous = deps.store.getLatestSnapshot(projectId);
  const lastOk = deps.store.getLatestOkSnapshot(projectId);
  const health = deps.store.getHealth(projectId);
  const git = await deps.git.scan(project.canonicalPath);

  const observedAt = nowUtcIso(deps.clock);
  let adapterEvents: ObserverEvent[] = [];
  let test: TestSummary = unknownTestSummary();
  test = { ...test, observedAt };

  if (git.accessibility === 'OK') {
    const sources = deps.store.listReportSources(projectId).filter((source) => source.enabled);
    const headChangedAt =
      lastOk !== null && git.headSha !== lastOk.headSha ? lastOk.observedAt : null;
    for (const source of sources) {
      const scanned = deps.reports.scan(project.canonicalPath, source.relativePath, observedAt, headChangedAt);
      test = scanned.summary;
      if (scanned.adapterError !== undefined) {
        if (lastOk?.test.reportFingerprint !== undefined) {
          test = { ...lastOk.test, evidenceQuality: 'UNKNOWN', stale: true, observedAt };
        }
        adapterEvents.push({
          eventId: newId('evt'),
          projectId,
          type: 'ADAPTER_ERROR',
          observedAt,
          fromSnapshotId: previous?.id ?? null,
          toSnapshotId: null,
          payload: {
            adapter: 'junit',
            errorCode: scanned.adapterError.errorCode,
            message: scanned.adapterError.errorMessage,
            relativePath: source.relativePath,
          },
          evidence: {
            source: 'junit',
            observationRunId: run.id,
            quality: 'UNKNOWN',
            errorCode: scanned.adapterError.errorCode,
          },
        });
      }
    }
    if (
      adapterEvents.length === 0 &&
      test.evidenceQuality === 'UNKNOWN' &&
      lastOk?.test.reportFingerprint !== undefined &&
      sources.length > 0
    ) {
      test = { ...lastOk.test, evidenceQuality: 'UNKNOWN', stale: true, observedAt };
    }
  }

  let fastForward: boolean | null = null;
  if (
    git.accessibility === 'OK' &&
    previous?.headSha !== undefined &&
    previous.headSha !== null &&
    git.headSha !== null &&
    previous.headSha !== git.headSha
  ) {
    fastForward = await deps.git.isFastForward(project.canonicalPath, previous.headSha, git.headSha);
  }

  const snapshotBase = {
    projectId,
    observedAt,
    headSha: git.accessibility === 'UNAVAILABLE' && lastOk !== null ? lastOk.headSha : git.headSha,
    branch: git.accessibility === 'UNAVAILABLE' && lastOk !== null ? lastOk.branch : git.branch,
    detached: git.accessibility === 'UNAVAILABLE' && lastOk !== null ? lastOk.detached : git.detached,
    unborn: git.accessibility === 'UNAVAILABLE' && lastOk !== null ? lastOk.unborn : git.unborn,
    worktree: git.accessibility === 'UNAVAILABLE' && lastOk !== null ? lastOk.worktree : git.worktree,
    test: git.accessibility === 'UNAVAILABLE' && lastOk !== null ? lastOk.test : test,
    accessibility: git.accessibility,
    gitIdentity: git.accessibility === 'UNAVAILABLE' && lastOk !== null ? lastOk.gitIdentity : git.gitIdentity,
  };
  const fingerprint = snapshotFingerprint(snapshotBase);
  const unchanged = previous !== null && previous.fingerprint === fingerprint;
  const snapshot: ProjectSnapshot = {
    id: unchanged && previous !== null ? previous.id : newId('snap'),
    fingerprint,
    ...snapshotBase,
  };

  const emitGap = reason === 'startup' || reason === 'resume' || reason === 'reconcile';
  const events = unchanged
    ? diffSnapshots({
        projectId,
        runId: run.id,
        observedAt,
        reason,
        previous,
        current: snapshot,
        lastOk,
        lastSuccessAt: health?.lastSuccessAt ?? null,
        lastGapAt: health?.lastGapAt ?? null,
        gapThresholdMs: deps.gapThresholdMs,
        emitGap,
        fastForward,
      }).filter((event) => event.type === 'OBSERVATION_GAP')
    : diffSnapshots({
        projectId,
        runId: run.id,
        observedAt,
        reason,
        previous,
        current: snapshot,
        lastOk,
        lastSuccessAt: health?.lastSuccessAt ?? null,
        lastGapAt: health?.lastGapAt ?? null,
        gapThresholdMs: deps.gapThresholdMs,
        emitGap,
        fastForward,
      });

  if (git.accessibility === 'UNAVAILABLE') {
    run.status = git.errorCode === 'GIT_TIMEOUT' || git.errorCode === 'OUTPUT_LIMIT' ? 'timeout' : 'error';
    run.errorCode = git.errorCode ?? 'REPOSITORY_UNAVAILABLE';
    run.errorMessage = git.errorMessage ?? 'repository unavailable';
  } else if (adapterEvents.length > 0) {
    run.status = 'error';
    run.errorCode = String((adapterEvents[0]?.payload as { errorCode?: string } | undefined)?.errorCode ?? 'ADAPTER_ERROR');
    run.errorMessage = redactText(String((adapterEvents[0]?.payload as { message?: string } | undefined)?.message ?? 'adapter error'));
  }

  run.finishedAt = nowUtcIso(deps.clock);
  const collectionStatus = deriveCollectionStatus(
    git.accessibility === 'OK',
    adapterEvents.length > 0,
    health,
  );
  const watchStatus: WatchStatus = deriveWatchStatus(health?.watchStatus ?? 'polling', project.enabled, git.accessibility === 'OK');
  const expectedRevision = health?.currentRevision ?? 0;
  const emittedGap = events.some((event) => event.type === 'OBSERVATION_GAP');

  deps.store.transaction(() => {
    deps.store.insertRun(run);
    injectFault(deps.fault, 'after-run');
    if (!unchanged) {
      deps.store.insertSnapshot(snapshot);
      for (const event of events) {
        if (event.toSnapshotId === null) event.toSnapshotId = snapshot.id;
      }
    }
    injectFault(deps.fault, 'after-snapshot');
    const extraAdapter = unchanged ? [] : adapterEvents.map((event) => ({ ...event, toSnapshotId: snapshot.id }));
    const persistedEvents = [...events, ...extraAdapter];
    if (persistedEvents.length > 0) deps.store.insertEvents(persistedEvents);
    injectFault(deps.fault, 'after-events');
    if (git.gitIdentity !== null && git.accessibility === 'OK') deps.store.setGitIdentity(projectId, git.gitIdentity);
    const nextHealth: ObserverHealth = {
      projectId,
      collectionStatus,
      watchStatus,
      lastSuccessAt: git.accessibility === 'OK' ? run.finishedAt : (health?.lastSuccessAt ?? null),
      lastErrorCode: run.errorCode,
      lastErrorMessage: run.errorMessage,
      lastReconcileAt: reason === 'reconcile' || reason === 'startup' ? run.finishedAt : (health?.lastReconcileAt ?? null),
      lastObservedAt: observedAt,
      lastSnapshotId: snapshot.id,
      currentRevision: expectedRevision + 1,
      lastGapAt: emittedGap ? observedAt : (health?.lastGapAt ?? null),
    };
    if (!deps.store.commitHealth(nextHealth, expectedRevision)) {
      throw new ObserverError('CAS_CONFLICT', 'observation pointer moved concurrently');
    }
    injectFault(deps.fault, 'after-pointer');
  });

  return run;
}

function deriveCollectionStatus(
  gitOk: boolean,
  adapterError: boolean,
  health: ObserverHealth | null,
): CollectionStatus {
  if (!gitOk) return 'UNAVAILABLE';
  if (adapterError) return 'DEGRADED';
  if (health?.watchStatus === 'polling' && health.collectionStatus === 'DEGRADED') return 'DEGRADED';
  return 'OK';
}

function injectFault(fault: TxFault | undefined, at: TxFault): void {
  if (fault === at) {
    throw new ObserverError('INJECTED_FAULT', at);
  }
}

function deriveWatchStatus(previous: WatchStatus, enabled: boolean, gitOk: boolean): WatchStatus {
  if (!enabled) return 'paused';
  if (!gitOk) return 'unavailable';
  if (previous === 'watching') return 'watching';
  return previous === 'unavailable' ? 'polling' : previous;
}
