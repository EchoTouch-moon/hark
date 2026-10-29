import type { InsightRule, RuleDecision, RuleInput } from './types.js';
import { ISSUE_FAMILY } from './types.js';

/** Present in the registry so disablement is explicit. Never emits a candidate. */
export const testEvidenceGapRule: InsightRule = {
  id: 'R-TEST-EVIDENCE-GAP',
  version: 1,
  issueFamily: ISSUE_FAMILY.TEST,
  evaluate(_input: RuleInput): readonly RuleDecision[] {
    return [{ kind: 'NO_INSIGHT', reasonCode: 'RULE_DISABLED' }];
  },
};
