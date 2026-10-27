/**
 * Suppression policies (M2-T02): quiet hours, dismissal cooldown, daily budget.
 *
 * All time math goes through Intl with an explicit IANA timezone, so DST
 * transitions resolve like the wall clock the user actually experiences
 * (e.g. America/New_York fall-back yields 1:30 twice; we treat quiet hours
 * as wall-clock ranges, matching user intent).
 */

export interface QuietHoursSettings {
  start: string; // "HH:mm" local wall clock
  end: string; // "HH:mm"
  timezone: string; // IANA name, e.g. Asia/Shanghai
}

export interface SuppressionSettings {
  quietHours: QuietHoursSettings;
  maxCardsPerDay: number;
  dismissCooldownHours: number;
}

export const DEFAULT_SUPPRESSION: SuppressionSettings = {
  quietHours: { start: '22:00', end: '08:00', timezone: 'Asia/Shanghai' },
  maxCardsPerDay: 3,
  dismissCooldownHours: 72,
};

function localWallClockParts(date: Date, timezone: string): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  for (const part of fmt.formatToParts(date)) {
    if (part.type === 'hour' && part.value) {
      const hour = Number(part.value) % 24; // Intl may emit "24" at midnight
      return { hour, minute: date.getMinutes() }; // minute part below refines
    }
  }
  return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

function localMinutesOfDay(date: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === 'hour' && p.value) h = Number(p.value) % 24;
    if (p.type === 'minute' && p.value) m = Number(p.value);
  }
  return h * 60 + m;
}

function parseHHmm(v: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (!m) throw new Error(`invalid HH:mm: ${v}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isWithinQuietHours(now: Date, q: QuietHoursSettings): boolean {
  const minutes = localMinutesOfDay(now, q.timezone);
  const start = parseHHmm(q.start);
  const end = parseHHmm(q.end);
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  // overnight window (22:00 -> 08:00)
  return minutes >= start || minutes < end;
}

/** Wall-clock check kept exported for observability/UI. */
export function wallClock(now: Date, timezone: string): { hour: number; minute: number } {
  const minutes = localMinutesOfDay(now, timezone);
  return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
}

export function dismissalCooldownActive(
  dismissedAt: Date,
  now: Date,
  cooldownHours: number,
): boolean {
  return now.getTime() - dismissedAt.getTime() < cooldownHours * 3_600_000;
}

export function dailyBudgetRemaining(
  cardsCreatedToday: number,
  maxCardsPerDay: number,
): number {
  return Math.max(0, maxCardsPerDay - cardsCreatedToday);
}

/** Local calendar-day key (YYYY-MM-DD) in the configured timezone. */
export function localDayKey(date: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date); // en-CA gives YYYY-MM-DD
}

export { localWallClockParts };
