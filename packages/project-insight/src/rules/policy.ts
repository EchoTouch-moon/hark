import { DEFAULT_RULE_POLICY } from '../contracts.js';
import type { InsightPolicy } from './types.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export function defaultInsightPolicy(): InsightPolicy {
  const enabled = new Set<string>();
  for (const [ruleId, spec] of Object.entries(DEFAULT_RULE_POLICY)) {
    if (spec.enabled) enabled.add(ruleId);
  }
  return {
    enabledRuleIds: enabled,
    adapterErrorCount: 3,
    adapterErrorDurationMs: FIFTEEN_MINUTES_MS,
    unavailableCount: 3,
    unavailableDurationMs: FIFTEEN_MINUTES_MS,
  };
}

export function isRuleEnabled(policy: InsightPolicy, ruleId: string): boolean {
  return policy.enabledRuleIds.has(ruleId);
}
