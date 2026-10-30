import { FIXTURE_MODE } from './hearthViewModel';
/**
 * G1 Thread 适配层：优先打真实 API；404/失败时退到 localStorage Mock。
 * 真 API：GET/POST /api/v1/threads（list 非空即视为 live；AppShell 会 preferLiveApi）。
 *   GET  /api/v1/threads/:id
 */

import { apiFetch, ApiError } from './api/client';

export interface ThreadSummary {
  id: string;
  title: string;
  preview?: string;
  projectId?: string | null;
  updatedAt: string;
}

export interface ThreadListDto {
  threads: ThreadSummary[];
  /** true = 前端 Mock，未接 G1 */
  mock: boolean;
}

const STORAGE_KEY = 'hearth.threads.v2';
const ACTIVE_KEY = 'hearth.activeThread.v2';

function nowIso(): string {
  return new Date().toISOString();
}

function readLocal(): ThreadSummary[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is ThreadSummary =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as ThreadSummary).id === 'string' &&
        typeof (t as ThreadSummary).title === 'string',
    );
  } catch {
    return [];
  }
}

function writeLocal(threads: ThreadSummary[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
  } catch {
    // ignore
  }
}

function ensureSeed(): ThreadSummary[] {
  const existing = readLocal();
  if (existing.length > 0) return existing;
  const seed: ThreadSummary = {
    id: 'thread-default',
    title: '日常',
    preview: '有需要时我会出现',
    projectId: null,
    updatedAt: nowIso(),
  };
  writeLocal([seed]);
  return [seed];
}

/** 探测并列出线程；无后端时用本地 Mock。 */
export async function listThreads(signal?: AbortSignal): Promise<ThreadListDto> {
  // Fixture mode: never request GET /api/v1/threads.
  if (FIXTURE_MODE) return { threads: ensureSeed(), mock: true };
  try {
    const data = await apiFetch<{ threads: ThreadSummary[] }>('/api/v1/threads', { signal });
    if (Array.isArray(data.threads) && data.threads.length > 0) {
      return { threads: data.threads, mock: false };
    }
  } catch (err) {
    if (!(err instanceof ApiError) || (err.status !== 404 && err.status !== 0 && err.status !== 501)) {
      // 非「未实现」类错误仍可退 Mock，避免挡壳
    }
  }
  return { threads: ensureSeed(), mock: true };
}

export async function createThread(
  input: { title?: string; projectId?: string | null } = {},
  signal?: AbortSignal,
): Promise<{ thread: ThreadSummary; mock: boolean }> {
  try {
    const data = await apiFetch<{ thread: ThreadSummary }>('/api/v1/threads', {
      method: 'POST',
      json: { title: input.title ?? '新线程', projectId: input.projectId ?? null },
      signal,
    });
    if (data.thread?.id) return { thread: data.thread, mock: false };
  } catch {
    // fall through
  }
  const thread: ThreadSummary = {
    id: `thread-${Date.now()}`,
    title: input.title?.trim() || '新线程',
    preview: '',
    projectId: input.projectId ?? null,
    updatedAt: nowIso(),
  };
  const all = ensureSeed();
  writeLocal([thread, ...all]);
  return { thread, mock: true };
}

export function getActiveThreadId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveThreadId(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore
  }
}

/** 更新本地预览（Mock 路径）；真 API 由服务端维护。 */
export function touchLocalThread(id: string, preview: string): void {
  const all = readLocal();
  const next = all.map((t) =>
    t.id === id ? { ...t, preview: preview.slice(0, 80), updatedAt: nowIso() } : t,
  );
  writeLocal(next);
}
