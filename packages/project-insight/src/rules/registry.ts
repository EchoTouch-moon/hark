/**
 * @fileoverview 洞察规则注册表与信号评估分发中心
 *
 * 按固定顺序分发已注册规则；禁用的 R-TEST-EVIDENCE-GAP 仍记录 RULE_DISABLED，避免静默打开。
 */

import { testEvidenceGapRule } from './evidence-gap.js';
import { observationGapRule } from './observation-gap.js';
import { observerHealthRule } from './observer-health.js';
import { isRuleEnabled } from './policy.js';
import { repositoryAccessRule } from './repository-access.js';
import { testFailureRule } from './test-failure.js';
import { testTransitionRule } from './test-transition.js';
import type { InsightRule, RuleDecision, RuleInput } from './types.js';

const RULES: readonly InsightRule[] = [
  testTransitionRule,
  testFailureRule,
  testEvidenceGapRule,
  observationGapRule,
  observerHealthRule,
  repositoryAccessRule,
];

export function listedRules(): readonly InsightRule[] {
  return RULES;
}

export function evaluateSignal(input: RuleInput): RuleDecision[] {
  const out: RuleDecision[] = [];
  for (const rule of RULES) {
    if (!isRuleEnabled(input.policy, rule.id)) {
      if (rule.id === 'R-TEST-EVIDENCE-GAP') {
        out.push({ kind: 'NO_INSIGHT', reasonCode: 'RULE_DISABLED' });
      }
      continue;
    }
    out.push(...rule.evaluate(input));
  }
  return out;
}
