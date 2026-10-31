import type { NarrativeState, StoryBeat } from '@hearth/hearth-contract';

type Flame = NarrativeState['flame'];
const DAY = 86_400_000;
/** 闭区间：恰好满窗仍算窗内（≤）。 */
export const WARM_WINDOW_MS = 14 * DAY;
export const BRIGHT_WINDOW_MS = 3 * DAY;

/** 火候只由故事拍推出（不读聊天计数）。now 由调用方注入。档位优先序：bright → warm → ember → neutral；milestoneGold 独立。 */
export function deriveFlame(story: readonly StoryBeat[], now: Date): Omit<Flame, 'reason'> & { reason: string } {
  const milestoneGold = story.some((b) => b.kind === '沉淀');
  const within = (b: StoryBeat, ms: number) => now.getTime() - Date.parse(b.at) <= ms;
  if (story.length === 0) return { level: 'neutral', reason: '还没有故事，火尚未点燃。', milestoneGold };
  if (story.some((b) => b.kind === '推进' && within(b, BRIGHT_WINDOW_MS)))
    return { level: 'bright', reason: '最近推进顺畅，火势正旺。', milestoneGold };
  if (story.some((b) => (b.kind === '探索' || b.kind === '推进') && within(b, WARM_WINDOW_MS)))
    return { level: 'warm', reason: '近期仍有探索，火在燃烧。', milestoneGold };
  return { level: 'ember', reason: '动作已经停下，只剩余烬。', milestoneGold };
}
