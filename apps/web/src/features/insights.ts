import { apiFetch } from './api/client';

export type InsightStatus = 'OPEN' | 'ACKNOWLEDGED' | 'DISMISSED' | 'RESOLVED' | 'WITHDRAWN';
export type InsightSeverity = 'info' | 'attention' | 'important';
export type EngineHealth = 'NOT_EVALUATED' | 'OK' | 'DEGRADED';

export interface InsightListItem {
  id: string;
  projectId: string;
  streamEpoch: number;
  episodeKey: string;
  status: InsightStatus;
  severity: InsightSeverity;
  confidence: 'low' | 'medium' | 'high';
  primaryRuleId: string;
  primaryRuleVersion: string;
  title: string;
  summary: string;
  observedAt: string;
  headBinding: string;
  evidenceCount: number;
  evidenceAvailability: 'AVAILABLE' | 'MISSING' | 'UNAVAILABLE';
  historical: boolean;
  feedback: 'useful' | 'not_useful' | null;
}

export interface InsightDetail extends InsightListItem {
  issueFamily: string;
  reasonCodes: string[];
  templateData: Record<string, string | number | boolean | null>;
  firstObservedAt: string;
  observeHref: string;
  evidence: Array<{ role: string; sourceKind: string; sourceId: string; quality: string }>;
  engineFrozen: boolean;
}

export interface InsightSummary {
  engineHealth: EngineHealth;
  openCount: number;
  projects: Array<{ projectId: string; openCount: number }>;
}

export const STATUS_LABEL: Record<InsightStatus, string> = {
  OPEN: '待处理',
  ACKNOWLEDGED: '已查看',
  DISMISSED: '不再关注',
  RESOLVED: '已恢复',
  WITHDRAWN: '已撤回',
};

export const STATUS_TONE: Record<InsightStatus, 'warning' | 'info' | 'neutral'> = {
  OPEN: 'warning',
  ACKNOWLEDGED: 'info',
  DISMISSED: 'neutral',
  RESOLVED: 'info',
  WITHDRAWN: 'neutral',
};

export const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  important: '重要',
  attention: '值得注意',
  info: '提示',
};

export const SEVERITY_TONE: Record<InsightSeverity, 'danger' | 'warning' | 'info'> = {
  important: 'danger',
  attention: 'warning',
  info: 'info',
};

export async function fetchInsights(
  query: { projectId?: string; status?: string; severity?: InsightSeverity; cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<{ items: InsightListItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (query.projectId) params.set('projectId', query.projectId);
  if (query.status) params.set('status', query.status);
  if (query.severity) params.set('severity', query.severity);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return apiFetch(`/api/v1/insights${suffix}`, { signal });
}

export async function fetchInsight(id: string, signal?: AbortSignal): Promise<InsightDetail> {
  const body = await apiFetch<{ insight: InsightDetail }>(`/api/v1/insights/${encodeURIComponent(id)}`, { signal });
  return body.insight;
}

export async function fetchInsightSummary(signal?: AbortSignal): Promise<InsightSummary> {
  return apiFetch('/api/v1/insights/summary', { signal });
}

export async function acknowledgeInsight(id: string): Promise<{ status: string }> {
  return apiFetch(`/api/v1/insights/${encodeURIComponent(id)}/acknowledge`, { method: 'POST', json: {} });
}

export async function dismissInsight(id: string): Promise<{ status: string }> {
  return apiFetch(`/api/v1/insights/${encodeURIComponent(id)}/dismiss`, { method: 'POST', json: {} });
}

export async function sendInsightFeedback(id: string, kind: 'useful' | 'not_useful'): Promise<{ kind: string }> {
  return apiFetch(`/api/v1/insights/${encodeURIComponent(id)}/feedback`, { method: 'POST', json: { kind } });
}
