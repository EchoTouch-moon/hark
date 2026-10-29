import { describe, expect, it } from 'vitest';
import { computeEmberHeat, confirmedInteractionTimes } from '../../apps/web/src/features/emberHeat';
const now = Date.parse('2026-10-30T12:00:00Z');
const time = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
const message = (id: string, hours: number, role = 'user') => ({id, role, createdAt: time(hours)});

describe('对话中央的火光', () => {
  it('only counts distinct confirmed users with valid nonfuture timestamps', () => {
    const data = [message('a',1),message('a',1),message('local-x',0),message('assistant',0,'assistant'),message('future',-1),{id:'bad',role:'user',createdAt:'invalid'}];
    expect(confirmedInteractionTimes(data, now)).toEqual([time(1)]);
  });
  it('grows gradually for recent confirmed conversation and caps after four messages', () => {
    const value = (count:number) => computeEmberHeat({lastConfirmedAt:time(1), interactionTimes:Array.from({length:count},(_,i)=>time(i+1)), nowMs:now}).heat;
    expect(value(1)).toBeLessThan(value(2));
    expect(value(2)).toBeLessThan(value(4));
    expect(value(4)).toBe(value(10));
  });
  it('ages and excludes messages older than seven days, future, and invalid timestamps', () => {
    const one = computeEmberHeat({lastConfirmedAt:time(1),interactionTimes:[time(1)],nowMs:now});
    const invalid = computeEmberHeat({lastConfirmedAt:time(1),interactionTimes:[time(1),time(169),time(-1),'invalid'],nowMs:now});
    expect(invalid.heat).toBe(one.heat);
    expect(computeEmberHeat({lastConfirmedAt:time(169),interactionTimes:[time(169)],nowMs:now}).band).toBe('cool');
  });
});
