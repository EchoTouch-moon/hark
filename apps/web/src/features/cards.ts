/**
 * 卡片域数据 hooks（M1-T05：Home 卡片与 Evidence Drawer）。
 *
 * 覆盖端点（docs/04-CONTRACTS.md）：
 * - GET  /api/v1/cards            → { cards }
 * - GET  /api/v1/cards/:id        → { card, events, run }
 * - GET  /api/v1/runs/:id         → { run, steps, evidence, card }
 * - GET  /api/v1/projects         → { projects }
 * - POST /api/v1/cards/:id/dismiss | snooze | execute
 * - POST /api/v1/discover         → DiscoverResult（429 表示限频）
 * - POST /api/v1/demo/seed        → { ok, projects, eventsIngested }
 *
 * 约定：写操作经 apiFetch 自动携带 CSRF；所有 action 以
 * `{ ok: true, data } | { ok: false, error: ApiError }` 返回，不向调用方抛错。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, ApiError } from './api/client';
import type {
  ActionCard,
  CardStatus,
  Event,
  ProjectSummary,
  RunEvidence,
  RunStep,
  TaskRun,
} from './api/types';

/* ------------------------------------------------------------------ */
/* 响应形状                                                            */
/* ------------------------------------------------------------------ */

/** GET /api/v1/cards/:id */
export interface CardDetail {
  card: ActionCard;
  events: Event[];
  run: TaskRun | null;
}

/** GET /api/v1/runs/:id（card 在 run 被清理时可能为 null） */
export interface RunDetailPayload {
  run: TaskRun;
  steps: RunStep[];
  evidence: RunEvidence[];
  card: ActionCard | null;
}

/** POST /api/v1/discover */
export interface DiscoverResult {
  scannedEvents: number;
  noiseSkipped: number;
  candidatesCreated: number;
  duplicatesSuppressed: number;
  cardsCreated: number;
  dismissedRespected: number;
}

/** POST /api/v1/demo/seed */
export interface DemoSeedResult {
  ok: boolean;
  projects: number;
  eventsIngested: number;
}

/** POST /api/v1/cards/:id/execute */
export interface ExecuteOutcome {
  run: TaskRun;
  card: ActionCard;
  alreadyRunning: boolean;
}

/** POST /api/v1/cards/:id/dismiss | snooze */
export interface CardMutationOutcome {
  ok: boolean;
  card: ActionCard;
}

export type DismissFeedback = 'not_useful' | 'irrelevant';

/** action 结果联合：错误不抛出，交由调用方决定 UI 呈现 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/* ------------------------------------------------------------------ */
/* 状态与展示辅助                                                      */
/* ------------------------------------------------------------------ */

/** 「稍后」默认时长：2 小时 */
export const SNOOZE_2H_MS = 2 * 60 * 60 * 1000;

/** 需要轮询 run 进度的卡片状态（每 900ms GET /cards/:id） */
export const POLLING_CARD_STATUSES: ReadonlySet<CardStatus> = new Set([
  'awaiting_approval',
  'executing',
  'verifying',
]);

/** 可能存在关联 run 的终态卡片（刷新后需要回填 run.id 用于跳转） */
export const RUNGED_TERMINAL_STATUSES: ReadonlySet<CardStatus> = new Set([
  'completed',
  'failed',
  'blocked',
  'cancelled',
]);

/** 轮询间隔（docs 要求 900ms） */
export const CARD_POLL_INTERVAL_MS = 900;

export const RUN_STATE_LABEL: Readonly<Record<TaskRun['state'], string>> = {
  queued: '排队中',
  awaiting_approval: '等待批准',
  executing: '执行中',
  verifying: '验证中',
  pending_verification: '待确认',
  completed: '已完成',
  failed: '已失败',
  blocked: '已阻塞',
  cancelled: '已取消',
};

export const FAILURE_CLASS_LABEL: Readonly<Record<string, string>> = {
  timeout: '执行超时',
  policy: '被策略拦截',
  dependency: '依赖不可用',
  executor: '执行器错误',
  verification: '验证失败',
  unknown: '未知原因',
};

