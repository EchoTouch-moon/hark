import { describe, expect, it } from 'vitest';
import type { StoryBeat } from '@hearth/hearth-contract';
import { BRIGHT_WINDOW_MS, WARM_WINDOW_MS, deriveFlame } from './flame.js';

const now = new Date('2026-11-01T00:00:00.000Z');
const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
const beat = (kind: StoryBeat['kind'], msAgo: number): StoryBeat => ({ kind, at: at(msAgo), summary: 's', evidence: [] });

describe('deriveFlame', () => {
  it.each([
    ['neutral', [] as StoryBeat[]],
    ['ember', [beat('诞生', 1)]],
    ['ember', [beat('诞生', 30 * 86_400_000), beat('探索', WARM_WINDOW_MS + 1)]],
    ['warm', [beat('诞生', 30 * 86_400_000), beat('探索', WARM_WINDOW_MS)]],
    ['warm', [beat('推进', BRIGHT_WINDOW_MS + 1)]],
    ['bright', [beat('推进', BRIGHT_WINDOW_MS)]],
    ['bright', [beat('推进', 0)]],
  ] as const)('%s', (level, story) => {
    expect(deriveFlame([...story], now).level).toBe(level);
  });
  it('milestoneGold 独立叠加', () => {
    expect(deriveFlame([beat('推进', 0), beat('沉淀', 40 * 86_400_000)], now)).toMatchObject({
      level: 'bright',
      milestoneGold: true,
    });
    expect(deriveFlame([beat('推进', 0)], now).milestoneGold).toBe(false);
  });
  it('reason 不暴露档位名或天数', () => {
    for (const s of [[], [beat('诞生', 1)], [beat('探索', 0)], [beat('推进', 0)]] as StoryBeat[][]) {
      const r = deriveFlame(s, now).reason;
      expect(r).not.toMatch(/neutral|ember|warm|bright|\d+\s*天/);
      expect([...r].length).toBeLessThanOrEqual(24);
    }
  });
});
