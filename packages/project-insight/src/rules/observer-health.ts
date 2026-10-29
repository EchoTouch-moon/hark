import type { InsightRule, RuleDecision, RuleInput } from './types.js';
import { ISSUE_FAMILY } from './types.js';
import { candidate, durationMs, veto } from './helpers.js';
import { assertTemplateKeys } from './templates.js';

export const observerHealthRule: InsightRule = {
  id: 'R-OBSERVER-HEALTH',
  version: 1,
  issueFamily: ISSUE_FAMILY.HEALTH,
  evaluate(input: RuleInput): readonly RuleDecision[] {
    if (input.signal.kind !== 'ADAPTER_ERROR_OBSERVED' && input.signal.kind !== 'OBSERVER_HEALTH_DEGRADED') {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'KIND_MISMATCH' }];
    }
    const blocked = veto(input);
    if (blocked !== null) return [{ kind: 'NO_INSIGHT', reasonCode: blocked }];
    const streak = input.state.adapterStreak;
    const subject = input.signal.subject ?? 'observer:adapter';
    if (streak === null || streak.subject !== subject) {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'SINGLE_FAULT' }];
    }
    const lasting = durationMs(streak.firstObservedAt, input.clock.now) >= input.policy.adapterErrorDurationMs;
    const frequent = streak.count >= input.policy.adapterErrorCount;
    if (!lasting && !frequent) return [{ kind: 'NO_INSIGHT', reasonCode: 'PERSISTENCE_NOT_MET' }];
    assertTemplateKeys('observer_health_degraded', 'observer_health_degraded_detail');
    return [
      {
        kind: 'CANDIDATE',
        candidate: candidate(input, {
          ruleId: 'R-OBSERVER-HEALTH',
          ruleVersion: 1,
          issueFamily: ISSUE_FAMILY.HEALTH,
          subjectKey: subject,
          severity: 'attention',
          confidence: 'medium',
          reasonCodes: frequent ? ['adapter_error_streak'] : ['adapter_error_duration'],
          titleKey: 'observer_health_degraded',
          detailKey: 'observer_health_degraded_detail',
          templateData: { subject, count: streak.count },
        }),
      },
    ];
  },
};
