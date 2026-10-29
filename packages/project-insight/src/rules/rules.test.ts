import { describe, expect, it } from 'vitest';
import { makeSignal, testChangedSignal, testFailSignal } from '../insights/fixtures.js';
import { defaultInsightPolicy } from './policy.js';
import { evaluateSignal } from './registry.js';
import { renderDetail, sanitizeTemplateData } from './templates.js';
import type { RuleInput, RuleStateSnapshot } from './types.js';

const NOW = '2026-10-28T10:00:00.000Z';

function state(overrides: Partial<RuleStateSnapshot> = {}): RuleStateSnapshot {
  return {
    streamEpoch: 1,
    sourceFrozen: false,
    legacyOrderReconstructed: false,
    adapterStreak: null,
    unavailableStreak: null,
    activeByFamily: {},
    ...overrides,
  };
}

function input(signal: ReturnType<typeof makeSignal>, snapshot?: Partial<RuleStateSnapshot>): RuleInput {
  return { signal, state: state(snapshot), policy: defaultInsightPolicy(), clock: { now: NOW } };
}

function kinds(decisions: ReturnType<typeof evaluateSignal>): string[] {
  return decisions.filter((item) => item.kind === 'CANDIDATE').map((item) => item.candidate.ruleId);
}

describe('S2.1 rules RU-01..12', () => {
  it('RU-01 git noise is NO_INSIGHT', () => {
    for (const kind of ['REPOSITORY_HEAD_CHANGED', 'REPOSITORY_BRANCH_CHANGED', 'WORKTREE_STATE_CHANGED'] as const) {
      const decisions = evaluateSignal(input(makeSignal({ kind, signalKey: 'd'.repeat(64), subject: 'git:head' })));
      expect(kinds(decisions)).toEqual([]);
    }
  });

  it('RU-02 observed JUnit failures produce a candidate', () => {
    const decisions = evaluateSignal(input(testFailSignal()));
    expect(kinds(decisions)).toContain('R-TEST-FAILURE');
    const cand = decisions.find((item) => item.kind === 'CANDIDATE' && item.candidate.ruleId === 'R-TEST-FAILURE');
    expect(cand?.kind === 'CANDIDATE' && cand.candidate.headBinding).toBe('UNDETERMINED');
  });

  it('RU-03 UNKNOWN/STALE reports do not publish test failure', () => {
    const unknown = testFailSignal();
    unknown.evidenceQuality = 'UNKNOWN';
    const stale = testFailSignal();
    stale.evidenceQuality = 'STALE';
    expect(kinds(evaluateSignal(input(unknown)))).not.toContain('R-TEST-FAILURE');
    expect(kinds(evaluateSignal(input(stale)))).not.toContain('R-TEST-FAILURE');
  });

  it('RU-04 comparable 0→fail uses result-changed copy, not HEAD regression', () => {
    const decisions = evaluateSignal(input(testChangedSignal({ previousFailed: 0, currentFailed: 2 })));
    expect(kinds(decisions)).toContain('R-TEST-REGRESSION');
    const cand = decisions.find((item) => item.kind === 'CANDIDATE' && item.candidate.ruleId === 'R-TEST-REGRESSION');
    if (cand?.kind !== 'CANDIDATE') throw new Error('missing candidate');
    const detail = renderDetail(cand.candidate.detailKey, cand.candidate.templateData);
    expect(detail.toLowerCase().includes('regression')).toBe(false);
    expect(detail.startsWith('Same report path')).toBe(true);
  });

  it('RU-05 different paths are not a result transition', () => {
    const signal = testChangedSignal({ previousFailed: 0, currentFailed: 2, comparable: false });
    expect(kinds(evaluateSignal(input(signal)))).not.toContain('R-TEST-REGRESSION');
  });

  it('RU-06 UNDETERMINED never claims current HEAD', () => {
    const decisions = evaluateSignal(input(testFailSignal()));
    const cand = decisions.find((item) => item.kind === 'CANDIDATE');
    if (cand?.kind !== 'CANDIDATE') throw new Error('missing');
    expect(cand.candidate.headBinding).toBe('UNDETERMINED');
    expect(JSON.stringify(cand.candidate.templateData).includes('BOUND_TO_HEAD')).toBe(false);
  });

  it('RU-07 R-TEST-EVIDENCE-GAP stays disabled', () => {
    const decisions = evaluateSignal(input(testFailSignal()));
    expect(decisions.some((item) => item.kind === 'NO_INSIGHT' && item.reasonCode === 'RULE_DISABLED')).toBe(true);
    expect(kinds(decisions)).not.toContain('R-TEST-EVIDENCE-GAP');
  });

  it('RU-08 observation gap needs the source event', () => {
    const gap = makeSignal({
      kind: 'OBSERVATION_GAP_DETECTED',
      signalKey: 'e'.repeat(64),
      subject: 'observer:gap',
      facts: { gapMs: 4000 },
    });
    expect(kinds(evaluateSignal(input(gap)))).toContain('R-OBSERVATION-GAP');
    const empty = makeSignal({
      kind: 'OBSERVATION_GAP_DETECTED',
      signalKey: 'f'.repeat(64),
      subject: 'observer:gap',
      facts: {},
    });
    expect(kinds(evaluateSignal(input(empty)))).not.toContain('R-OBSERVATION-GAP');
  });

  it('RU-09 single adapter error is NO_INSIGHT', () => {
    const signal = makeSignal({
      kind: 'ADAPTER_ERROR_OBSERVED',
      signalKey: 'g'.repeat(64),
      subject: 'observer:adapter',
    });
    expect(kinds(evaluateSignal(input(signal)))).toEqual([]);
  });

  it('RU-10 streak threshold emits health', () => {
    const signal = makeSignal({
      kind: 'ADAPTER_ERROR_OBSERVED',
      signalKey: 'h'.repeat(64),
      subject: 'observer:adapter',
    });
    const decisions = evaluateSignal(
      input(signal, {
        adapterStreak: { subject: 'observer:adapter', count: 3, firstObservedAt: NOW, lastObservedAt: NOW },
      }),
    );
    expect(kinds(decisions)).toContain('R-OBSERVER-HEALTH');
  });

  it('RU-11 missing trigger or frozen source is vetoed', () => {
    const signal = testFailSignal();
    signal.evidenceRefs = [];
    expect(evaluateSignal(input(signal)).some((item) => item.kind === 'NO_INSIGHT' && item.reasonCode === 'MISSING_TRIGGER')).toBe(true);
    expect(
      evaluateSignal(input(testFailSignal(), { sourceFrozen: true })).some(
        (item) => item.kind === 'NO_INSIGHT' && item.reasonCode === 'SOURCE_FROZEN',
      ),
    ).toBe(true);
  });

  it('PF-02 sanitizes home paths and truncates', () => {
    const data = sanitizeTemplateData({ p: '/Users/v/secret/report.xml', long: 'x'.repeat(500) });
    expect(String(data['p']).startsWith('[path]')).toBe(true);
    expect(String(data['long']).length).toBe(200);
  });

  it('RU-12 legacy reconstructed order cannot drive result transitions', () => {
    const signal = testChangedSignal({ previousFailed: 0, currentFailed: 2 });
    const decisions = evaluateSignal(input(signal, { legacyOrderReconstructed: true }));
    expect(kinds(decisions)).not.toContain('R-TEST-REGRESSION');
  });
});
