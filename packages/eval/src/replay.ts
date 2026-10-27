import type { Event } from '@hearth/contracts';

/**
 * 评测回放：在合成事件流上以确定性的方式重放 ingest 与排序评分。
 */

export interface DuplicateOutcome {
  /** 被拒绝的事件 id（重复投递的那一条）。 */
  id: string;
  /** 命中的重复 dedupeKey。 */
  dedupeKey: string;
}

export interface ReplayIngestResult {
  accepted: Event[];
  duplicates: DuplicateOutcome[];
}

/**
 * 按 dedupeKey 去重，先到先得：首个事件被接受，后续相同 key 的进 duplicates。
 * `dedupe` 是跨批次共享的去重状态（默认新建一个 Set）。
 */
export function replayIngest(
  events: readonly Event[],
  dedupe: Set<string> = new Set(),
): ReplayIngestResult {
  const accepted: Event[] = [];
  const duplicates: DuplicateOutcome[] = [];
  for (const event of events) {
    if (dedupe.has(event.dedupeKey)) {
      duplicates.push({ id: event.id, dedupeKey: event.dedupeKey });
      continue;
    }
    dedupe.add(event.dedupeKey);
    accepted.push(event);
  }
  return { accepted, duplicates };
}

export interface ScoredCandidateInput {
  score: number;
  eventIds: readonly string[];
}

export interface ReplayScoringResult {
  /** top3 中 goldenUseful 候选的占比（分母 min(3, 总数)）；空输入为 null。 */
  precisionAt3: number | null;
  /** 参与评分的候选总数。 */
  total: number;
  /** top3 中命中 goldenUseful 的候选数。 */
  usefulInTop3: number;
}

/**
 * candidates 按 score 降序取前 3，统计其中命中 golden 集的占比。
 * 候选命中 = 其 eventIds 中任一 id 属于 goldenUseful 事件 id 集合。
 */
export function replayScoring(
  candidates: readonly ScoredCandidateInput[],
  golden: ReadonlySet<string>,
): ReplayScoringResult {
  const total = candidates.length;
  if (total === 0) {
    return { precisionAt3: null, total: 0, usefulInTop3: 0 };
  }
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, Math.min(3, total));
  const usefulInTop3 = top3.filter((candidate) =>
    candidate.eventIds.some((eventId) => golden.has(eventId)),
  ).length;
  const denominator = Math.min(3, total);
  return { precisionAt3: usefulInTop3 / denominator, total, usefulInTop3 };
}
