import { z } from 'zod';
import { apiFetch } from './api/client';

export type CollectionStatus = 'OK' | 'DEGRADED' | 'UNAVAILABLE';
export type EvidenceQuality = 'OBSERVED' | 'UNKNOWN' | 'STALE';
export type TestResult = 'PASS' | 'FAIL' | 'MIXED' | 'UNKNOWN';
export type WatchStatus = 'watching' | 'polling' | 'paused' | 'unavailable';
export type ObserverEventType =
  | 'PROJECT_REGISTERED'
  | 'REPOSITORY_HEAD_CHANGED'
  | 'REPOSITORY_BRANCH_CHANGED'
  | 'WORKTREE_STATE_CHANGED'
  | 'TEST_REPORT_UPDATED'
  | 'REPOSITORY_UNAVAILABLE'
  | 'REPOSITORY_RECOVERED'
  | 'OBSERVATION_GAP'
  | 'ADAPTER_ERROR';

export interface WorktreeSummary {
  clean: boolean;
  conflicted: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  renamed: number;
  unmerged: number;
}

export interface TestSummary {
  result: TestResult;
  evidenceQuality: EvidenceQuality;
  headBound: boolean;
  stale: boolean;
  tests?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  errors?: number;
  generatedAt?: string;
  observedAt?: string;
  reportFingerprint?: string;
  relativePath?: string;
  sourceTimeKind?: 'report_timestamp' | 'file_mtime' | 'none';
}

export interface ObserverProjectSummary {
  id: string;
  name: string;
  canonicalPath: string;
  enabled: boolean;
  createdAt: string;
  branch: string | null;
  headSha: string | null;
  shortSha: string | null;
  detached: boolean;
  unborn: boolean;
  worktree: WorktreeSummary | null;
  test: TestSummary | null;
  collectionStatus: CollectionStatus;
  watchStatus: WatchStatus;
  lastSuccessAt: string | null;
  lastObservedAt: string | null;
  fingerprint: string | null;
}

export interface ObserverSnapshot {
  id: string;
  projectId: string;
  observedAt: string;
  fingerprint: string;
  headSha: string | null;
  branch: string | null;
  detached: boolean;
  unborn: boolean;
  worktree: WorktreeSummary;
  test: TestSummary;
  accessibility: 'OK' | 'UNAVAILABLE';
  gitIdentity: string | null;
}

export interface ObserverHealth {
  projectId: string;
  collectionStatus: CollectionStatus;
  watchStatus: WatchStatus;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastReconcileAt: string | null;
  lastObservedAt: string | null;
  lastSnapshotId: string | null;
}

export interface ObserverEvent {
  eventId: string;
  projectId: string;
  type: ObserverEventType;
  observedAt: string;
  fromSnapshotId: string | null;
  toSnapshotId: string | null;
  payload: unknown;
  evidence: {
    source: 'git' | 'fs' | 'junit' | 'system';
    observationRunId: string;
    quality: EvidenceQuality;
    errorCode?: string;
  };
}

export interface ObserverDetail {
  project: {
    id: string;
    name: string;
    canonicalPath: string;
    gitIdentity: string | null;
    enabled: boolean;
    createdAt: string;
    scanIntervalMs: number;
    debounceMs: number;
  };
  snapshot: ObserverSnapshot | null;
  health: ObserverHealth;
  reports: Array<{ id: string; projectId: string; format: 'junit-xml'; relativePath: string; enabled: boolean }>;
}

const WorktreeSchema = z.object({
  clean: z.boolean(), conflicted: z.boolean(), staged: z.number(), unstaged: z.number(),
  untracked: z.number(), renamed: z.number(), unmerged: z.number(),
});
const TestSchema = z.object({
  result: z.enum(['PASS', 'FAIL', 'MIXED', 'UNKNOWN']), evidenceQuality: z.enum(['OBSERVED', 'UNKNOWN', 'STALE']),
  headBound: z.boolean(), stale: z.boolean(), tests: z.number().optional(), passed: z.number().optional(),
  failed: z.number().optional(), skipped: z.number().optional(), errors: z.number().optional(),
  generatedAt: z.string().optional(), observedAt: z.string().optional(), reportFingerprint: z.string().optional(),
  relativePath: z.string().optional(), sourceTimeKind: z.enum(['report_timestamp', 'file_mtime', 'none']).optional(),
});
const CollectionSchema = z.enum(['OK', 'DEGRADED', 'UNAVAILABLE']);
const WatchSchema = z.enum(['watching', 'polling', 'paused', 'unavailable']);
const ProjectSummarySchema = z.object({
  id: z.string().min(1), name: z.string(), canonicalPath: z.string(), enabled: z.boolean(), createdAt: z.string(),
  branch: z.string().nullable(), headSha: z.string().nullable(), shortSha: z.string().nullable(),
  detached: z.boolean(), unborn: z.boolean(), worktree: WorktreeSchema.nullable(), test: TestSchema.nullable(),
  collectionStatus: CollectionSchema, watchStatus: WatchSchema, lastSuccessAt: z.string().nullable(),
  lastObservedAt: z.string().nullable(), fingerprint: z.string().nullable(),
});
const ObserverDetailSchema = z.object({
  project: z.object({ id: z.string().min(1), name: z.string(), canonicalPath: z.string(), gitIdentity: z.string().nullable(),
    enabled: z.boolean(), createdAt: z.string(), scanIntervalMs: z.number(), debounceMs: z.number() }),
  snapshot: z.object({ id: z.string(), projectId: z.string(), observedAt: z.string(), fingerprint: z.string(),
    headSha: z.string().nullable(), branch: z.string().nullable(), detached: z.boolean(), unborn: z.boolean(),
    worktree: WorktreeSchema, test: TestSchema, accessibility: z.enum(['OK', 'UNAVAILABLE']), gitIdentity: z.string().nullable() }).nullable(),
  health: z.object({ projectId: z.string(), collectionStatus: CollectionSchema, watchStatus: WatchSchema,
    lastSuccessAt: z.string().nullable(), lastErrorCode: z.string().nullable(), lastErrorMessage: z.string().nullable(),
    lastReconcileAt: z.string().nullable(), lastObservedAt: z.string().nullable(), lastSnapshotId: z.string().nullable() }),
  reports: z.array(z.object({ id: z.string(), projectId: z.string(), format: z.literal('junit-xml'), relativePath: z.string(), enabled: z.boolean() })),
}).refine(value => value.health.projectId === value.project.id && (!value.snapshot || value.snapshot.projectId === value.project.id)
  && value.reports.every(report => report.projectId === value.project.id), '项目观察来源不匹配');

