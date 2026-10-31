import type { NarrativeState, StoryBeat } from '@hearth/hearth-contract';

type Flame = NarrativeState['flame'];
const DAY = 86_400_000;
export const WARM_WINDOW_MS = 14 * DAY;
export const BRIGHT_WINDOW_MS = 3 * DAY;

/** 火候只由故事拍推出（不读聊天计数）。纯函数，便于逐档测试。 */
export function deriveFlame(story: readonly StoryBeat[], now: Date): Omit<Flame, 'reason'> & { reason: string } {
  const milestoneGold = story.some((b) => b.kind === '沉淀');
  const within = (b: StoryBeat, ms: number) => now.getTime() - Date.parse(b.at) <= ms;
  if (story.length === 0) return { level: 'neutral', reason: '还没有故事，火未点燃。', milestoneGold };
  if (story.some((b) => b.kind === '推进' && within(b, BRIGHT_WINDOW_MS)))
    return { level: 'bright', reason: '近 3 天有推进，火正旺。', milestoneGold };
  if (story.some((b) => (b.kind === '探索' || b.kind === '推进') && within(b, WARM_WINDOW_MS)))
    return { level: 'warm', reason: '近 14 天有探索或推进，火在燃。', milestoneGold };
  return { level: 'ember', reason: '近期没有新动作，只剩余烬。', milestoneGold };
}
