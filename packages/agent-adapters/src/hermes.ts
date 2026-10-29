/**
 * @fileoverview Hermes 只读能力探测适配器（Hermes Read-only Probe，M2-T03）
 * 
 * 安全红线：
 * 1. 严格仅限发送只读的 GET /capabilities 健康探测
 * 2. 绝不擅自执行工具，绝不发送未经授权的系统密钥
 * 3. 若未配置环境变量则诚实报告 `unconfigured`，严禁伪造已连接状态
 */

/** Hermes 连接状态结构 */
export type HermesStatus =
  | { state: 'unconfigured'; detail: string }
  | { state: 'unreachable'; detail: string }
  | { state: 'reachable'; version?: string; capabilities: string[]; detail: string };

/** 探测结果报告 */
export interface HermesProbeResult {
  status: HermesStatus;
  probedAt: string;
  url: string | null;
}

/** HTTP 探测 fetch 注入接口 */
export interface HermesFetch {
  (url: string, init?: { signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

/**
 * Hermes 接口适配器
 */
export class HermesApiAdapter {
  readonly id = 'hermes';
  readonly live = true; // 当配置并可达时具备实时连接能力

  constructor(
    private readonly deps: {
      url?: string;
      fetchImpl?: HermesFetch;
      timeoutMs?: number;
      now?: () => string;
    },
  ) {}

  /** 是否已显式配置 Hermes URL */
  get configured(): boolean {
    return typeof this.deps.url === 'string' && this.deps.url.length > 0;
  }

  /**
   * 执行只读健康与能力探测（绝不调用任何工具副作用）
   */
  async probe(): Promise<HermesProbeResult> {
    const now = this.deps.now ?? (() => new Date().toISOString());
    if (!this.configured) {
      return {
        status: { state: 'unconfigured', detail: 'HEARTH_HERMES_URL 未设置；不会请求用户密钥，也不假装在线' },
        probedAt: now(),
        url: null,
      };
    }
    const url = this.deps.url!;
    const doFetch = this.deps.fetchImpl ?? defaultFetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs ?? 2500);
    try {
      const res = await doFetch(`${url.replace(/\/$/, '')}/capabilities`, { signal: controller.signal });
      if (!res.ok) {
        return {
          status: { state: 'unreachable', detail: `capabilities endpoint HTTP ${res.status}` },
          probedAt: now(),
          url,
        };
      }
      const body = (await res.json()) as unknown;
      const caps = parseCapabilities(body);
      if (caps === null) {
        return {
          status: { state: 'unreachable', detail: 'capabilities 响应格式不符合预期' },
          probedAt: now(),
          url,
        };
      }
      return {
        status: { state: 'reachable', capabilities: caps, detail: 'loopback probe ok (read-only)' },
        probedAt: now(),
        url,
      };
    } catch (err) {
      return {
        status: { state: 'unreachable', detail: `probe failed: ${String(err)}` },
        probedAt: now(),
        url,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseCapabilities(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const caps = (body as Record<string, unknown>)['capabilities'];
  if (!Array.isArray(caps)) return null;
  const ok = caps.every((c) => typeof c === 'string');
  return ok ? (caps as string[]) : null;
}

async function defaultFetch(url: string, init?: { signal?: AbortSignal }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> {
  const res = await fetch(url, { signal: init?.signal });
  return { ok: res.ok, status: res.status, json: () => res.json() };
}
