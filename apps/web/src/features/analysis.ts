import { apiFetch } from './api/client';

export type AnalysisStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'no_recommendation';

export interface AnalysisEvidenceRef {
  kind: string;
  id: string;
  label: string;
  verified: boolean;
}

export interface Recommendation {
  target: string;
  scope: string;
  statusSummary: string;
  findings: Array<{ title: string; detail: string; evidenceRefs: AnalysisEvidenceRef[]; verified: boolean }>;
  confidence: 'low' | 'medium' | 'high';
  uncertainties: string[];
  nextActions: Array<{ title: string; detail: string; requiresConfirmation: boolean }>;
  risks: string[];
}

export type AnalysisFeedback = 'useful' | 'not_useful';

export interface AnalysisRun {
  id: string;
  projectId: string;
  insightId: string | null;
  trigger: 'observe' | 'insight' | 'project';
  provider: string;
  model: string | null;
  status: AnalysisStatus;
  snapshotId: string | null;
  headSha: string | null;
  streamEpoch: number;
  contextFingerprint: string;
  recommendation: Recommendation | null;
  errorCode: string | null;
  errorMessage: string | null;
  usage: { latencyMs: number } | null;
  stale: boolean;
  staleReason: 'head' | 'context' | 'unavailable' | null;
  feedback: AnalysisFeedback | null;
  startedAt: string;
  finishedAt: string | null;
}

export const ANALYSIS_STATUS_LABEL: Record<AnalysisStatus, string> = {
  queued: '排队中',
  running: '分析中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  no_recommendation: '没有可验证建议',
};

export async function fetchAnalysisRuns(projectId: string, signal?: AbortSignal): Promise<AnalysisRun[]> {
  const body = await apiFetch<{ runs: AnalysisRun[] }>(
    `/api/v1/analysis/runs?projectId=${encodeURIComponent(projectId)}`,
    { signal },
  );
  return body.runs;
}

export interface AnalysisInput {
  projectId: string;
  insightId?: string;
  trigger: AnalysisRun['trigger'];
}

export interface AnalysisPreview {
  provider: string;
  model: string | null;
  context: {
    contextFingerprint: string;
    files: Array<{ relativePath: string; bytes: number; excerpt: string; truncated: boolean; sha256: string }>;
    [key: string]: unknown;
  };
  excludedPaths: string[];
}

export function previewAnalysis(input: AnalysisInput): Promise<AnalysisPreview> {
  return apiFetch<AnalysisPreview>('/api/v1/analysis/preview', { method: 'POST', json: input });
}

export async function saveAnalysisPrivacy(projectId: string, excludedPaths: string[]): Promise<void> {
  await apiFetch('/api/v1/analysis/privacy', { method: 'PUT', json: { projectId, excludedPaths } });
}

export async function startAnalysis(input: AnalysisInput & { consentFingerprint?: string }): Promise<AnalysisRun> {
  const body = await apiFetch<{ run: AnalysisRun }>('/api/v1/analysis/runs', { method: 'POST', json: input });
  return body.run;
}

export async function sendAnalysisFeedback(id: string, kind: AnalysisFeedback): Promise<AnalysisFeedback> {
  const body = await apiFetch<{ feedback: AnalysisFeedback }>(`/api/v1/analysis/runs/${encodeURIComponent(id)}/feedback`, { method: 'POST', json: { kind } });
  return body.feedback;
}
