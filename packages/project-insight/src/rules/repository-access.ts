import type { InsightRule, RuleDecision, RuleInput } from './types.js';
import { ISSUE_FAMILY } from './types.js';
import { candidate, durationMs, triggerRefs, veto } from './helpers.js';
import { assertTemplateKeys } from './templates.js';

export const repositoryAccessRule: InsightRule = {
  id: 'R-REPOSITORY-UNAVAILABLE',
  version: 1,
  issueFamily: ISSUE_FAMILY.REPO,
  evaluate(input: RuleInput): readonly RuleDecision[] {
    if (input.signal.kind === 'REPOSITORY_RECOVERED') {
      const blocked = veto(input);
      if (blocked !== null) return [{ kind: 'NO_INSIGHT', reasonCode: blocked }];
      return [
        {
          kind: 'RECOVERY',
          recovery: {
            issueFamily: ISSUE_FAMILY.REPO,
            subjectKey: input.signal.subject ?? 'git:repository',
            signalId: input.signal.signalKey,
            observedAt: input.signal.observedAt,
            evidenceRefs: triggerRefs(input.signal),
            reasonCodes: ['repository_recovered'],
          },
        },
      ];
    }
    if (input.signal.kind !== 'REPOSITORY_UNAVAILABLE_OBSERVED') {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'KIND_MISMATCH' }];
    }
    const blocked = veto(input);
    if (blocked !== null) return [{ kind: 'NO_INSIGHT', reasonCode: blocked }];
    const streak = input.state.unavailableStreak;
    if (streak === null) return [{ kind: 'NO_INSIGHT', reasonCode: 'SINGLE_FAULT' }];
    const lasting = durationMs(streak.firstObservedAt, input.clock.now) >= input.policy.unavailableDurationMs;
    const frequent = streak.count >= input.policy.unavailableCount;
    if (!lasting && !frequent) return [{ kind: 'NO_INSIGHT', reasonCode: 'PERSISTENCE_NOT_MET' }];
    assertTemplateKeys('repository_unavailable', 'repository_unavailable_detail');
    return [
      {
        kind: 'CANDIDATE',
        candidate: candidate(input, {
          ruleId: 'R-REPOSITORY-UNAVAILABLE',
          ruleVersion: 1,
          issueFamily: ISSUE_FAMILY.REPO,
          subjectKey: input.signal.subject ?? 'git:repository',
          severity: 'attention',
          confidence: 'medium',
          reasonCodes: frequent ? ['repo_unavailable_streak'] : ['repo_unavailable_duration'],
          titleKey: 'repository_unavailable',
          detailKey: 'repository_unavailable_detail',
          templateData: { count: streak.count },
        }),
      },
    ];
  },
};