/** ISO 时间去掉毫秒（服务端 snooze 校验只接受秒精度） */
export function toSecondPrecisionIso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 卡片是否属于「主动建议」：proposed / snoozed 到期 / 审批与执行进行中 */
export function isProactiveCard(card: ActionCard, nowMs: number): boolean {
  switch (card.status) {
    case 'proposed':
    case 'ready':
    case 'awaiting_approval':
    case 'executing':
    case 'verifying':
      return true;
    case 'snoozed':
      // 缺少 snoozedUntil 的异常数据保守视为到期，让用户可见
      return card.snoozedUntil ? Date.parse(card.snoozedUntil) <= nowMs : true;
    default:
      return false;
  }
}

/** 相对时间：过去 → 「N 分钟前」，未来 → 「N 分钟后」 */
export function formatRelativeTime(iso: string, nowMs: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const abs = Math.abs(nowMs - t);
  const suffix = nowMs >= t ? '前' : '后';
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  let body: string;
  if (abs < 30_000) return nowMs >= t ? '刚刚' : '马上';
  if (abs < HOUR) body = `${Math.max(1, Math.round(abs / MIN))} 分钟`;
  else if (abs < DAY) body = `${Math.round(abs / HOUR)} 小时`;
  else body = `${Math.round(abs / DAY)} 天`;
  return `${body}${suffix}`;
}

export interface TtlInfo {
  label: string;
  urgency: 'expired' | 'urgent' | 'normal';
}

/** TTL（expiresAt 剩余时间）展示 */
export function formatTtl(expiresAt: string, nowMs: number = Date.now()): TtlInfo {
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return { label: '有效期未知', urgency: 'normal' };
  const remain = t - nowMs;
  if (remain <= 0) return { label: '已过期', urgency: 'expired' };
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  let label: string;
  if (remain < HOUR) label = `剩余 ${Math.max(1, Math.round(remain / MIN))} 分钟`;
  else if (remain < DAY) label = `剩余 ${Math.round(remain / HOUR)} 小时`;
  else label = `剩余 ${Math.round(remain / DAY)} 天`;
  return { label, urgency: remain < 30 * MIN ? 'urgent' : 'normal' };
}

/** 把后端错误翻译为面向用户的中文说明（不掩盖未知错误原文） */
export function friendlyCardError(error: ApiError): string {
  switch (error.code) {
    case 'CARD_EXPIRED':
      return '卡片已过期，无法执行；请重新扫描';
    case 'RATE_LIMITED':
      return '操作太频繁，请稍后再试';
    case 'CARD_NOT_FOUND':
      return '卡片已不存在，请刷新';
    default:
      return error.message;
  }
}

export function asApiError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause;
  return new ApiError(0, 'unknown', cause instanceof Error ? cause.message : '未知错误');
}

/* ------------------------------------------------------------------ */
/* 基础 fetch（供轮询 / 非 hook 场景复用）                              */
/* ------------------------------------------------------------------ */

export function fetchCardDetail(cardId: string): Promise<CardDetail> {
  return apiFetch<CardDetail>(`/api/v1/cards/${encodeURIComponent(cardId)}`);
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

export interface UseCardsResult {
  cards: ActionCard[];
  /** 首屏加载中 */
  loading: boolean;
  error: ApiError | null;
  /** 重新拉取列表（后台刷新，不清空已有数据） */
  refetch: () => void;
  /** 把服务端返回的单张卡片合并进列表（execute / 轮询 / dismiss 后使用） */
  mergeCard: (card: ActionCard) => void;
}

/** GET /api/v1/cards —— Home 列表数据源 */
export function useCards(): UseCardsResult {
  const [cards, setCards] = useState<ActionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [seq, setSeq] = useState(0);
  const firstLoadRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    if (firstLoadRef.current) setLoading(true);
    apiFetch<{ cards: ActionCard[] }>('/api/v1/cards')
      .then((data) => {
        if (cancelled) return;
        setCards(data.cards);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(asApiError(cause));
      })
      .finally(() => {
        if (cancelled) return;
        firstLoadRef.current = false;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seq]);

  const refetch = useCallback(() => setSeq((s) => s + 1), []);

  const mergeCard = useCallback((card: ActionCard) => {
    setCards((prev) => {
      const idx = prev.findIndex((c) => c.id === card.id);
      if (idx === -1) return [card, ...prev];
      const next = prev.slice();
      next[idx] = card;
      return next;
    });
  }, []);

  return { cards, loading, error, refetch, mergeCard };
}

export interface UseCardDetailResult {
  detail: CardDetail | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => void;
}

/** GET /api/v1/cards/:id —— Evidence 面板与单卡刷新 */
export function useCardDetail(cardId: string | null): UseCardDetailResult {
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [loading, setLoading] = useState(cardId !== null);
  const [error, setError] = useState<ApiError | null>(null);
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    if (cardId === null) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    fetchCardDetail(cardId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(asApiError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, seq]);

  const refetch = useCallback(() => setSeq((s) => s + 1), []);
  return { detail, loading, error, refetch };
}

export interface UseRunDetailResult {
  payload: RunDetailPayload | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => void;
}

/** GET /api/v1/runs/:id —— run 状态 / 步骤 / evidence sha256 */
export function useRunDetail(runId: string | null): UseRunDetailResult {
  const [payload, setPayload] = useState<RunDetailPayload | null>(null);
  const [loading, setLoading] = useState(runId !== null);
  const [error, setError] = useState<ApiError | null>(null);
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    if (runId === null) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch<RunDetailPayload>(`/api/v1/runs/${encodeURIComponent(runId)}`)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(asApiError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, seq]);

  const refetch = useCallback(() => setSeq((s) => s + 1), []);
  return { payload, loading, error, refetch };
}

