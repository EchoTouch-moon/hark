/**
 * 统一 fetch 封装：同源相对路径 /api/v1/*，不引入其它 HTTP 库。
 *
 * 约定（见 docs/04-CONTRACTS.md）：
 * - 会话 cookie 由服务器管理（HttpOnly），前端只缓存 CSRF token；
 * - 写方法自动携带 `content-type: application/json` 与 `x-csrf-token`；
 * - 无 token 时先建立会话；仅服务端门禁明确拒绝且请求可安全重放时，
 *   刷新会话并重试一次。普通业务错误和网络失败绝不自动重放写请求。
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** GET 会话入口（服务器在此下发 CSRF token；cookie 由其自行管理） */
const SESSION_PATH = '/api/v1/auth/session';

const CSRF_STORAGE_KEY = 'hearth.csrfToken';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Only same-origin API paths can return our pre-handler gate errors. */
function isLocalApiRequest(path: string, credentials: string | undefined): boolean {
  if (!path.startsWith('/api/v1/') || (credentials !== undefined && credentials !== 'same-origin')) return false;
  try {
    return new URL(path, 'http://localhost').pathname.startsWith('/api/v1/');
  } catch {
    return false;
  }
}

/** 请求初始化参数；`json` 存在时自动序列化为请求体 */
export type ApiFetchInit = RequestInit & { json?: unknown };

let cachedCsrfToken: string | null = null;

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(CSRF_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 保存（或清除）CSRF token：写入内存缓存 + localStorage */
export function setCsrfToken(token: string | null): void {
  cachedCsrfToken = token;
  try {
    if (token === null) {
      window.localStorage.removeItem(CSRF_STORAGE_KEY);
    } else {
      window.localStorage.setItem(CSRF_STORAGE_KEY, token);
    }
  } catch {
    // localStorage 不可用（隐私模式等）时仅保留内存缓存
  }
}

/** 读取 CSRF token：优先内存缓存，其次 localStorage */
export function getCsrfToken(): string | null {
  if (cachedCsrfToken === null) {
    cachedCsrfToken = readStoredToken();
  }
  return cachedCsrfToken;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractErrorMessage(body: unknown, status: number): { code: string; message: string } {
  // 兼容 { error: { code, message } }、{ code, message }、{ message } 三种错误形状
  const candidates = isRecord(body) ? [body['error'], body] : [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const code = candidate['code'];
    const message = candidate['message'];
    if (typeof code === 'string' && typeof message === 'string') {
      return { code, message };
    }
    if (typeof message === 'string') {
      return { code: `http_${status}`, message };
    }
  }
  return { code: `http_${status}`, message: `请求失败（HTTP ${status}）` };
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = JSON.parse(await response.text()) as unknown;
  } catch {
    // 非 JSON 错误体，退回状态码信息
  }
  const { code, message } = extractErrorMessage(body, response.status);
  return new ApiError(response.status, code, message);
}

/** 向服务器请求新的会话 CSRF token 并保存 */
export async function fetchSessionToken(signal?: AbortSignal | null): Promise<string> {
  let response: Response;
  try {
    response = await window.fetch(SESSION_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal,
    });
  } catch (cause) {
    throw new ApiError(
      0,
      'network_error',
      `无法连接本地服务（${SESSION_PATH}）：${cause instanceof Error ? cause.message : '网络错误'}`,
    );
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  let data: unknown;
  try {
    data = JSON.parse(await response.text()) as unknown;
  } catch {
    throw new ApiError(response.status, 'invalid_json', '会话响应不是有效的 JSON');
  }
  const token = isRecord(data) ? data['csrfToken'] : undefined;
  if (typeof token !== 'string' || token.length === 0) {
    throw new ApiError(response.status, 'auth_session_failed', '会话响应缺少 csrfToken');
  }
  setCsrfToken(token);
  return token;
}

async function ensureCsrfToken(signal?: AbortSignal | null): Promise<string> {
  const existing = getCsrfToken();
  if (existing !== null && existing.length > 0) return existing;
  return fetchSessionToken(signal);
}

/**
 * 发起同源 API 请求并解析 JSON 响应。
 *
 * @example
 *   const health = await apiFetch<HealthStatus>('/api/v1/health');
 *   await apiFetch('/api/v1/cards/x/dismiss', { method: 'POST', json: {} });
 */
export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { json, ...baseInit } = init;
  const method = (baseInit.method ?? 'GET').toUpperCase();

  const headers = new Headers(baseInit.headers);
  headers.set('accept', 'application/json');

  let body: BodyInit | null = baseInit.body ?? null;
  if (json !== undefined) {
    body = JSON.stringify(json);
  }

  const doFetch = (): Promise<Response> =>
    window.fetch(path, {
      ...baseInit,
      method,
      headers,
      body,
      credentials: baseInit.credentials ?? 'same-origin',
    });

  if (WRITE_METHODS.has(method)) {
    if (body !== null && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const token = await ensureCsrfToken(baseInit.signal);
    if (baseInit.signal?.aborted) throw new ApiError(0, 'network_error', '请求已取消');
    headers.set('x-csrf-token', token);

    let response: Response;
    try {
      response = await doFetch();
    } catch (cause) {
      throw new ApiError(
        0,
        'network_error',
        cause instanceof Error ? `网络请求失败：${cause.message}` : '网络请求失败',
      );
    }

    if (!response.ok) {
      const error = await toApiError(response);
      // 仅这两个代码由同源服务端的全局门禁在路由执行前返回；
      // 仅重放确定可重复读取的请求体，避免流或业务 403 导致写入重复。
      const gateRejected = (error.status === 401 && error.code === 'UNAUTHORIZED') ||
        (error.status === 403 && error.code === 'CSRF_DENIED' && method !== 'PATCH');
      const replayable = body === null || typeof body === 'string';
      const localApi = isLocalApiRequest(path, baseInit.credentials);
      if (!gateRejected || !replayable || !localApi || baseInit.signal?.aborted) throw error;
      try {
        const freshToken = await fetchSessionToken(baseInit.signal);
        headers.set('x-csrf-token', freshToken);
      } catch {
        throw error;
      }
      if (baseInit.signal?.aborted) throw error;
      try {
        const retried = await doFetch();
        if (!retried.ok) throw await toApiError(retried);
        return parseResponseBody<T>(retried);
      } catch (cause) {
        if (cause instanceof ApiError) throw cause;
        throw new ApiError(0, 'network_error', '重试请求失败');
      }
    }

    return parseResponseBody<T>(response);
  }

  let response: Response;
  try {
    response = await doFetch();
  } catch (cause) {
    throw new ApiError(
      0,
      'network_error',
      cause instanceof Error ? `网络请求失败：${cause.message}` : '网络请求失败',
    );
  }
  if (!response.ok) {
    const error = await toApiError(response);
    const localApi = isLocalApiRequest(path, baseInit.credentials);
    if (method !== 'GET' || !localApi || error.status !== 401 || error.code !== 'UNAUTHORIZED' || baseInit.signal?.aborted) throw error;
    try {
      await fetchSessionToken(baseInit.signal);
    } catch {
      throw error;
    }
    if (baseInit.signal?.aborted) throw error;
    try {
      const retried = await doFetch();
      if (!retried.ok) throw await toApiError(retried);
      return parseResponseBody<T>(retried);
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError(0, 'network_error', '重试请求失败');
    }
  }

  return parseResponseBody<T>(response);
}

async function parseResponseBody<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, 'invalid_json', '响应不是有效的 JSON');
  }
}
