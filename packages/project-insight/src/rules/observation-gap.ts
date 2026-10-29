import type { InsightRule, RuleDecision, RuleInput } from './types.js';
import { ISSUE_FAMILY } from './types.js';
import { asNumber, candidate, veto } from './helpers.js';
import { assertTemplateKeys } from './templates.js';

export const observationGapRule: InsightRule = {
  id: 'R-OBSERVATION-GAP',
  version: 1,
  issueFamily: ISSUE_FAMILY.GAP,
  evaluate(input: RuleInput): readonly RuleDecision[] {
    if (input.signal.kind !== 'OBSERVATION_GAP_DETECTED') {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'KIND_MISMATCH' }];
    }
    const blocked = veto(input);
    if (blocked !== null) return [{ kind: 'NO_INSIGHT', reasonCode: blocked }];
    if (input.signal.evidenceQuality !== 'OBSERVED') {
      return [{ kind: 'NO_INSIGHT', reasonCode: 'QUALITY_NOT_OBSERVED' }];
    }
    const gapMs = asNumber(input.signal.facts['gapMs']);
    if (gapMs === undefined) return [{ kind: 'NO_INSIGHT', reasonCode: 'INSUFFICIENT_EVIDENCE' }];
    assertTemplateKeys('observation_gap_detected', 'observation_gap_detected_detail');
    return [
      {
        kind: 'CANDIDATE',
        candidate: candidate(input, {
          ruleId: 'R-OBSERVATION-GAP',
          ruleVersion: 1,
          issueFamily: ISSUE_FAMILY.GAP,
          subjectKey: input.signal.subject ?? 'observer:gap',
          severity: 'info',
          confidence: 'high',
          reasonCodes: ['observation_gap_event'],
          titleKey: 'observation_gap_detected',
          detailKey: 'observation_gap_detected_detail',
          templateData: { gapMs },
        }),
      },
    ];
  },
};
