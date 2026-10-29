import type { RuleCandidate, RuleDecision } from '../rules/types.js';
import { ISSUE_FAMILY } from '../rules/types.js';

const RULE_RANK: Record<string, number> = {
  'R-TEST-REGRESSION': 2,
  'R-TEST-FAILURE': 1,
};

export function pickPrimaryCandidate(decisions: readonly RuleDecision[]): RuleCandidate[] {
  const candidates = decisions.filter((item) => item.kind === 'CANDIDATE').map((item) => item.candidate);
  const grouped = new Map<string, RuleCandidate[]>();
  for (const item of candidates) {
    const key = `${item.issueFamily}:${item.subjectKey}`;
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }
  const picked: RuleCandidate[] = [];
  for (const group of grouped.values()) {
    const sorted = [...group].sort((a, b) => (RULE_RANK[b.ruleId] ?? 0) - (RULE_RANK[a.ruleId] ?? 0));
    const winner = sorted[0];
    if (winner !== undefined) picked.push(winner);
  }
  return picked;
}

export function suppressHealthIfRepoActive(
  candidates: RuleCandidate[],
  repoActive: boolean,
): RuleCandidate[] {
  if (!repoActive) return candidates;
  return candidates.filter((item) => item.issueFamily !== ISSUE_FAMILY.HEALTH);
}
