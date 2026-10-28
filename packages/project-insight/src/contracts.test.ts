import { describe, expect, it } from 'vitest';
import { insightDedupKey } from './canonical.js';
import {
  DEFAULT_RULE_POLICY,
  EvaluationResultSchema,
  EvidenceRefSchema,
  InsightCandidateSchema,
  InsightSchema,
  SignalSchema,
  mapP0EvidenceQuality,
  reportSourceSubjectKey,
} from './contracts.js';

const NOW = '2026-10-28T10:00:00.000Z';

const trigger = EvidenceRefSchema.parse({
  kind: 'observer_event',
  projectId: 'prj_aaaaaaaaaaaaaaaa',
  id: 'evt_aaaaaaaaaaaaaaaa',
  observedAt: NOW,
  quality: 'OBSERVED',
  role: 'trigger',
});

describe('P1 frozen contracts', () => {
  it('parses Signal / Candidate / Insight / EvidenceRef', () => {
    const signal = SignalSchema.parse({
      signalKey: 'a'.repeat(64),
      projectId: 'prj_aaaaaaaaaaaaaaaa',
      kind: 'TEST_REPORT_FAILURE_OBSERVED',
      observedAt: NOW,
      sourceEventIds: ['evt_aaaaaaaaaaaaaaaa'],
      evidenceQuality: 'OBSERVED',
      comparable: false,
      headBinding: 'UNDETERMINED',
      facts: { relativePath: 'reports/junit.xml', failed: 1 },
    });
    expect(signal.headBinding).toBe('UNDETERMINED');

    const candidate = InsightCandidateSchema.parse({
      ruleId: 'R-TEST-FAILURE',
      ruleVersion: 1,
      projectId: 'prj_aaaaaaaaaaaaaaaa',
      subjectKey: reportSourceSubjectKey('reports/junit.xml'),
      episodeKey: 'ep_1',
      evidenceRefs: [trigger],
      severity: 'attention',
      confidence: 'medium',
      titleKey: 'test_failure_observed',
      detailKey: 'test_failure_observed_detail',
      templateData: { failed: 1, headBinding: 'UNDETERMINED' },
      reasonCodes: ['junit_failures_gt_0'],
      headBinding: 'UNDETERMINED',
    });
    expect(candidate.evidenceRefs[0]?.role).toBe('trigger');
    expect(candidate.subjectKey).toBe('reportSource:reports/junit.xml');

    const noInsight = EvaluationResultSchema.parse({ kind: 'NO_INSIGHT', reasonCode: 'HEAD_ONLY' });
    expect(noInsight.kind).toBe('NO_INSIGHT');

    const insight = InsightSchema.parse({
      id: 'ins_aaaaaaaaaaaaaaaa',
      projectId: candidate.projectId,
      ruleId: candidate.ruleId,
      ruleVersion: candidate.ruleVersion,
      dedupKey: insightDedupKey({
        projectId: candidate.projectId,
        ruleId: candidate.ruleId,
        ruleMajorVersion: 1,
        subjectKey: candidate.subjectKey,
        episodeKey: candidate.episodeKey,
      }),
      episodeKey: candidate.episodeKey,
      status: 'OPEN',
      severity: candidate.severity,
      confidence: candidate.confidence,
      titleKey: candidate.titleKey,
      detailKey: candidate.detailKey,
      templateData: candidate.templateData,
      firstObservedAt: NOW,
      lastMaterialObservedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      evidenceRefs: candidate.evidenceRefs,
      reasonCodes: candidate.reasonCodes,
      historical: false,
      headBinding: 'UNDETERMINED',
      evidenceAvailability: 'AVAILABLE',
    });
    expect(insight.dedupKey).toHaveLength(64);
  });

  it('rejects a candidate without trigger evidence', () => {
    const parsed = InsightCandidateSchema.safeParse({
      ruleId: 'R-TEST-FAILURE',
      ruleVersion: 1,
      projectId: 'prj_aaaaaaaaaaaaaaaa',
      subjectKey: 'x',
      episodeKey: 'ep',
      evidenceRefs: [{ ...trigger, role: 'context' }],
      severity: 'info',
      confidence: 'low',
      titleKey: 't',
      detailKey: 'd',
      templateData: {},
      reasonCodes: [],
      headBinding: 'UNDETERMINED',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown keys on frozen objects', () => {
    const parsed = SignalSchema.safeParse({
      signalKey: 'a'.repeat(64),
      projectId: 'prj_aaaaaaaaaaaaaaaa',
      kind: 'TEST_REPORT_FAILURE_OBSERVED',
      observedAt: NOW,
      sourceEventIds: ['evt_aaaaaaaaaaaaaaaa'],
      evidenceQuality: 'OBSERVED',
      comparable: false,
      headBinding: 'UNDETERMINED',
      facts: {},
      inventedField: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('dedupKey is stable under key insertion order', () => {
    const a = insightDedupKey({
      projectId: 'prj_1',
      ruleId: 'R-TEST-FAILURE',
      ruleMajorVersion: 1,
      subjectKey: 'rpt:a',
      episodeKey: 'ep1',
    });
    const b = insightDedupKey({
      episodeKey: 'ep1',
      subjectKey: 'rpt:a',
      ruleMajorVersion: 1,
      ruleId: 'R-TEST-FAILURE',
      projectId: 'prj_1',
    });
    expect(a).toBe(b);
  });

  it('maps P0 quality without inventing HEAD binding', () => {
    expect(mapP0EvidenceQuality('STALE', 'OK')).toBe('STALE');
    expect(mapP0EvidenceQuality('OBSERVED', 'UNAVAILABLE')).toBe('UNAVAILABLE');
    expect(DEFAULT_RULE_POLICY['R-TEST-EVIDENCE-GAP'].enabled).toBe(false);
    expect(reportSourceSubjectKey('reports\\junit.xml')).toBe('reportSource:reports/junit.xml');
  });
});
