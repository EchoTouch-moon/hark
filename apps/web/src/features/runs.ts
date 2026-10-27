/**
 * Runs 数据层（M1-T08，docs/02-U04）。
 *
 * 说明：GET /api/v1/runs/:id 的响应包含 `card`（ActionCard | null），
 * 这是服务端路由的真实形状；`features/api/types.ts` 中的 RunDetail
 * 缺少该字段，故在本文件补充完整的响应类型。
 */
import { apiFetch } from './api/client';
import { isTerminalRunState } from '@hearth/contracts';
import type {
  ActionCard,
  FailureClass,
  RunState,
  RunStep,
  TaskRun,
  VerificationVerdict,
} from '@hearth/contracts';
import type { RunEvidence } from './api/types';

export type { RunEvidence };

/** GET /api/v1/runs/:id 响应 */
export interface RunDetailPayload {
  run: TaskRun;
  steps: RunStep[];
  evidence: RunEvidence[];
  card: ActionCard | null;
}

export type ApprovalDecision = 'approve' | 'deny';

/** GET /api/v1/runs?projectId= → { runs } */
export async function fetchRuns(
  projectId?: string,
  signal?: AbortSignal,
): Promise<TaskRun[]> {
  const query = projectId === undefined ? '' : `?projectId=${encodeURIComponent(projectId)}`;
  const data = await apiFetch<{ runs: TaskRun[] }>(`/api/v1/runs${query}`, { signal });
  return data.runs;
}

/** GET /api/v1/runs/:id（未知 id 返回 404 → ApiError.status === 404） */
export async function fetchRunDetail(
  runId: string,
  signal?: AbortSignal,
): Promise<RunDetailPayload> {
  return apiFetch<RunDetailPayload>(`/api/v1/runs/${encodeURIComponent(runId)}`, { signal });
}

/** POST /api/v1/runs/:id/cancel（终态 run 原样返回，不报错） */
export async function cancelRun(runId: string, signal?: AbortSignal): Promise<TaskRun> {
  const data = await apiFetch<{ run: TaskRun }>(
    `/api/v1/runs/${encodeURIComponent(runId)}/cancel`,
    { method: 'POST', json: {}, signal },
  );
  return data.run;
}

/**
 * POST /api/v1/approvals/:runId body { decision }。
 * 仅 awaiting_approval 的 run 可审批；状态已变化时服务端返回 409。
 */
export async function decideApproval(
  runId: string,
  decision: ApprovalDecision,
  signal?: AbortSignal,
): Promise<TaskRun> {
  const data = await apiFetch<{ run: TaskRun }>(
    `/api/v1/approvals/${encodeURIComponent(runId)}`,
    { method: 'POST', json: { decision }, signal },
  );
  return data.run;
}

/* ------------------------------------------------------------------ */
/* 展示辅助：状态/结论/失败类别的中文标签与色调、时间格式化 */
/* ------------------------------------------------------------------ */

export const RUN_STATE_LABELS: Record<RunState, string> = {
  queued: '排队中',
  awaiting_approval: '待审批',
  executing: '执行中',
  verifying: '验证中',
  pending_verification: '待人工验证',
  completed: '已完成',
  failed: '已失败',
  blocked: '已阻塞',
  cancelled: '已取消',
};

export const VERDICT_LABELS: Record<VerificationVerdict, string> = {
  pass: '验证通过',
  fail: '验证未通过',
  unknown: '尚未确认',
};

export const FAILURE_CLASS_LABELS: Record<FailureClass, string> = {
  timeout: '超时',
  policy: '策略拦截',
  dependency: '依赖失败',
  executor: '执行器错误',
  verification: '验证失败',
  unknown: '未知原因',
};

export { isTerminalRunState };

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function runStateTone(state: RunState): BadgeTone {
  if (isTerminalRunState(state)) {
    if (state === 'completed') return 'success';
    if (state === 'cancelled') return 'neutral';
    return 'danger'; // failed / blocked
  }
  if (state === 'awaiting_approval' || state === 'pending_verification') return 'warning';
  if (state === 'queued') return 'neutral';
  return 'info'; // executing / verifying
}

export function verdictTone(verdict: VerificationVerdict): BadgeTone {
  switch (verdict) {
    case 'pass':
      return 'success';
    case 'fail':
      return 'danger';
    default:
      return 'warning'; // unknown：amber「尚未确认」，不得显示为成功
  }
}

/**
 * 统一时间展示：本地时区、24 小时制（例：2026-10-28 09:58）。
 * 解析失败时原样返回字符串，不抛错。
 */
export function formatDateTime(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
