export { ProjectObserver, type ProjectObserverOptions } from './observer.js';
export { ObserverError, isObserverError } from './errors.js';
export { redactText } from './redact.js';
export { parsePorcelainV2 } from './git/porcelain.js';
export { parseJunitXml } from './reports/junit.js';
export { DirtyHintBuffer } from './fs/dirty.js';
export { snapshotFingerprint } from './fingerprint.js';
export { createGitRunner, assertAllowedGitArgs, type GitRunner } from './git/run.js';
export {
  CollectionStatusSchema,
  EvidenceQualitySchema,
  EventTypeSchema,
  ObserverEventSchema,
  ProjectSnapshotSchema,
  ProjectSummarySchema,
  RegisterProjectOptionsSchema,
  TestResultSchema,
  type CollectionStatus,
  type EventType,
  type ObservationRun,
  type ObserverEvent,
  type ObserverHealth,
  type PagedEvents,
  type ProjectSnapshot,
  type ProjectSummary,
  type RegisterProjectOptions,
  type RegisteredProject,
  type ReportSource,
  type ScanReason,
  type TestResult,
  type TestSummary,
  type WorktreeSummary,
} from './contracts.js';