export interface UseProjectsResult {
  projects: ProjectSummary[];
  loading: boolean;
  error: ApiError | null;
}

/** GET /api/v1/projects —— 卡片项目 badge 名称映射 */
export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ projects: ProjectSummary[] }>('/api/v1/projects')
      .then((data) => {
        if (cancelled) return;
        setProjects(data.projects);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(asApiError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { projects, loading, error };
}

export interface UseCardActionsResult {
  dismiss: (
    cardId: string,
    feedback?: DismissFeedback,
  ) => Promise<ActionResult<CardMutationOutcome>>;
  snooze: (cardId: string, until: string) => Promise<ActionResult<CardMutationOutcome>>;
  execute: (cardId: string) => Promise<ActionResult<ExecuteOutcome>>;
  discover: () => Promise<ActionResult<DiscoverResult>>;
  seedDemo: () => Promise<ActionResult<DemoSeedResult>>;
}

/** 卡片操作集合：全部返回 ActionResult，不抛出 */
export function useCardActions(): UseCardActionsResult {
  const dismiss = useCallback(
    async (
      cardId: string,
      feedback: DismissFeedback = 'not_useful',
    ): Promise<ActionResult<CardMutationOutcome>> => {
      try {
        const data = await apiFetch<CardMutationOutcome>(
          `/api/v1/cards/${encodeURIComponent(cardId)}/dismiss`,
          { method: 'POST', json: { feedback } },
        );
        return { ok: true, data };
      } catch (cause) {
        return { ok: false, error: asApiError(cause) };
      }
    },
    [],
  );

  const snooze = useCallback(
    async (cardId: string, until: string): Promise<ActionResult<CardMutationOutcome>> => {
      try {
        const data = await apiFetch<CardMutationOutcome>(
          `/api/v1/cards/${encodeURIComponent(cardId)}/snooze`,
          { method: 'POST', json: { until } },
        );
        return { ok: true, data };
      } catch (cause) {
        return { ok: false, error: asApiError(cause) };
      }
    },
    [],
  );

  const execute = useCallback(
    async (cardId: string): Promise<ActionResult<ExecuteOutcome>> => {
      try {
        const data = await apiFetch<ExecuteOutcome>(
          `/api/v1/cards/${encodeURIComponent(cardId)}/execute`,
          { method: 'POST', json: {} },
        );
        return { ok: true, data };
      } catch (cause) {
        return { ok: false, error: asApiError(cause) };
      }
    },
    [],
  );

  const discover = useCallback(async (): Promise<ActionResult<DiscoverResult>> => {
    try {
      const data = await apiFetch<DiscoverResult>('/api/v1/discover', {
        method: 'POST',
        json: {},
      });
      return { ok: true, data };
    } catch (cause) {
      return { ok: false, error: asApiError(cause) };
    }
  }, []);

  const seedDemo = useCallback(async (): Promise<ActionResult<DemoSeedResult>> => {
    try {
      const data = await apiFetch<DemoSeedResult>('/api/v1/demo/seed', {
        method: 'POST',
        json: {},
      });
      return { ok: true, data };
    } catch (cause) {
      return { ok: false, error: asApiError(cause) };
    }
  }, []);

  return useMemo(
    () => ({ dismiss, snooze, execute, discover, seedDemo }),
    [dismiss, snooze, execute, discover, seedDemo],
  );
}
