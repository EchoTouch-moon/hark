/**
 * @fileoverview 候选排序与低质量过滤评分引擎（Candidate Ranking & Scoring）
 * 实现确定性、可重放的排序逻辑（M2-T01）。
 * 保证评测套件在黄金数据集（Golden Fixture）上每次重放结果 100% 一致。
 */

import type { Candidate } from '@hearth/contracts';

/**
 * 确定性排序候选建议
 * 排序优先级：
 * 1. 分数降序（score desc）
 * 2. 较早观察到的证据优先（earliest observedAt，先来者更稳定）
 * 3. 候选 ID 字典序升序（id asc，确保全序一致）
 * 
 * 纯函数且具备完全确定性，可复现评测基准。
 */
export function rankCandidates<T extends Pick<Candidate, 'score' | 'id'> & { observedAt?: string }>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ao = a.observedAt ?? '';
    const bo = b.observedAt ?? '';
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

/** 候选质量门禁底线：综合得分低于 0.45 的建议直接被归类为低质量抑制 */
export const MIN_CANDIDATE_SCORE = 0.45;

/**
 * 过滤低质量候选建议
 * @param candidates 候选列表
 * @returns 分离后的保留列表（kept）与抑制列表（suppressed）
 */
export function suppressLowQuality<T extends Pick<Candidate, 'score'>>(candidates: readonly T[]): {
  kept: T[];
  suppressed: T[];
} {
  const kept: T[] = [];
  const suppressed: T[] = [];
  for (const c of candidates) {
    (c.score >= MIN_CANDIDATE_SCORE ? kept : suppressed).push(c);
  }
  return { kept, suppressed };
}

// Verification probe: a comment-only change must still be classified as code, not documentation.
