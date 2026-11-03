/**
 * G1 Thread 适配层：优先打真实 API；不可用时可显示全局离线线程。
 * 项目内聊天暂不可用，明确拒绝不能降级为本地 Mock 成功。
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
let pendingGlobalThread: ThreadSummary | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function newGlobalThread(): ThreadSummary {
  return {
    id: `thread-global-${globalThis.crypto.randomUUID()}`,
    title: '日常',
    preview: '有需要时我会出现',
    projectId: null,
    updatedAt: nowIso(),
  };
}

function readLocalRecords(): unknown[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isThreadSummary(value: unknown): value is ThreadSummary {
  return typeof value === 'object' && value !== null &&
    typeof (value as ThreadSummary).id === 'string' &&
    typeof (value as ThreadSummary).title === 'string';
}

function writeLocal(threads: unknown[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
    return true;
  } catch {
    return false;
  }
}

function ensureSeed(): ThreadSummary[] {
  const existing = readLocalRecords();
  // A missing projectId on a historical local record is not proof that it was
  // global. Keep such records in storage, but do not display or select them.
  const globalThreads = (existing ?? []).filter(isThreadSummary).filter((thread) => thread.projectId === null);
  if (globalThreads.length > 0) return globalThreads;
  const seed = newGlobalThread();
  if (existing !== null) writeLocal([...existing, seed]);
  return [seed];
}

/** 探测并列出线程；无后端时用本地 Mock。 */
export async function listThreads(signal?: AbortSignal): Promise<ThreadListDto> {
  try {
    const data = await apiFetch<{ threads: ThreadSummary[] }>('/api/v1/threads', { signal });
    if (Array.isArray(data.threads)) {
      const globalThreads = data.threads.filter((thread) => thread.projectId === null);
      if (globalThreads.length > 0) {
        pendingGlobalThread = null;
        return { threads: globalThreads, mock: false };
      }
      // A successful empty response is authoritative: a local record marked
      // global could still share an ID with a withheld historical project thread.
      // Keep a fresh unsaved global entry until the first message creates it.
      pendingGlobalThread ??= newGlobalThread();
      return { threads: [pendingGlobalThread], mock: false };
    }
    throw new ApiError(200, 'invalid_response', '线程列表响应无效');
  } catch (err) {
    if (signal?.aborted || !(err instanceof ApiError) || (err.status !== 0 && err.status !== 404 && err.status !== 501)) throw err;
  }
  return { threads: ensureSeed(), mock: true };
}

/** Resolve a thread outside the current page only through the real server. */
export async function getGlobalThread(id: string, signal?: AbortSignal): Promise<ThreadSummary> {
  const data = await apiFetch<{ thread: ThreadSummary }>(`/api/v1/threads/${encodeURIComponent(id)}`, { signal });
  if (!data.thread || data.thread.id !== id || data.thread.projectId !== null) {
    throw new ApiError(403, 'PROJECT_CHAT_UNAVAILABLE', '项目内聊天暂不可用');
  }
  return data.thread;
}

export async function createThread(
  input: { title?: string; projectId?: string | null } = {},
  signal?: AbortSignal,
): Promise<{ thread: ThreadSummary; mock: boolean }> {
  if (input.projectId != null) {
    throw new ApiError(403, 'PROJECT_CHAT_UNAVAILABLE', '项目内聊天暂不可用');
  }
  try {
    const data = await apiFetch<{ thread: ThreadSummary }>('/api/v1/threads', {
      method: 'POST',
      json: { title: input.title ?? '新线程', projectId: input.projectId ?? null },
      signal,
    });
    if (data.thread?.id) {
      if (data.thread.projectId !== null) throw new ApiError(403, 'PROJECT_CHAT_UNAVAILABLE', '项目内聊天暂不可用');
      return { thread: data.thread, mock: false };
    }
    throw new ApiError(200, 'invalid_response', '线程响应无效');
  } catch (err) {
    if (signal?.aborted || !(err instanceof ApiError) || (err.status !== 0 && err.status !== 404 && err.status !== 501)) throw err;
  }
  const thread: ThreadSummary = {
    id: `thread-${Date.now()}`,
    title: input.title?.trim() || '新线程',
    preview: '',
    projectId: input.projectId ?? null,
    updatedAt: nowIso(),
  };
  const all = readLocalRecords();
  if (all === null) throw new ApiError(409, 'LOCAL_THREAD_DATA_UNAVAILABLE', '本地对话数据无法读取，未创建对话');
  if (!writeLocal([thread, ...all])) throw new ApiError(0, 'LOCAL_THREAD_WRITE_FAILED', '无法保存本地对话，未创建对话');
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
  const all = readLocalRecords();
  if (all === null) return;
  const next = all.map((t) =>
    isThreadSummary(t) && t.projectId === null && t.id === id
      ? { ...t, preview: preview.slice(0, 80), updatedAt: nowIso() }
      : t,
  );
  writeLocal(next);
}
