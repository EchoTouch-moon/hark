/**
 * @fileoverview 项目观察者契约模型（Project Observer Contracts）
 * 定义本地代码仓监控、Git 状态快照（ProjectSnapshot）、工作区状态（WorktreeSummary）、
 * 单元测试测试结果汇总（TestSummary）以及变更观察事件（ObserverEvent）的数据结构。
 */

import { z } from 'zod';

export const IsoDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/,
    'must be ISO-8601 datetime with timezone',
  );
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

export const IdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/);
export type Id = z.infer<typeof IdSchema>;

/** 采集健康度状态：OK(正常), DEGRADED(降级), UNAVAILABLE(不可用) */
export const CollectionStatusSchema = z.enum(['OK', 'DEGRADED', 'UNAVAILABLE']);
export type CollectionStatus = z.infer<typeof CollectionStatusSchema>;

/** 证据质量级别：OBSERVED(实测观察到), UNKNOWN(未知), STALE(已陈旧) */
export const EvidenceQualitySchema = z.enum(['OBSERVED', 'UNKNOWN', 'STALE']);
export type EvidenceQuality = z.infer<typeof EvidenceQualitySchema>;

/** 测试汇总结论：PASS(通过), FAIL(失败), MIXED(混合), UNKNOWN(未检出) */
export const TestResultSchema = z.enum(['PASS', 'FAIL', 'MIXED', 'UNKNOWN']);
export type TestResult = z.infer<typeof TestResultSchema>;

/** 文件监听器状态 */
export const WatchStatusSchema = z.enum(['watching', 'polling', 'paused', 'unavailable']);
export type WatchStatus = z.infer<typeof WatchStatusSchema>;

/** 代码仓路径可达性状态 */
export const AccessibilitySchema = z.enum(['OK', 'UNAVAILABLE']);
export type Accessibility = z.infer<typeof AccessibilitySchema>;

/** 触发扫描的原因分类 */
export const ScanReasonSchema = z.enum([
  'register',
  'watch',
  'reconcile',
  'manual',
  'startup',
  'resume',
]);
export type ScanReason = z.infer<typeof ScanReasonSchema>;

/** 观察者产出的原子事件类型 */
export const EventTypeSchema = z.enum([
  'PROJECT_REGISTERED',        // 项目首次注册
  'REPOSITORY_HEAD_CHANGED',   // Git HEAD 指针变更
  'REPOSITORY_BRANCH_CHANGED', // 分支切换
  'WORKTREE_STATE_CHANGED',    // 工作区文件修改/暂存/未跟踪状态变更
  'TEST_REPORT_UPDATED',       // 测试报告文件（JUnit XML）更新
  'REPOSITORY_UNAVAILABLE',    // 仓库物理路径丢失或无法访问
  'REPOSITORY_RECOVERED',      // 仓库重新恢复可达
  'OBSERVATION_GAP',           // 观察间隙（如进程崩溃后恢复发现差异）
  'ADAPTER_ERROR',             // Git 命令或适配器异常
]);
export type EventType = z.infer<typeof EventTypeSchema>;

/** Git 工作区文件状态统计 */
export const WorktreeSummarySchema = z
  .object({
    /** 工作区是否干净（无修改、无未跟踪文件） */
    clean: z.boolean(),
    /** 是否存在合并冲突 */
    conflicted: z.boolean(),
    /** 暂存区文件数 */
    staged: z.number().int().nonnegative(),
    /** 未暂存但已修改文件数 */
    unstaged: z.number().int().nonnegative(),
    /** 未跟踪文件数 */
    untracked: z.number().int().nonnegative(),
    /** 重命名文件数 */
    renamed: z.number().int().nonnegative(),
    /** 未合并冲突文件数 */
    unmerged: z.number().int().nonnegative(),
  })
  .strict();
export type WorktreeSummary = z.infer<typeof WorktreeSummarySchema>;

export const emptyWorktree = (): WorktreeSummary => ({
  clean: true,
  conflicted: false,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  renamed: 0,
  unmerged: 0,
});

/** 测试运行结果统计信息 */
export const TestSummarySchema = z
  .object({
    result: TestResultSchema,
    evidenceQuality: EvidenceQualitySchema,
    headBound: z.boolean(),
    stale: z.boolean(),
    tests: z.number().int().nonnegative().optional(),
    passed: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative().optional(),
    skipped: z.number().int().nonnegative().optional(),
    errors: z.number().int().nonnegative().optional(),
    generatedAt: IsoDateTimeSchema.optional(),
    observedAt: IsoDateTimeSchema.optional(),
    reportFingerprint: z.string().min(1).max(128).optional(),
    relativePath: z.string().min(1).max(1024).optional(),
    sourceTimeKind: z.enum(['report_timestamp', 'file_mtime', 'none']).optional(),
  })
  .strict();
export type TestSummary = z.infer<typeof TestSummarySchema>;

export const unknownTestSummary = (): TestSummary => ({
  result: 'UNKNOWN',
  evidenceQuality: 'UNKNOWN',
  headBound: false,
  stale: false,
  sourceTimeKind: 'none',
});

/** 项目观察快照（每次扫描产生的完整状态指纹） */
export const ProjectSnapshotSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    observedAt: IsoDateTimeSchema,
    fingerprint: z.string().min(16).max(128),
    headSha: z.string().min(4).max(64).nullable(),
    branch: z.string().min(1).max(256).nullable(),
    detached: z.boolean(),
    unborn: z.boolean(),
    worktree: WorktreeSummarySchema,
    test: TestSummarySchema,
    accessibility: AccessibilitySchema,
    gitIdentity: z.string().min(1).max(4096).nullable(),
  })
  .strict();
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;

