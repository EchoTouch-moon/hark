/**
 * 炉温（emberHeat）本地启发式 · Style Bible v6 Addendum
 * 不落库；跨端持久后拍 Won't。
 *
 * 档位：
 * - 旺 ≈0.75–1：本会话已发送，或 24h 内有互动
 * - 温 ≈0.4–0.65：1–7 天内有互动、本会话未聊
 * - 黯 ≈0–0.25：>7 天无互动 / 新装未聊
 */

export type EmberBand = 'hot' | 'warm' | 'cool';

export interface EmberHeatResult {
  /** 0–1，写入 CSS --ember-heat */
  heat: number;
  band: EmberBand;
  /** 空态衬线问候 */
  greeting: string;
  /** 次行钩子（可空） */
  subline: string;
  /** 判定依据，便于交接/调试 */
  reason: string;
}

const SESSION_SENT_PREFIX = 'hearth.ember.sessionSent.v6.';
const LAST_INTERACTION_KEY = 'hearth.ember.lastInteraction.v6';

const MS_DAY = 24 * 60 * 60 * 1000;

function readLastMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(LAST_INTERACTION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeLastMap(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(LAST_INTERACTION_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

/** 本会话是否已在该线程发过言（sessionStorage，关页即失）。 */
export function hasSessionSent(threadId: string | null | undefined): boolean {
  if (!threadId) return false;
  try {
    return window.sessionStorage.getItem(SESSION_SENT_PREFIX + threadId) === '1';
  } catch {
    return false;
  }
}

/** 发送成功后立刻抬到旺。 */
export function markSessionSent(threadId: string): void {
  try {
    window.sessionStorage.setItem(SESSION_SENT_PREFIX + threadId, '1');
  } catch {
    // ignore
  }
  recordInteraction(threadId);
}

/** 记录本地最近互动（发送 / 批准行动等）。 */
export function recordInteraction(threadId: string, atIso?: string): void {
  const map = readLastMap();
  map[threadId] = atIso ?? new Date().toISOString();
  writeLastMap(map);
}

export function getLocalLastInteraction(threadId: string | null | undefined): string | null {
  if (!threadId) return null;
  return readLastMap()[threadId] ?? null;
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * 取最近互动时刻：max(thread.updatedAt, 本地 lastInteraction)。
 * 本会话已发送 → 强制旺。
 */
export function computeEmberHeat(input: {
  threadId?: string | null;
  threadUpdatedAt?: string | null;
  /** 单测/预览用，默认 Date.now() */
  nowMs?: number;
}): EmberHeatResult {
  const now = input.nowMs ?? Date.now();
  const threadId = input.threadId ?? null;

  if (threadId && hasSessionSent(threadId)) {
    return {
      heat: 0.9,
      band: 'hot',
      greeting: '火正旺。',
      subline: '接着聊就好。',
      reason: 'session-sent',
    };
  }

  const localIso = getLocalLastInteraction(threadId);
  const remoteMs = parseTime(input.threadUpdatedAt);
  const localMs = parseTime(localIso);
  const latest =
    remoteMs !== null && localMs !== null
      ? Math.max(remoteMs, localMs)
      : (remoteMs ?? localMs);

  if (latest === null) {
    return {
      heat: 0.12,
      band: 'cool',
      greeting: '余烬还在。',
      subline: '吹一口气，火会回来。',
      reason: 'no-interaction',
    };
  }

  const age = now - latest;
  if (age <= MS_DAY) {
    return {
      heat: 0.85,
      band: 'hot',
      greeting: '火正旺。',
      subline: '炉边还热着。',
      reason: 'within-24h',
    };
  }
  if (age <= 7 * MS_DAY) {
    return {
      heat: 0.52,
      band: 'warm',
      greeting: '炉还温着。',
      subline: '想从哪聊起？',
      reason: 'within-7d',
    };
  }
  return {
    heat: 0.15,
    band: 'cool',
    greeting: '余烬还在。',
    subline: '吹一口气，火会回来。',
    reason: 'stale-7d+',
  };
}

/** 把 heat 写到 documentElement，供全局 token 插值。 */
export function applyEmberHeatCss(heat: number): void {
  const clamped = Math.min(1, Math.max(0, heat));
  // coolFactor: heat≤0 → 1；heat≥0.4 → 0（与 tokens 黯/暖混色对齐）
  const coolFactor = Math.min(1, Math.max(0, (0.4 - clamped) / 0.4));
  const root = document.documentElement;
  root.style.setProperty('--ember-heat', String(clamped));
  root.style.setProperty('--ember-cool-factor', String(coolFactor));
}
