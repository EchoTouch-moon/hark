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

/** 列出线程。服务端返回空列表或异常时失败关闭，不回退虚假 Mock 线程。 */
export async function listThreads(signal?: AbortSignal): Promise<ThreadListDto> {
  try {
    const data = await apiFetch<{ threads: ThreadSummary[] }>('/api/v1/threads', { signal });
    if (Array.isArray(data.threads)) {
      return { threads: data.threads, mock: false };
    }
  } catch {
    // Fail closed on error: do not fabricate fake mock threads
  }
  return { threads: [], mock: false };
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
    throw new ApiError(500, 'THREAD_CREATE_FAILED', '服务端未返回新建线程');
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, 'THREAD_CREATE_FAILED', err instanceof Error ? err.message : '创建线程失败');
  }
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
