import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../apps/web/src/features/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../apps/web/src/features/api/client')>();
  return { ...original, apiFetch: mocks.apiFetch };
});

import { ApiError } from '../../apps/web/src/features/api/client';
import { createThread, getGlobalThread, listThreads, touchLocalThread } from '../../apps/web/src/features/threads';
import { fetchProactive } from '../../apps/web/src/features/chat';

const THREADS_KEY = 'hearth.threads.v2';
let data: Map<string, string>;

beforeEach(() => {
  data = new Map();
  mocks.apiFetch.mockReset();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    },
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('global thread fallback and project chat denial', () => {
  it('does not select old project or unclassified local threads when the server has no global threads', async () => {
    const previous = [
      { id: 'old-project', title: 'Project', projectId: 'project-a', preview: 'SYNTHETIC PROJECT' },
      { id: 'old-unknown', title: 'Unknown', preview: 'SYNTHETIC UNKNOWN' },
    ];
    data.set(THREADS_KEY, JSON.stringify(previous));
    mocks.apiFetch.mockResolvedValueOnce({ threads: [] });
    const list = await listThreads();
    expect(list.threads).toHaveLength(1);
    expect(list.threads[0]).toMatchObject({ projectId: null });
    expect(list.mock).toBe(false);
    expect(JSON.stringify(list.threads)).not.toContain('SYNTHETIC');
    expect(JSON.parse(data.get(THREADS_KEY)!)).toEqual(previous);
  });

  it('returns server global threads without exposing project threads from an older server', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ threads: [
      { id: 'global', title: 'Global', projectId: null, updatedAt: '2026-11-02' },
      { id: 'project', title: 'Project', projectId: 'project-a', preview: 'SYNTHETIC', updatedAt: '2026-11-02' },
    ] });
    expect(await listThreads()).toEqual({ threads: [{ id: 'global', title: 'Global', projectId: null, updatedAt: '2026-11-02' }], mock: false });
  });

  it('never reuses a cached global-looking ID when the server returns an empty list', async () => {
    const previous = [{ id: 'colliding-project-id', title: 'Cached', projectId: null, preview: 'SYNTHETIC' }];
    data.set(THREADS_KEY, JSON.stringify(previous));
    mocks.apiFetch.mockResolvedValueOnce({ threads: [] });
    const list = await listThreads();
    expect(list.threads[0]?.id).not.toBe('colliding-project-id');
    expect(JSON.stringify(list.threads)).not.toContain('SYNTHETIC');
    expect(JSON.parse(data.get(THREADS_KEY)!)).toEqual(previous);
  });

  it('offers a clearly marked offline global thread without deleting old project records', async () => {
    const previous = [{ id: 'old-project', title: 'Project', projectId: 'project-a' }];
    data.set(THREADS_KEY, JSON.stringify(previous));
    mocks.apiFetch.mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'));
    const list = await listThreads();
    expect(list.mock).toBe(true);
    expect(list.threads[0]?.projectId).toBeNull();
    expect(JSON.parse(data.get(THREADS_KEY)!)).toEqual([...previous, list.threads[0]]);
  });

  it('preserves every old record when creating an offline global thread and does not display hidden records', async () => {
    const previous = [
      { id: 'project-old', title: 'Project', projectId: 'project-a', preview: 'SYNTHETIC PROJECT' },
      { id: 'unknown-old', title: 'Unknown', preview: 'SYNTHETIC UNKNOWN' },
      { legacyShape: { arbitrary: true } }, null, 42,
    ];
    data.set(THREADS_KEY, JSON.stringify(previous));
    mocks.apiFetch.mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'));
    const created = await createThread({ title: 'New global' });
    expect(created.mock).toBe(true);
    const stored = JSON.parse(data.get(THREADS_KEY)!) as unknown[];
    expect(stored[0]).toEqual(created.thread);
    expect(stored.slice(1, 1 + previous.length)).toEqual(previous);
    mocks.apiFetch.mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'));
    const visible = await listThreads();
    expect(visible.threads.some(thread => thread.id === created.thread.id)).toBe(true);
    expect(JSON.stringify(visible.threads)).not.toContain('SYNTHETIC');
    expect(JSON.parse(data.get(THREADS_KEY)!)).toEqual(stored);
  });

  it.each(['{bad json', '', '{}', 'null'])('preserves unparseable or non-array local storage %j', async (raw) => {
    data.set(THREADS_KEY, raw);
    mocks.apiFetch.mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'));
    const listed = await listThreads();
    expect(listed.threads[0]?.projectId).toBeNull();
    expect(data.get(THREADS_KEY)).toBe(raw);
    mocks.apiFetch.mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'));
    await expect(createThread({ title: 'Global' })).rejects.toMatchObject({ code: 'LOCAL_THREAD_DATA_UNAVAILABLE' });
    touchLocalThread('anything', 'new preview');
    expect(data.get(THREADS_KEY)).toBe(raw);
  });

  it('updates a global local preview without dropping unknown or project records', () => {
    const previous = [
      { id: 'global', title: 'Global', projectId: null, preview: 'before' },
      { id: 'project', title: 'Project', projectId: 'project-a', preview: 'retain' },
      { unknownShape: true }, null, 42,
    ];
    data.set(THREADS_KEY, JSON.stringify(previous));
    touchLocalThread('global', 'after');
    const stored = JSON.parse(data.get(THREADS_KEY)!) as unknown[];
    expect(stored[0]).toMatchObject({ id: 'global', preview: 'after' });
    expect(stored.slice(1)).toEqual(previous.slice(1));
  });

  it('reports offline thread creation failure when local storage refuses the write', async () => {
    const previous = JSON.stringify([{ id: 'old-project', title: 'Project', projectId: 'project-a' }]);
    data.set(THREADS_KEY, previous);
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: () => { throw new Error('quota exceeded'); },
      removeItem: (key: string) => data.delete(key),
    } });
    mocks.apiFetch.mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'));
    await expect(createThread({ title: 'Global' })).rejects.toMatchObject({ code: 'LOCAL_THREAD_WRITE_FAILED' });
    expect(data.get(THREADS_KEY)).toBe(previous);
  });

  it.each(['PROJECT_CHAT_UNAVAILABLE', 'UNBOUND_THREAD_HISTORY'])('does not hide %s while loading threads', async (code) => {
    const error = new ApiError(403, code, '聊天暂不可用');
    mocks.apiFetch.mockRejectedValueOnce(error);
    await expect(listThreads()).rejects.toBe(error);
    expect(data.has(THREADS_KEY)).toBe(false);
  });

  it.each([400, 401, 403, 409, 422, 500])('propagates HTTP %s from thread listing', async (status) => {
    const error = new ApiError(status, 'REQUEST_FAILED', '无法读取线程');
    mocks.apiFetch.mockRejectedValueOnce(error);
    await expect(listThreads()).rejects.toBe(error);
    expect(data.has(THREADS_KEY)).toBe(false);
  });

  it('rejects a malformed successful list without reading local Mock data', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ threads: null });
    await expect(listThreads()).rejects.toMatchObject({ code: 'invalid_response' });
    expect(data.has(THREADS_KEY)).toBe(false);
  });

  it('does not create a mock thread for a project request, even while offline', async () => {
    await expect(createThread({ projectId: 'project-a' })).rejects.toMatchObject({ code: 'PROJECT_CHAT_UNAVAILABLE', status: 403 });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(data.has(THREADS_KEY)).toBe(false);
  });

  it.each(['PROJECT_CHAT_UNAVAILABLE', 'UNBOUND_THREAD_HISTORY'])('preserves the %s error from thread creation', async (code) => {
    const error = new ApiError(403, code, '聊天暂不可用');
    mocks.apiFetch.mockRejectedValueOnce(error);
    await expect(createThread({ title: 'Global' })).rejects.toBe(error);
    expect(data.has(THREADS_KEY)).toBe(false);
  });

  it.each([400, 401, 403, 409, 422, 500])('propagates HTTP %s from thread creation', async (status) => {
    const error = new ApiError(status, 'REQUEST_FAILED', '无法创建线程');
    mocks.apiFetch.mockRejectedValueOnce(error);
    await expect(createThread({ title: 'Global' })).rejects.toBe(error);
    expect(data.has(THREADS_KEY)).toBe(false);
  });

  it('rejects a malformed successful creation without saving a mock thread', async () => {
    mocks.apiFetch.mockResolvedValueOnce({});
    await expect(createThread({ title: 'Global' })).rejects.toMatchObject({ code: 'invalid_response' });
    expect(data.has(THREADS_KEY)).toBe(false);
  });

  it('keeps a server-created global thread usable', async () => {
    const thread = { id: 'global', title: 'Global', projectId: null, updatedAt: '2026-11-02' };
    mocks.apiFetch.mockResolvedValueOnce({ thread });
    expect(await createThread({ title: 'Global' })).toEqual({ thread, mock: false });
  });

  it('resolves an off-page global thread only via the real detail API', async () => {
    const thread = { id: 'old-global', title: 'Global', projectId: null, updatedAt: '2026-11-02' };
    mocks.apiFetch.mockResolvedValueOnce({ thread });
    expect(await getGlobalThread('old-global')).toEqual(thread);
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/threads/old-global', { signal: undefined });
  });

  it('rejects an off-page thread that the server identifies as project-bound', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ thread: { id: 'old-project', title: 'Project', projectId: 'project-a' } });
    await expect(getGlobalThread('old-project')).rejects.toMatchObject({ code: 'PROJECT_CHAT_UNAVAILABLE' });
  });

  it.each(['PROJECT_CHAT_UNAVAILABLE', 'UNBOUND_THREAD_HISTORY'])('does not generate a mock proactive suggestion for %s', async (code) => {
    const error = new ApiError(403, code, '聊天暂不可用');
    mocks.apiFetch.mockRejectedValueOnce(error);
    await expect(fetchProactive('old-thread', { hasMessages: false })).rejects.toBe(error);
    expect(data.size).toBe(0);
  });

  it.each([400, 401, 403, 409, 422, 500])('propagates HTTP %s without generating a proactive Mock', async (status) => {
    const error = new ApiError(status, 'REQUEST_FAILED', '无法读取建议');
    mocks.apiFetch.mockRejectedValueOnce(error);
    await expect(fetchProactive('old-thread', { hasMessages: false })).rejects.toBe(error);
    expect(data.size).toBe(0);
  });
});
