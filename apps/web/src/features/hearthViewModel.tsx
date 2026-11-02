import { ApiError, apiFetch, fetchSessionToken } from './api/client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { HearthViewModel, Permissions, type Permissions as PermissionsT } from '@hearth/hearth-contract';
import ok from '@hearth/hearth-contract/fixtures/ok.json';
import empty from '@hearth/hearth-contract/fixtures/empty.json';
import error from '@hearth/hearth-contract/fixtures/error.json';
import permissionDenied from '@hearth/hearth-contract/fixtures/permission-denied.json';
import stale from '@hearth/hearth-contract/fixtures/stale.json';

/** Unit-test / offline fixtures only. Real shell never falls back to these. */
const bright = { ...ok, narrative: { ...ok.narrative, flame: { ...ok.narrative.flame, level: 'bright' } } };
const FIXTURES: Record<string, unknown> = { ok, empty, error, 'permission-denied': permissionDenied, stale, bright };

export type ViewModelSource =
  | { kind: 'loading' }
  | { kind: 'ready'; vm: HearthViewModel }
  | { kind: 'invalid'; message: string }
  | { kind: 'network_error'; message: string; code: string };

/** Keep fixture loader for unit tests; production shell does not call this. */
export function loadFixtureViewModel(search: string, key?: string): ViewModelSource {
  const fixture = key ?? new URLSearchParams(search).get('fixture') ?? 'ok';
  const raw = FIXTURES[fixture];
  if (raw === undefined) {
    return { kind: 'invalid', message: `未知 fixture「${fixture}」，可选：${Object.keys(FIXTURES).join(' / ')}` };
  }
  const parsed = HearthViewModel.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: 'invalid',
      message: `ViewModel 校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('；')}`,
    };
  }
  return { kind: 'ready', vm: parsed.data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** GET /api/v1/hearth — accept 200/403/503 bodies that are valid ViewModels; never fixture-fallback. */
export async function fetchHearthViewModel(signal?: AbortSignal): Promise<ViewModelSource> {
  let response: Response;
  const getHearth = () => window.fetch('/api/v1/hearth', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  });
  try {
    response = await getHearth();
    if (response.status === 401 && !signal?.aborted) {
      const raw: unknown = await response.clone().json().catch(() => null);
      if (isRecord(raw) && isRecord(raw.error) && raw.error.code === 'UNAUTHORIZED' && !signal?.aborted) {
        // Bootstrap using the same session/token mechanism as the API client.
        // A 403/503 Hearth ViewModel must remain available to the caller.
        await fetchSessionToken(signal);
        if (signal?.aborted) return { kind: 'network_error', code: 'network_error', message: '请求已取消' };
        response = await getHearth();
      }
    }
  } catch (cause) {
    return {
      kind: 'network_error',
      code: cause instanceof ApiError ? cause.code : 'network_error',
      message: cause instanceof Error ? cause.message : '网络错误',
    };
  }

  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    return {
      kind: 'network_error',
      code: 'network_error',
      message: cause instanceof Error ? cause.message : '读取响应失败',
    };
  }

  let raw: unknown;
  try {
    raw = text.length === 0 ? null : (JSON.parse(text) as unknown);
  } catch {
    return { kind: 'invalid', message: `火候响应不是有效 JSON（HTTP ${response.status}）` };
  }

  const parsed = HearthViewModel.safeParse(raw);
  if (parsed.success) return { kind: 'ready', vm: parsed.data };

  if (isRecord(raw) && isRecord(raw.error) && typeof raw.error.message === 'string') {
    return {
      kind: 'network_error',
      code: typeof raw.error.code === 'string' ? raw.error.code : `http_${response.status}`,
      message: raw.error.message,
    };
  }

  return {
    kind: 'network_error',
    code: `http_${response.status}`,
    message: `火候接口返回 HTTP ${response.status}`,
  };
}

export type PutObserveResult =
  | { ok: true; permissions: PermissionsT }
  | { ok: false; code: string; message: string; status: number };

/** PUT observe through the shared session and CSRF client. */
export async function putHearthObserve(observe: boolean, signal?: AbortSignal): Promise<PutObserveResult> {
  try {
    const raw = await apiFetch<unknown>('/api/v1/hearth/permissions', {
      method: 'PUT', json: { observe }, signal,
    });
    const permissionsRaw = isRecord(raw) ? raw.permissions : undefined;
    const parsed = Permissions.safeParse(permissionsRaw);
    if (parsed.success) return { ok: true, permissions: parsed.data };
    return { ok: false, status: 200, code: 'invalid_response', message: '授权响应缺少 permissions' };
  } catch (cause) {
    if (cause instanceof ApiError) {
      return { ok: false, status: cause.status, code: cause.code, message: cause.message };
    }
    return { ok: false, status: 0, code: 'network_error', message: cause instanceof Error ? cause.message : '网络错误' };
  }
}

type CtxValue = {
  source: ViewModelSource;
  reload: () => void;
  authorizeObserve: () => Promise<PutObserveResult>;
  authBusy: boolean;
  authError: { code: string; message: string } | null;
  clearAuthError: () => void;
};

const Ctx = createContext<CtxValue | null>(null);

export function HearthViewModelProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<ViewModelSource>({ kind: 'loading' });
  const [revision, setRevision] = useState(0);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<{ code: string; message: string } | null>(null);

  const reload = useCallback(() => {
    setRevision((n) => n + 1);
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  useEffect(() => {
    const controller = new AbortController();
    setSource({ kind: 'loading' });
    void fetchHearthViewModel(controller.signal).then((next) => {
      if (!controller.signal.aborted) setSource(next);
    });
    return () => controller.abort();
  }, [revision]);

  const authorizeObserve = useCallback(async (): Promise<PutObserveResult> => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await putHearthObserve(true);
      if (result.ok) {
        // I-18: never rebuild UI from PUT body alone — refetch GET.
        const next = await fetchHearthViewModel();
        setSource(next);
        return result;
      }
      console.info('[hearth] put permissions failed', result.code, result.message);
      setAuthError({ code: result.code, message: result.message });
      return result;
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const value = useMemo<CtxValue>(
    () => ({ source, reload, authorizeObserve, authBusy, authError, clearAuthError }),
    [source, reload, authorizeObserve, authBusy, authError, clearAuthError],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useViewModelSource(): ViewModelSource {
  const value = useContext(Ctx);
  if (!value) throw new Error('useViewModelSource 需在 HearthViewModelProvider 内使用');
  return value.source;
}

export function useHearthViewModel(): CtxValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useHearthViewModel 需在 HearthViewModelProvider 内使用');
  return value;
}
