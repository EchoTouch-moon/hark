/**
 * Projects 数据层（M1-T07，docs/02-U03）。
 *
 * 项目隔离由服务端保证：GET /projects/:id 只返回该项目的
 * events/cards/runs，前端不做任何跨项目过滤伪装。
 */
import { apiFetch } from './api/client';
import type { ActionCard, CardStatus, Event, TaskRun } from '@hearth/contracts';
import type { ProjectSummary } from './api/types';

export type { ProjectSummary };

/** GET /api/v1/projects/:id 响应（服务端已按项目隔离） */
export interface ProjectSnapshot {
  project: ProjectSummary;
  events: Event[];
  cards: ActionCard[];
  runs: TaskRun[];
}

/** GET /api/v1/projects → { projects } */
export async function fetchProjects(signal?: AbortSignal): Promise<ProjectSummary[]> {
  const data = await apiFetch<{ projects: ProjectSummary[] }>('/api/v1/projects', { signal });
  return data.projects;
}

/** GET /api/v1/projects/:id（未知 id 返回 404 → ApiError.status === 404） */
export async function fetchProjectSnapshot(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectSnapshot> {
  return apiFetch<ProjectSnapshot>(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
    signal,
  });
}

/* ------------------------------------------------------------------ */
/* 展示辅助：卡片状态中文标签与色调 */
/* ------------------------------------------------------------------ */

export const CARD_STATUS_LABELS: Record<CardStatus, string> = {
  proposed: '已建议',
  dismissed: '已忽略',
  snoozed: '已稍后',
  expired: '已过期',
  ready: '可执行',
  awaiting_approval: '待审批',
  executing: '执行中',
  verifying: '验证中',
  completed: '已完成',
  failed: '已失败',
  blocked: '已阻塞',
};

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function cardStatusTone(status: CardStatus): BadgeTone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'awaiting_approval':
    case 'snoozed':
    case 'verifying':
      return 'warning';
    case 'failed':
    case 'blocked':
    case 'expired':
      return 'danger';
    case 'executing':
    case 'ready':
      return 'info';
    default:
      return 'neutral';
  }
}
