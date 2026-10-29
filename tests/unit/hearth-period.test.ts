import { describe, expect, it } from 'vitest';
import { getHearthPeriod } from '../../apps/web/src/features/hearthPeriod';

const at = (hour: number, minute = 0) => new Date(2026, 9, 30, hour, minute);

describe('炉心的本地昼夜', () => {
  it('changes at 07:00 and 19:00 in the device local time', () => {
    expect(getHearthPeriod(at(6, 59))).toBe('night');
    expect(getHearthPeriod(at(7))).toBe('day');
    expect(getHearthPeriod(at(18, 59))).toBe('day');
    expect(getHearthPeriod(at(19))).toBe('night');
    expect(getHearthPeriod(at(0))).toBe('night');
  });
});
