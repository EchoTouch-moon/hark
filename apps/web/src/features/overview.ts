import {
  type OverviewResponse,
  OverviewResponseSchema,
  type OverviewHeadlineStatus,
  type TestStatusIndicator,
} from '@hearth/contracts';
import { apiFetch } from './api/client';

export type {
  OverviewResponse,
  OverviewHeadlineStatus,
  TestStatusIndicator,
  OverviewInsightItem,
  ProjectOverviewItem,
  OverviewObservationItem,
  OverviewHeadlineSummary,
  SectionAvailability,
} from '@hearth/contracts';

export const OVERVIEW_STATUS_LABELS: Record<OverviewHeadlineStatus, string> = {
  NO_PROJECTS: '未登记项目',
  NO_SIGNALS: '无新信号',
  ALL_CLEAR: '全部正常',
  ATTENTION_NEEDED: '待关注',
  DEGRADED: '来源降级',
  PAUSED: '观察已暂停',
};

export const OVERVIEW_STATUS_TONE: Record<
  OverviewHeadlineStatus,
  'neutral' | 'info' | 'success' | 'warning' | 'danger'
> = {
  NO_PROJECTS: 'neutral',
  NO_SIGNALS: 'info',
  ALL_CLEAR: 'success',
  ATTENTION_NEEDED: 'warning',
  DEGRADED: 'danger',
  PAUSED: 'neutral',
};

export const TEST_STATUS_LABELS: Record<TestStatusIndicator, string> = {
  PASSED: '测试通过',
  FAILED: '测试失败',
  UNKNOWN: '无测试/未知',
  STALE: '测试陈旧',
  NOT_CONFIGURED: '未配置报告',
};

export const TEST_STATUS_TONE: Record<
  TestStatusIndicator,
  'success' | 'danger' | 'neutral' | 'warning'
> = {
  PASSED: 'success',
  FAILED: 'danger',
  UNKNOWN: 'neutral',
  STALE: 'warning',
  NOT_CONFIGURED: 'neutral',
};

export async function fetchOverview(
  projectId?: string,
  signal?: AbortSignal,
): Promise<OverviewResponse> {
  const params = new URLSearchParams();
  if (projectId && projectId.trim() !== '') {
    params.set('projectId', projectId.trim());
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const data = await apiFetch<unknown>(`/api/v1/overview${suffix}`, { signal });
  return OverviewResponseSchema.parse(data);
}