export async function fetchObserverProjects(signal?: AbortSignal): Promise<ObserverProjectSummary[]> {
  const data = z.object({ projects: z.array(ProjectSummarySchema) }).parse(await apiFetch<unknown>('/api/v1/observer/projects', { signal }));
  return data.projects;
}

export async function registerObserverProject(body: {
  localPath: string;
  name?: string;
  reports?: Array<{ format: 'junit-xml'; relativePath: string }>;
}): Promise<Omit<ObserverDetail, 'reports'>> {
  return ObserverDetailSchema.innerType().omit({ reports: true }).parse(await apiFetch<unknown>('/api/v1/observer/projects', {
    method: 'POST',
    json: { ...body, confirm: true },
  }));
}

export async function fetchObserverDetail(id: string, signal?: AbortSignal): Promise<ObserverDetail> {
  const detail = ObserverDetailSchema.parse(await apiFetch<unknown>(`/api/v1/observer/projects/${encodeURIComponent(id)}`, { signal }));
  if (detail.project.id !== id) throw new Error('返回的观察项目与当前选择不匹配');
  return detail;
}

export async function fetchObserverEvents(
  id: string,
  query: { types?: string; cursor?: string } = {},
  signal?: AbortSignal,
): Promise<{ events: ObserverEvent[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (query.types) params.set('types', query.types);
  if (query.cursor) params.set('cursor', query.cursor);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return apiFetch(`/api/v1/observer/projects/${encodeURIComponent(id)}/events${suffix}`, { signal });
}

export async function fetchAllObserverEvents(
  query: { projectId?: string; types?: string; cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<{ events: ObserverEvent[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (query.projectId) params.set('projectId', query.projectId);
  if (query.types) params.set('types', query.types);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return apiFetch(`/api/v1/observer/events${suffix}`, { signal });
}

export async function scanObserverProject(id: string): Promise<{ snapshot: ObserverSnapshot | null; health: ObserverHealth }> {
  return apiFetch(`/api/v1/observer/projects/${encodeURIComponent(id)}/scan`, { method: 'POST', json: {} });
}

export async function setObserverEnabled(id: string, enabled: boolean): Promise<void> {
  await apiFetch(`/api/v1/observer/projects/${encodeURIComponent(id)}/enabled`, {
    method: 'POST',
    json: { enabled },
  });
}

export async function addObserverReport(id: string, relativePath: string): Promise<void> {
  await apiFetch(`/api/v1/observer/projects/${encodeURIComponent(id)}/reports`, {
    method: 'POST',
    json: { format: 'junit-xml', relativePath },
  });
}

export const EVENT_TYPE_LABELS: Record<ObserverEventType, string> = {
  PROJECT_REGISTERED: '已注册',
  REPOSITORY_HEAD_CHANGED: 'HEAD 变化',
  REPOSITORY_BRANCH_CHANGED: '分支变化',
  WORKTREE_STATE_CHANGED: '工作区变化',
  TEST_REPORT_UPDATED: '测试报告更新',
  REPOSITORY_UNAVAILABLE: '仓库不可用',
  REPOSITORY_RECOVERED: '仓库已恢复',
  OBSERVATION_GAP: '观测空窗',
  ADAPTER_ERROR: '适配器错误',
};

export const COLLECTION_LABELS: Record<CollectionStatus, string> = {
  OK: '采集正常',
  DEGRADED: '采集降级',
  UNAVAILABLE: '不可用',
};

export function collectionTone(status: CollectionStatus): 'success' | 'warning' | 'danger' {
  if (status === 'OK') return 'success';
  if (status === 'DEGRADED') return 'warning';
  return 'danger';
}

export function worktreeLabel(worktree: WorktreeSummary | null, unborn: boolean): string {
  if (worktree === null) return '未知';
  if (worktree.conflicted) return '冲突';
  if (!worktree.clean) return '有未提交';
  if (unborn) return '尚未提交';
  return '干净';
}

export function testLabel(test: TestSummary | null): { text: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' } {
  if (test === null || test.result === 'UNKNOWN' || test.evidenceQuality === 'UNKNOWN') {
    return { text: 'UNKNOWN', tone: 'neutral' };
  }
  const stale = test.stale || test.evidenceQuality === 'STALE' ? ' · STALE' : '';
  const unbound = test.headBound ? '' : ' · 未绑定 HEAD';
  if (test.result === 'PASS') {
    return { text: `最近一次报告 PASS${unbound}${stale}`, tone: test.stale ? 'warning' : 'info' };
  }
  if (test.result === 'FAIL') return { text: `FAIL${stale}`, tone: 'danger' };
  return { text: `MIXED${stale}`, tone: 'warning' };
}
