import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../apps/web/src/features/api/client';
import { fetchHearthViewModel } from '../../apps/web/src/features/hearthViewModel';
import deniedView from '../../packages/hearth-contract/fixtures/permission-denied.json';
import errorView from '../../packages/hearth-contract/fixtures/error.json';

const json = (body: unknown, status = 200) => new globalThis.Response(JSON.stringify(body), { status });
const gateError = (code: string) => json({ error: { code, message: 'synthetic failure' } }, 401);
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  const data = new Map<string, string>();
  vi.stubGlobal('window', { fetch: fetchMock, localStorage: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  } });
  setCsrfToken(null);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Hearth cold-start session recovery', () => {
  it('establishes a session after UNAUTHORIZED and preserves a 403 permission ViewModel', async () => {
    fetchMock.mockResolvedValueOnce(gateError('UNAUTHORIZED'))
      .mockResolvedValueOnce(json({ csrfToken: 'synthetic-token' }))
      .mockResolvedValueOnce(json(deniedView, 403));
    expect(await fetchHearthViewModel()).toMatchObject({ kind: 'ready', vm: { status: 'permission_denied' } });
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/v1/hearth', '/api/v1/auth/session', '/api/v1/hearth']);
  });

  it.each([[403, deniedView, 'permission_denied'], [503, errorView, 'error']] as const)(
    'preserves the valid %s business ViewModel without session initialization', async (status, view, expected) => {
      fetchMock.mockResolvedValueOnce(json(view, status));
      expect(await fetchHearthViewModel()).toMatchObject({ kind: 'ready', vm: { status: expected } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves a 503 error ViewModel after restoring the session', async () => {
    fetchMock.mockResolvedValueOnce(gateError('UNAUTHORIZED'))
      .mockResolvedValueOnce(json({ csrfToken: 'synthetic-token' }))
      .mockResolvedValueOnce(json(errorView, 503));
    expect(await fetchHearthViewModel()).toMatchObject({ kind: 'ready', vm: { status: 'error' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not create a session for an invalid 401 response body', async () => {
    fetchMock.mockResolvedValueOnce(new globalThis.Response('not json', { status: 401 }));
    expect(await fetchHearthViewModel()).toMatchObject({ kind: 'invalid' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not create a session for a different 401 error', async () => {
    fetchMock.mockResolvedValueOnce(gateError('BUSINESS_DENIED'));
    expect(await fetchHearthViewModel()).toMatchObject({ kind: 'network_error', code: 'BUSINESS_DENIED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a second UNAUTHORIZED response', async () => {
    fetchMock.mockResolvedValueOnce(gateError('UNAUTHORIZED'))
      .mockResolvedValueOnce(json({ csrfToken: 'synthetic-token' }))
      .mockResolvedValueOnce(gateError('UNAUTHORIZED'));
    expect(await fetchHearthViewModel()).toMatchObject({ kind: 'network_error', code: 'UNAUTHORIZED' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('exposes session failure instead of returning fixture data', async () => {
    fetchMock.mockResolvedValueOnce(gateError('UNAUTHORIZED'))
      .mockRejectedValueOnce(new Error('offline'));
    expect(await fetchHearthViewModel()).toMatchObject({ kind: 'network_error', code: 'network_error' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not start a session when the read is already cancelled', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(() => { controller.abort(); return Promise.resolve(gateError('UNAUTHORIZED')); });
    expect(await fetchHearthViewModel(controller.signal)).toMatchObject({ kind: 'network_error', code: 'UNAUTHORIZED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-read when cancellation occurs while the session is loading', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(gateError('UNAUTHORIZED'))
      .mockImplementationOnce(() => { controller.abort(); return Promise.resolve(json({ csrfToken: 'synthetic-token' })); });
    expect(await fetchHearthViewModel(controller.signal)).toMatchObject({ kind: 'network_error' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
