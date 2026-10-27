/**
 * Hermes read-only capability probe (M2-T03).
 *
 * STRICTLY a health/capabilities GET probe against the local loopback
 * gateway. It never starts tool-enabled runs, never sends credentials we
 * don't already have, and reports `unconfigured` rather than pretending a
 * connection exists.
 */

export type HermesStatus =
  | { state: 'unconfigured'; detail: string }
  | { state: 'unreachable'; detail: string }
  | { state: 'reachable'; version?: string; capabilities: string[]; detail: string };

export interface HermesProbeResult {
  status: HermesStatus;
  probedAt: string;
  url: string | null;
}

export interface HermesFetch {
  (url: string, init?: { signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export class HermesApiAdapter {
  readonly id = 'hermes';
  readonly live = true; // capable of live use WHEN configured & reachable

  constructor(
    private readonly deps: {
      url?: string;
      fetchImpl?: HermesFetch;
      timeoutMs?: number;
      now?: () => string;
    },
  ) {}

  get configured(): boolean {
    return typeof this.deps.url === 'string' && this.deps.url.length > 0;
  }

  /** Read-only health/capabilities probe. Never executes tools. */
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
