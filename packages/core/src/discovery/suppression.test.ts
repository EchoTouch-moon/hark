import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUPPRESSION,
  dailyBudgetRemaining,
  dismissalCooldownActive,
  isWithinQuietHours,
  localDayKey,
  wallClock,
} from './suppression.js';

const SH = { start: '22:00', end: '08:00', timezone: 'Asia/Shanghai' };
const NY = { start: '22:00', end: '08:00', timezone: 'America/New_York' };

describe('quiet hours (M2-T02)', () => {
  it('Asia/Shanghai: 23:30 local is quiet, 12:00 local is not', () => {
    expect(isWithinQuietHours(new Date('2026-10-28T15:30:00Z'), SH)).toBe(true); // 23:30 +08
    expect(isWithinQuietHours(new Date('2026-10-28T04:00:00Z'), SH)).toBe(false); // 12:00 +08
    expect(isWithinQuietHours(new Date('2026-10-28T14:00:00Z'), SH)).toBe(true); // 22:00 边界进入
    expect(isWithinQuietHours(new Date('2026-10-28T00:00:00Z'), SH)).toBe(false); // 08:00 边界离开
  });

  it('boundary minute 08:00 is outside, 07:59 inside', () => {
    expect(isWithinQuietHours(new Date('2026-10-27T23:59:00Z'), SH)).toBe(true); // 07:59 +08
    expect(isWithinQuietHours(new Date('2026-10-28T00:00:00Z'), SH)).toBe(false); // 08:00 +08
  });

  it('DST fall-back (America/New_York 2026-11-01): wall clock drives the decision', () => {
    // 2026-11-01 06:30 UTC = 01:30 EDT before fallback, then 01:30 EST after 06:00Z...
    // both instants map to wall clock 01:30 => quiet either way (deterministic under DST)
    const before = new Date('2026-11-01T05:30:00Z'); // 01:30 EDT
    const after = new Date('2026-11-01T06:30:00Z'); // 01:30 EST (clock fell back)
    expect(isWithinQuietHours(before, NY)).toBe(true);
    expect(isWithinQuietHours(after, NY)).toBe(true);
    // 13:00 UTC = 09:00 EST (after fallback) => not quiet
    expect(isWithinQuietHours(new Date('2026-11-01T13:00:00Z'), NY)).toBe(false);
  });

  it('same start/end means never quiet (degenerate config)', () => {
    expect(isWithinQuietHours(new Date(), { start: '09:00', end: '09:00', timezone: 'UTC' })).toBe(false);
  });

  it('wallClock helper reflects tz', () => {
    expect(wallClock(new Date('2026-10-28T04:00:00Z'), 'Asia/Shanghai')).toEqual({ hour: 12, minute: 0 });
    expect(wallClock(new Date('2026-10-28T04:00:00Z'), 'UTC')).toEqual({ hour: 4, minute: 0 });
  });
});

describe('cooldown and budget', () => {
  it('dismissal cooldown window respected and expires', () => {
    const dismissedAt = new Date('2026-10-28T12:00:00Z');
    const h = DEFAULT_SUPPRESSION.dismissCooldownHours;
    expect(dismissalCooldownActive(dismissedAt, new Date('2026-10-28T13:00:00Z'), h)).toBe(true);
    expect(dismissalCooldownActive(dismissedAt, new Date('2026-10-28T11:00:00Z'), h)).toBe(true); // future clock still suppressed
    expect(dismissalCooldownActive(dismissedAt, new Date('2026-11-05T12:00:00Z'), h)).toBe(false);
  });

  it('daily budget', () => {
    expect(dailyBudgetRemaining(0, 3)).toBe(3);
    expect(dailyBudgetRemaining(3, 3)).toBe(0);
    expect(dailyBudgetRemaining(9, 3)).toBe(0);
  });

  it('localDayKey switches at local midnight, not UTC midnight', () => {
    expect(localDayKey(new Date('2026-10-28T17:00:00Z'), 'Asia/Shanghai')).toBe('2026-10-29');
    expect(localDayKey(new Date('2026-10-28T17:00:00Z'), 'UTC')).toBe('2026-10-28');
  });
});
