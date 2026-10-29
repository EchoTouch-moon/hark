import type { InsightRule, RuleDecision, RuleInput } from './types.js';
import { ISSUE_FAMILY } from './types.js';
import { asNumber, candidate, relativePathOf, veto } from './helpers.js';
import { assertTemplateKeys } from './templates.js';

export const testFailureRule: InsightRule = {
  id: 'R-TEST-FAILURE',
  version: 1,
  issueFamily: ISSUE_FAMILY.TEST,
  evaluate(input: RuleInput): readonly RuleDecision[] {
    if (input.signal.kind !== 'TEST_REPORT_FAILURE_OBSERVED') {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'KIND_MISMATCH' }];
    }
    const blocked = veto(input);
    if (blocked !== null) return [{ kind: 'NO_INSIGHT', reasonCode: blocked }];
    if (input.signal.evidenceQuality !== 'OBSERVED') {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'QUALITY_NOT_OBSERVED' }];
    }
    const relativePath = relativePathOf(input.signal);
    if (relativePath === undefined || relativePath.length === 0) {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'MISSING_REPORT_PATH' }];
    }
    const failed = asNumber(input.signal.facts['failed']) ?? 0;
    const errors = asNumber(input.signal.facts['errors']) ?? 0;
    if (failed + errors <= 0) return [{ kind: 'NO_INSIGHT', reasonCode: 'NO_FAILURES' }];
    assertTemplateKeys('test_failure_observed', 'test_failure_observed_detail');
    return [
      {
        kind: 'CANDIDATE',
        candidate: candidate(input, {
          ruleId: 'R-TEST-FAILURE',
          ruleVersion: 1,
          issueFamily: ISSUE_FAMILY.TEST,
          subjectKey: input.signal.subject ?? `reportSource:${relativePath}`,
          severity: 'attention',
          confidence: 'medium',
          reasonCodes: ['junit_failures_gt_0'],
          titleKey: 'test_failure_observed',
          detailKey: 'test_failure_observed_detail',
          templateData: { relativePath, failed, errors, headBinding: 'UNDETERMINED' },
        }),
      },
    ];
  },
};
