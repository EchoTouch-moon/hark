import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, setCsrfToken } from '../../apps/web/src/features/api/client';
import { putHearthObserve } from '../../apps/web/src/features/hearthViewModel';

const json = (body: unknown, status = 200) => new globalThis.Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const denied = (status: number, code: string) => json({ error: { code, message: code } }, status);
const permissions = { observe: true, research: false, model: false, execute: false };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  const storage = new Map<string, string>();
  fetchMock = vi.fn();
  vi.stubGlobal('window', { fetch: fetchMock, localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
  setCsrfToken(null);
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('CSRF session and retry contract', () => {
  it('obtains a session before the first observe write and sends its token', async () => {
    fetchMock.mockResolvedValueOnce(json({ csrfToken: 'new-token' })).mockResolvedValueOnce(json({ permissions }));
    expect(await putHearthObserve(true)).toEqual({ ok: true, permissions });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/auth/session');
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe('/api/v1/hearth/permissions');
    expect(init.method).toBe('PUT');
    expect(new globalThis.Headers(init.headers).get('x-csrf-token')).toBe('new-token');
    expect(JSON.parse(init.body)).toEqual({ observe: true });
  });

  it.each([[401, 'UNAUTHORIZED'], [403, 'CSRF_DENIED']])('refreshes and retries exactly once for gate %s %s', async (status, code) => {
    setCsrfToken('old');
    fetchMock.mockResolvedValueOnce(denied(status, code)).mockResolvedValueOnce(json({ csrfToken: 'fresh' })).mockResolvedValueOnce(json({ ok: true }));
    await expect(apiFetch('/api/v1/example', { method: 'POST', json: { x: 1 } })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new globalThis.Headers(fetchMock.mock.calls[2]![1].headers).get('x-csrf-token')).toBe('fresh');
  });

  it('does not retry a second rejection', async () => {
    setCsrfToken('old');
    fetchMock.mockResolvedValueOnce(denied(403, 'CSRF_DENIED')).mockResolvedValueOnce(json({ csrfToken: 'fresh' })).mockResolvedValueOnce(denied(403, 'CSRF_DENIED'));
    await expect(apiFetch('/api/v1/example', { method: 'POST', json: {} })).rejects.toMatchObject({ status: 403, code: 'CSRF_DENIED' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([[403, 'ORIGIN_DENIED'], [403, 'POLICY_DENIED'], [401, 'BUSINESS_DENIED'], [403, 'UNAUTHORIZED'], [401, 'CSRF_DENIED']])('never retries unrelated %s %s errors', async (status, code) => {
    setCsrfToken('old');
    fetchMock.mockResolvedValueOnce(denied(status, code));
    await expect(apiFetch('/api/v1/example', { method: 'PUT', json: {} })).rejects.toMatchObject({ status, code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not replay a stream body even after a gate rejection', async () => {
    setCsrfToken('old');
    fetchMock.mockResolvedValueOnce(denied(403, 'CSRF_DENIED'));
    const body = new globalThis.ReadableStream();
    await expect(apiFetch('/api/v1/example', { method: 'POST', body })).rejects.toMatchObject({ status: 403, code: 'CSRF_DENIED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry network failures', async () => {
    setCsrfToken('old');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(apiFetch('/api/v1/example', { method: 'POST', json: {} })).rejects.toMatchObject({ code: 'network_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh or replay an aborted write', async () => {
    setCsrfToken('old');
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(() => { controller.abort(); return Promise.resolve(denied(403, 'CSRF_DENIED')); });
    await expect(apiFetch('/api/v1/example', { method: 'POST', json: {}, signal: controller.signal })).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not send a write when cancellation occurs while fetching the first session', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(() => { controller.abort(); return Promise.resolve(json({ csrfToken: 'new' })); });
    await expect(apiFetch('/api/v1/example', { method: 'POST', json: {}, signal: controller.signal })).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['https://example.com/api/v1/example', '/api/v1/../../outside'])('does not refresh or replay requests outside the local API: %s', async (path) => {
    setCsrfToken('old');
    fetchMock.mockResolvedValueOnce(denied(403, 'CSRF_DENIED'));
    await expect(apiFetch(path, { method: 'POST', json: {} })).rejects.toMatchObject({ status: 403, code: 'CSRF_DENIED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a business denial for observe without masking it or retrying', async () => {
    setCsrfToken('current');
    fetchMock.mockResolvedValueOnce(denied(403, 'ORIGIN_DENIED'));
    expect(await putHearthObserve(true)).toMatchObject({ ok: false, status: 403, code: 'ORIGIN_DENIED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
