import { describe, expect, it } from 'vitest';
import { FLAME_LEVELS, flameTransitionSeconds, shellFlame } from '../../apps/web/src/features/flameVisual';
import { loadFixtureViewModel } from '../../apps/web/src/features/hearthViewModel';

const vm = (key: string) => {
  const s = loadFixtureViewModel('', key);
  if (s.kind !== 'ready') throw new Error(s.message);
  return s.vm;
};

describe('flameVisual (v7, reads only narrative.flame)', () => {
  it('maps levels to v7 heat', () => {
    expect([FLAME_LEVELS.neutral.heat, FLAME_LEVELS.ember.heat, FLAME_LEVELS.warm.heat, FLAME_LEVELS.bright.heat]).toEqual([0.1, 0.3, 0.6, 0.9]);
  });
  it('transitions 500ms for one level, 800ms for two or more', () => {
    expect(flameTransitionSeconds('neutral', 'ember')).toBe(0.5);
    expect(flameTransitionSeconds('neutral', 'warm')).toBe(0.8);
    expect(flameTransitionSeconds('neutral', 'bright')).toBe(0.8);
  });
  it('labels per status', () => {
    expect(shellFlame(vm('error')).label).toBe('火候未知');
    expect(shellFlame(vm('error')).instant).toBe(true);
    expect(shellFlame(vm('permission-denied')).label).toBe('未授权读取');
    expect(shellFlame(vm('stale')).label).toMatch(/ · 旧观测$/);
    const empty = shellFlame(vm('empty'));
    expect(empty.label).toBe('尚未点火');
    expect(empty.desaturated).toBeFalsy();
  });
  it('bright variant validates and renders 0.90', () => {
    const v = shellFlame(vm('bright'));
    expect(v.level).toBe('bright');
    expect(v.heat).toBe(0.9);
  });
  it('milestoneGold stacks on level without changing heat table', () => {
    const v = shellFlame(vm('ok'));
    expect(v.golden).toBe(1);
    expect(v.heat).toBe(FLAME_LEVELS.warm.heat);
    expect(v.outer).toBe(FLAME_LEVELS.warm.outer);
    expect(v.inner).toBe(FLAME_LEVELS.warm.inner);
    expect(v.flicker).toBe(FLAME_LEVELS.warm.flicker);
  });
});
