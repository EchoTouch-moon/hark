/**
 * @fileoverview Project Observer 读取端口契约与能力边界清单
 *
 * 规范与 ADR-INSIGHT-001 约定：
 * - Insight 模块通过 ObserverReader 端口拉取 Observer 生成的事件流与快照；
 * - P0_CAPABILITIES 显式冻结底层 Observer 提供的能力边界，防止规则引擎假设不存在的字段或能力。
 */

import type { ObserverEventView } from './contracts.js';

/**
 * Observer 读取端口抽象接口
 */
export interface ObserverReader {
  /** 列出所有已注册的项目 ID */
  listProjectIds(): Promise<string[]>;
  /** 正序流式拉取项目追加事件 */
  listEventsForward(input: {
    projectId: string;
    afterSeq?: string;
    limit: number;
  }): Promise<{ events: ObserverEventView[]; nextCursor: string | null; hasMore: boolean }>;
  /** 按快照 ID 查询快照数据 */
  getSnapshot(snapshotId: string): Promise<unknown | null>;
  /** 获取项目采集健康度 */
  getHealth(projectId: string): Promise<unknown>;
  /** 获取项目注册配置 */
  getProject(projectId: string): Promise<unknown | null>;
  /** 列出测试报告源 */
  listReportSources(projectId: string): Promise<unknown[]>;
}

/** 冻结的 Observer 能力矩阵清单（严格防止产生未验证能力依赖） */
export const P0_CAPABILITIES = {
  schemaVersion: 3,
  publicListEventsOrder: 'occurred_at DESC, id DESC',
  publicEventCursor: 'observedAt|eventId',
  publicListEventsHasMore: false,
  eventIdGenerator: 'evt_ + 8 random hex bytes',
  snapshotIdGenerator: 'snap_ + 8 random hex bytes',
  reportSourceIdGenerator: 'rpt_ + 8 random hex bytes',
  appendSeqColumn: true,
  listEventsForward: true,
  getSnapshotByIdOnFacade: false,
  getSnapshotByIdOnStore: true,
  storeDbExposed: true,
  implicitSqliteRowid: true,
  eventDeleteExceptRemoveProject: false,
  pruneRunsCalledFromScanner: false,
  junitHeadBoundAlwaysFalse: true,
  junitCommitShaParsed: false,
  testSummaryHasReportSourceId: false,
  testSummaryHasRelativePath: true,
  testSummaryHasFingerprint: true,
  snapshotHasHeadSha: true,
  p0EvidenceQuality: ['OBSERVED', 'UNKNOWN', 'STALE'] as const,
  p0EvidenceQualityHasUnavailable: false,
  reportSourcesTable: true,
  latestSnapshotTestIsLastReportSource: true,
  eventPushCallback: false,
  healthCurrentRevision: true,
  httpSnapshotById: false,
} as const;
