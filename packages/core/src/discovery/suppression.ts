/**
 * @fileoverview 主动建议抑制策略（Suppression Policies，M2-T02）
 * 包含：静默时段控制（Quiet Hours）、用户忽略冷却期（Dismissal Cooldown）以及每日建议上限预算（Daily Budget）。
 * 
 * 时区计算全部基于 IANA 规范时区的 Intl API，正确处理夏令时（DST）平移，
 * 贴合用户在本地实际经历的钟表时间（Wall-clock time）。
 */

/** 静默时段配置接口 */
export interface QuietHoursSettings {
  /** 起始时间，本地钟表时间格式 "HH:mm"（如 "22:00"） */
  start: string;
  /** 结束时间，本地钟表时间格式 "HH:mm"（如 "08:00"） */
  end: string;
  /** IANA 标准时区名称（如 "Asia/Shanghai", "America/New_York"） */
  timezone: string;
}

/** 综合抑制规则配置 */
export interface SuppressionSettings {
  /** 静默时段设置 */
  quietHours: QuietHoursSettings;
  /** 每天最多主动生成的卡片数量 */
  maxCardsPerDay: number;
  /** 用户点击「忽略」后的冷却时长（小时），在此期间相同 suppressionKey 不再出屏 */
  dismissCooldownHours: number;
}

/** 默认抑制策略：22:00~08:00 静默、每日最多3张、忽略冷却72小时 */
export const DEFAULT_SUPPRESSION: SuppressionSettings = {
  quietHours: { start: '22:00', end: '08:00', timezone: 'Asia/Shanghai' },
  maxCardsPerDay: 3,
  dismissCooldownHours: 72,
};

/** 获取指定时区下的本地钟表时间时分部件 */
function localWallClockParts(date: Date, timezone: string): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  for (const part of fmt.formatToParts(date)) {
    if (part.type === 'hour' && part.value) {
      const hour = Number(part.value) % 24; // Intl 跨午夜可能返回 "24"
      return { hour, minute: date.getMinutes() };
    }
  }
  return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

/** 计算指定时区下一天中已度过的分钟数（0 ~ 1439） */
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

/** 解析 "HH:mm" 字符串为当天的绝对分钟数 */
function parseHHmm(v: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (!m) throw new Error(`invalid HH:mm: ${v}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 判断给定时间点是否处于配置的静默时段之内
 * 支持跨午夜时间段（如 22:00 -> 08:00）及同日时间段（如 13:00 -> 14:00）
 */
export function isWithinQuietHours(now: Date, q: QuietHoursSettings): boolean {
  const minutes = localMinutesOfDay(now, q.timezone);
  const start = parseHHmm(q.start);
  const end = parseHHmm(q.end);
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  // 跨午夜区间（如 22:00 -> 08:00）：当前时间晚于起始点或早于结束点
  return minutes >= start || minutes < end;
}

/** 获取当前时区的本地钟表时间（供前端或诊断观测使用） */
export function wallClock(now: Date, timezone: string): { hour: number; minute: number } {
  const minutes = localMinutesOfDay(now, timezone);
  return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
}

/**
 * 判断忽略冷却期是否仍在生效
 * 在冷却期内，相同建议不会再次打扰用户
 */
export function dismissalCooldownActive(
  dismissedAt: Date,
  now: Date,
  cooldownHours: number,
): boolean {
  return now.getTime() - dismissedAt.getTime() < cooldownHours * 3_600_000;
}

/**
 * 计算今日剩余的主动卡片配额预算
 */
export function dailyBudgetRemaining(
  cardsCreatedToday: number,
  maxCardsPerDay: number,
): number {
  return Math.max(0, maxCardsPerDay - cardsCreatedToday);
}

/**
 * 获取指定时区下的本地日历日期键（格式：YYYY-MM-DD）
 * 严格按照目标时区的自然日划分，防止 UTC 跨天导致配额刷新混乱
 */
export function localDayKey(date: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date); // en-CA 格式输出 YYYY-MM-DD
}

export { localWallClockParts };
