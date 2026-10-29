/**
 * Visual warmth belongs to the active conversation. It is derived only from
 * confirmed user messages, not from drafts, model output, or project health.
 */
export type EmberBand = 'hot' | 'warm' | 'cool';
export interface EmberHeatResult {
  heat: number;
  band: EmberBand;
  greeting: string;
  subline: string;
  reason: string;
}

type MessageTime = { role: string; createdAt: string; id: string };
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_INTERACTIONS = 4;

/** Unique, confirmed user messages with valid, non-future timestamps. */
export function confirmedInteractionTimes(messages: readonly MessageTime[], now = Date.now()): string[] {
  const seen = new Set<string>();
  const times: string[] = [];
  for (const message of messages) {
    if (message.role !== 'user' || !message.id || message.id.startsWith('local-') || seen.has(message.id)) continue;
    const parsed = Date.parse(message.createdAt);
    if (!Number.isFinite(parsed) || parsed > now) continue;
    seen.add(message.id);
    times.push(new Date(parsed).toISOString());
  }
  return times;
}

export function latestConfirmedInteraction(messages: readonly MessageTime[], now = Date.now()): string | null {
  const times = confirmedInteractionTimes(messages, now).map((time) => Date.parse(time));
  return times.length ? new Date(times.reduce((latest, time) => Math.max(latest, time), -Infinity)).toISOString() : null;
}

export function computeEmberHeat(input: {
  lastConfirmedAt?: string | null;
  interactionTimes?: readonly string[];
  nowMs?: number;
}): EmberHeatResult {
  const now = input.nowMs ?? Date.now();
  const latest = input.lastConfirmedAt ? Date.parse(input.lastConfirmedAt) : NaN;
  if (!Number.isFinite(latest) || latest > now) {
    return { heat: 0.12, band: 'cool', greeting: '从这里开始。', subline: '聊聊你正在做的项目。', reason: input.lastConfirmedAt ? 'unknown-time' : 'no-interaction' };
  }

  const age = now - latest;
  if (age > 7 * DAY_MS) {
    return { heat: 0.15, band: 'cool', greeting: '接着上次聊。', subline: '或者，从一个新的想法开始。', reason: 'stale-7d+' };
  }
  const recentCount = input.interactionTimes
    ? input.interactionTimes.filter((value) => {
        const timestamp = Date.parse(value);
        return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= 7 * DAY_MS;
      }).length
    : 1;
  const steps = Math.max(1, Math.min(MAX_INTERACTIONS, recentCount)) - 1;
  if (age <= DAY_MS) {
    return { heat: 0.42 + steps * 0.11, band: 'hot', greeting: '接着聊就好。', subline: '想从哪里继续？', reason: 'within-24h' };
  }
  return { heat: 0.28 + steps * 0.055, band: 'warm', greeting: '接着上次聊。', subline: '想从哪里继续？', reason: 'within-7d' };
}

export function applyEmberHeatCss(heat: number): void {
  document.documentElement.style.setProperty('--ember-heat', String(Number.isFinite(heat) ? Math.min(1, Math.max(0, heat)) : 0.12));
}
