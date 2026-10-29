/** 炉温只由当前线程已确认的用户消息决定，不读取旧浏览器缓存或线程更新时间。 */
export type EmberBand = 'hot' | 'warm' | 'cool';
export interface EmberHeatResult {
  heat: number;
  band: EmberBand;
  greeting: string;
  subline: string;
  reason: string;
}
export function latestConfirmedInteraction(messages: ReadonlyArray<{role: string; createdAt: string; id: string}>, now = Date.now()): string | null {
  const times = messages.filter(m => m.role === 'user' && !m.id.startsWith('local-'))
    .map(m => Date.parse(m.createdAt)).filter(t => Number.isFinite(t) && t <= now);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}
export function computeEmberHeat(input: {lastConfirmedAt?: string | null; nowMs?: number}): EmberHeatResult {
  const now = input.nowMs ?? Date.now();
  const time = input.lastConfirmedAt ? Date.parse(input.lastConfirmedAt) : NaN;
  if (!Number.isFinite(time) || time > now) return {heat: .12, band:'cool', greeting:'从这里开始。', subline:'聊聊你正在做的项目。', reason:input.lastConfirmedAt ? 'unknown-time' : 'no-interaction'};
  const age = now - time;
  if(age <= 86400000) return {heat:.85,band:'hot',greeting:'火正旺。',subline:'接着聊就好。',reason:'within-24h'};
  if(age <= 7 * 86400000) return {heat:.52,band:'warm',greeting:'炉还温着。',subline:'想从哪聊起？',reason:'within-7d'};
  return {heat:.15,band:'cool',greeting:'余烬还在。',subline:'想接着上次聊，还是从新的想法开始？',reason:'stale-7d+'};
}
export function applyEmberHeatCss(heat: number): void {
  document.documentElement.style.setProperty('--ember-heat', String(Number.isFinite(heat) ? Math.min(1,Math.max(0,heat)) : .12));
}