export const EvidenceSchema = z
  .object({
    source: z.enum(['git', 'fs', 'junit', 'system']),
    observationRunId: IdSchema,
    quality: EvidenceQualitySchema,
    errorCode: z.string().min(1).max(64).optional(),
  })
  .strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

/** 观察者派生的事件实体 */
export const ObserverEventSchema = z
  .object({
    eventId: IdSchema,
    projectId: IdSchema,
    type: EventTypeSchema,
    observedAt: IsoDateTimeSchema,
    fromSnapshotId: IdSchema.nullable(),
    toSnapshotId: IdSchema.nullable(),
    payload: z.unknown(),
    evidence: EvidenceSchema,
    appendSeq: z.number().int().positive().optional(),
  })
  .strict();
export type ObserverEvent = z.infer<typeof ObserverEventSchema>;

export const ForwardConsumeStatusSchema = z.enum([
  'OK',
  'PROJECT_NOT_FOUND',
  'PROJECT_REMOVED',
  'STREAM_EPOCH_MISMATCH',
  'CURSOR_AHEAD_OF_STREAM',
]);
export type ForwardConsumeStatus = z.infer<typeof ForwardConsumeStatusSchema>;

export const ForwardEventPageSchema = z
  .object({
    events: z.array(ObserverEventSchema),
    nextCursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    highWatermark: z.number().int().nonnegative(),
    streamEpoch: z.number().int().nonnegative(),
    status: ForwardConsumeStatusSchema,
  })
  .strict();
export type ForwardEventPage = z.infer<typeof ForwardEventPageSchema>;

export const ListEventsForwardQuerySchema = z
  .object({
    afterSeq: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(200).optional(),
    highWatermark: z.number().int().nonnegative().optional(),
    expectedEpoch: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ListEventsForwardQuery = z.infer<typeof ListEventsForwardQuerySchema>;

export const ObservationRunSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    startedAt: IsoDateTimeSchema,
    finishedAt: IsoDateTimeSchema.nullable(),
    status: z.enum(['ok', 'error', 'timeout']),
    source: ScanReasonSchema,
    errorCode: z.string().min(1).max(64).nullable(),
    errorMessage: z.string().max(500).nullable(),
  })
  .strict();
export type ObservationRun = z.infer<typeof ObservationRunSchema>;

export const ReportSourceSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    format: z.literal('junit-xml'),
    relativePath: z.string().min(1).max(1024),
    enabled: z.boolean(),
  })
  .strict();
export type ReportSource = z.infer<typeof ReportSourceSchema>;

export const ObserverHealthSchema = z
  .object({
    projectId: IdSchema,
    collectionStatus: CollectionStatusSchema,
    watchStatus: WatchStatusSchema,
    lastSuccessAt: IsoDateTimeSchema.nullable(),
    lastErrorCode: z.string().min(1).max(64).nullable(),
    lastErrorMessage: z.string().max(500).nullable(),
    lastReconcileAt: IsoDateTimeSchema.nullable(),
    lastObservedAt: IsoDateTimeSchema.nullable(),
    lastSnapshotId: IdSchema.nullable(),
    currentRevision: z.number().int().nonnegative(),
    lastGapAt: IsoDateTimeSchema.nullable(),
  })
  .strict();
export type ObserverHealth = z.infer<typeof ObserverHealthSchema>;

export const RegisteredProjectSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1).max(200),
    canonicalPath: z.string().min(1).max(4096),
    gitIdentity: z.string().min(1).max(4096).nullable(),
    enabled: z.boolean(),
    createdAt: IsoDateTimeSchema,
    scanIntervalMs: z.number().int().positive(),
    debounceMs: z.number().int().positive(),
  })
  .strict();
export type RegisteredProject = z.infer<typeof RegisteredProjectSchema>;

export const ProjectSummarySchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1).max(200),
    canonicalPath: z.string().min(1).max(4096),
    enabled: z.boolean(),
    createdAt: IsoDateTimeSchema,
    branch: z.string().nullable(),
    headSha: z.string().nullable(),
    shortSha: z.string().nullable(),
    detached: z.boolean(),
    unborn: z.boolean(),
    worktree: WorktreeSummarySchema.nullable(),
    test: TestSummarySchema.nullable(),
    collectionStatus: CollectionStatusSchema,
    watchStatus: WatchStatusSchema,
    lastSuccessAt: IsoDateTimeSchema.nullable(),
    lastObservedAt: IsoDateTimeSchema.nullable(),
    fingerprint: z.string().nullable(),
  })
  .strict();
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const PagedEventsSchema = z
  .object({
    events: z.array(ObserverEventSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type PagedEvents = z.infer<typeof PagedEventsSchema>;

export const RegisterProjectOptionsSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    reports: z
      .array(
        z
          .object({
            format: z.literal('junit-xml'),
            relativePath: z.string().min(1).max(1024),
          })
          .strict(),
      )
      .max(16)
      .optional(),
    scanIntervalMs: z.number().int().min(10_000).max(3_600_000).optional(),
    debounceMs: z.number().int().min(200).max(10_000).optional(),
  })
  .strict();
export type RegisterProjectOptions = z.infer<typeof RegisterProjectOptionsSchema>;
