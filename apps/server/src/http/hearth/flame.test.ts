import { describe, expect, it } from 'vitest';
import type { StoryBeat } from '@hearth/hearth-contract';
import { deriveFlame } from './flame.js';

const now = new Date('2026-11-01T00:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const beat = (kind: StoryBeat['kind'], days: number): StoryBeat => ({ kind, at: ago(days), summary: 's', evidence: [] });

describe('deriveFlame', () => {
  it.each([
    ['neutral', []],
    ['ember', [beat('诞生', 1)]],
    ['ember', [beat('诞生', 30), beat('探索', 20)]],
    ['warm', [beat('诞生', 30), beat('探索', 10)]],
    ['warm', [beat('推进', 5)]],
    ['bright', [beat('推进', 2)]],
  ] as const)('%s', (level, story) => {
    expect(deriveFlame([...story], now).level).toBe(level);
  });
  it('沉淀 → milestoneGold', () => {
    expect(deriveFlame([beat('沉淀', 40)], now)).toMatchObject({ level: 'ember', milestoneGold: true });
    expect(deriveFlame([beat('推进', 1)], now).milestoneGold).toBe(false);
  });
});
