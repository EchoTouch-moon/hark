import type { ObserverEventView } from './contracts.js';

/**
 * Target P0 read port for P1 (spec §3.1, frozen in ADR-INSIGHT-001).
 * Methods marked "P0 today" exist on ProjectObserver / ObserverStore.
 * `listEventsForward` is required before S1 consumption and is not on the P0 facade.
 */
export interface ObserverReader {
  listProjectIds(): Promise<string[]>;
  /**
   * Forward consumption. `afterSeq` is an opaque monotonic append cursor from P0 v3.
   * **Not implemented by P0 public API as of S0.**
   */
  listEventsForward(input: {
    projectId: string;
    afterSeq?: string;
    limit: number;
  }): Promise<{ events: ObserverEventView[]; nextCursor: string | null; hasMore: boolean }>;
  getSnapshot(snapshotId: string): Promise<unknown | null>;
  getHealth(projectId: string): Promise<unknown>;
  getProject(projectId: string): Promise<unknown | null>;
  listReportSources(projectId: string): Promise<unknown[]>;
}

/** Inventory frozen against packages/project-observer at S0. Do not treat wished fields as present. */
export const P0_CAPABILITIES = {
  schemaVersion: 2,
  publicListEventsOrder: 'occurred_at DESC, id DESC',
  publicEventCursor: 'observedAt|eventId',
  publicListEventsHasMore: false,
  eventIdGenerator: 'evt_ + 8 random hex bytes',
  snapshotIdGenerator: 'snap_ + 8 random hex bytes',
  reportSourceIdGenerator: 'rpt_ + 8 random hex bytes',
  appendSeqColumn: false,
  listEventsForward: false,
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
