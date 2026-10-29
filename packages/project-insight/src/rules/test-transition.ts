import type { InsightRule, RuleDecision, RuleInput } from './types.js';
import { ISSUE_FAMILY } from './types.js';
import { asNumber, candidate, relativePathOf, triggerRefs, veto } from './helpers.js';
import { assertTemplateKeys } from './templates.js';

export const testTransitionRule: InsightRule = {
  id: 'R-TEST-REGRESSION',
  version: 1,
  issueFamily: ISSUE_FAMILY.TEST,
  evaluate(input: RuleInput): readonly RuleDecision[] {
    if (input.signal.kind !== 'TEST_REPORT_RESULT_CHANGED') {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'KIND_MISMATCH' }];
    }
    const blocked = veto(input);
    if (blocked !== null) return [{ kind: 'NO_INSIGHT', reasonCode: blocked }];
    if (input.state.legacyOrderReconstructed) {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'LEGACY_ORDER_UNRELIABLE' }];
    }
    if (input.signal.evidenceQuality !== 'OBSERVED') {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'QUALITY_NOT_OBSERVED' }];
    }
    if (input.signal.comparable !== true) {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'NOT_COMPARABLE' }];
    }
    const relativePath = relativePathOf(input.signal);
    if (relativePath === undefined) return [{ kind: 'NO_INSIGHT', reasonCode: 'MISSING_REPORT_PATH' }];
    const previousFailed = asNumber(input.signal.facts['previousFailed']);
    const currentFailed = asNumber(input.signal.facts['currentFailed']);
    if (previousFailed === undefined || currentFailed === undefined) {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'INSUFFICIENT_EVIDENCE' }];
    }
    if (previousFailed > 0 && currentFailed === 0) {
      return [
        {
          kind: 'RECOVERY',
          recovery: {
            issueFamily: ISSUE_FAMILY.TEST,
            subjectKey: input.signal.subject ?? `reportSource:${relativePath}`,
            signalId: input.signal.signalKey,
            observedAt: input.signal.observedAt,
            evidenceRefs: triggerRefs(input.signal),
            reasonCodes: ['junit_failures_cleared'],
          },
        },
      ];
    }
    if (!(previousFailed === 0 && currentFailed > 0)) {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'NOT_ZERO_TO_FAIL' }];
    }
    assertTemplateKeys('test_result_changed', 'test_result_changed_detail');
    return [
      {
        kind: 'CANDIDATE',
        candidate: candidate(input, {
          ruleId: 'R-TEST-REGRESSION',
          ruleVersion: 1,
          issueFamily: ISSUE_FAMILY.TEST,
          subjectKey: input.signal.subject ?? `reportSource:${relativePath}`,
          severity: 'important',
          confidence: 'medium',
          reasonCodes: ['junit_zero_to_fail'],
          titleKey: 'test_result_changed',
          detailKey: 'test_result_changed_detail',
          templateData: {
            relativePath,
            previousFailed,
            currentFailed,
            headBinding: 'UNDETERMINED',
          },
        }),
      },
    ];
  },
};
