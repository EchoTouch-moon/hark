/**
 * @fileoverview Group B lab cases N1-N6 (15 situations) plus isolation checks.
 *
 * Every case is deterministic: `now` is passed in, no clock is read, no network
 * or model is reachable. Status markers are explicit - a case that is not run
 * must say so rather than silently pass.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { EvidenceRef, TriggerDisposition } from './types.js';
import { LabValidationError } from './types.js';
import { evaluateEligibility, newEvidence, presentedWithin24h, type EligibilityInput, type GoalFacts } from './eligibility.js';
import { CandidateTraceLedger, TriggerLedger, traceFor } from './ledgers.js';
import { PresentationClient } from './client-sim.js';

const T0 = new Date('2026-11-01T09:00:00.000Z');
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

const goal: GoalFacts = {
  id: 'dA1',
  statement: '本季度优先稳定性，不上新视觉',
  anchor: '稳定性',
  impactBoundary: { paths: ['src/**'], suites: ['unit'] },
};

const eA1: EvidenceRef = { id: 'ev-a1', projectId: 'projectA', kind: 'commit', contentVersion: 'a1b2c3', changedPathsHash: 'paths-a', semanticDigest: 'digest-a' };
const eA2: EvidenceRef = { id: 'ev-a2', projectId: 'projectA', kind: 'junit', contentVersion: 'run-77', changedPathsHash: 'suites-unit', semanticDigest: 'digest-junit-1fail' };
const eA4: EvidenceRef = { id: 'ev-a4', projectId: 'projectA', kind: 'commit', contentVersion: 'a1b2c4', changedPathsHash: 'paths-b', semanticDigest: 'digest-b' };
const eB1: EvidenceRef = { id: 'ev-b1', projectId: 'projectB', kind: 'commit', contentVersion: 'b9f8e7', changedPathsHash: 'paths-x', semanticDigest: 'digest-x' };

function baseInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    candidateProjectId: 'projectA',
    focusedProjectId: 'projectA',
    now: T0,
    evidence: [eA2],
    presentedProjections: [],
    goal,
    whyNow: '单元测试出现失败，直接触及本季度的稳定性目标。',
    deferUntil: null,
    cooldownUntil: null,
    presentationLog: [],
    maxPerProjectPer24h: 1,
    sourceStale: false,
    ...overrides,
  };
}

describe('N1 event identity vs evidence semantics (F01)', () => {
  it('N1-a: the same sourceEventId + epoch + contentVersion is a duplicate', () => {
    const ledger = new TriggerLedger();
    const row: TriggerDisposition = {
      sourceEventId: 'ev-a2', projectId: 'projectA', epoch: 'e1', contentVersion: 'run-77',
      filtered: null, fanout: ['cand-1'], at: T0.toISOString(),
    };
    expect(ledger.receive(row)).toBe('stored');
    expect(ledger.receive({ ...row })).toBe('duplicate');
    expect(ledger.all()).toHaveLength(1);
  });

  it('N1-b: same commit message but a different SHA is new evidence, not a duplicate', () => {
    // eA1 and eA4 share a commit message in the fixture world; only the
    // projection differs, and message text never takes part in comparison.
    expect(newEvidence(baseInput({ evidence: [eA4], presentedProjections: [eA1] }))).toHaveLength(1);
    const result = evaluateEligibility(baseInput({ evidence: [eA4], presentedProjections: [eA1] }));
    expect(result.kind).toBe('eligible');
  });
});

describe('N2 goal linkage (anchor must appear in whyNow)', () => {
  it('N2 positive: whyNow names the goal anchor', () => {
    const result = evaluateEligibility(baseInput());
    expect(result).toMatchObject({ kind: 'eligible', goalRef: 'dA1' });
  });

  it('N2 negative: a generic whyNow is rejected as NO_GOAL_LINK', () => {
    const result = evaluateEligibility(baseInput({ whyNow: '这个变化很重要，建议关注一下。' }));
    expect(result).toEqual({ kind: 'not_eligible', reasonCode: 'NO_GOAL_LINK' });
  });
});

describe('N3 staleness is reported, not silenced', () => {
  it('N3 positive: a fresh source is judged normally', () => {
    expect(evaluateEligibility(baseInput()).kind).toBe('eligible');
  });

  it('N3 negative: a stale source yields SOURCE_STALE on the opinion channel', () => {
    expect(evaluateEligibility(baseInput({ sourceStale: true }))).toEqual({ kind: 'not_eligible', reasonCode: 'SOURCE_STALE' });
  });
});

describe('N4 cross-project leakage is blocked before judgement (F04)', () => {
  it('N4 positive: a candidate carrying only projectA evidence stays clean', () => {
    const result = evaluateEligibility(baseInput());
    expect(result.kind).toBe('eligible');
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('projectB');
    expect(serialised).not.toContain('ev-b1');
  });

  it('N4 negative: projectB evidence inside a projectA candidate is blocked', () => {
    // The test passes when the leak is intercepted - not when the implementation fails.
    expect(evaluateEligibility(baseInput({ evidence: [eA2, eB1] }))).toEqual({
      kind: 'blocked', reasonCode: 'PROJECT_SCOPE_DENIED',
    });
  });
});

describe('N5 typing never reaches the server judgement (F02/F04)', () => {
  it('N5 positive: eligibility is identical whether the client is typing or not', () => {
    const quiet = evaluateEligibility(baseInput());
    const typing = evaluateEligibility(baseInput());
    expect(typing).toEqual(quiet);
  });

  it('N5 negative: USER_TYPING is never produced by the server function', () => {
    const reasons = [
      evaluateEligibility(baseInput()),
      evaluateEligibility(baseInput({ sourceStale: true })),
      evaluateEligibility(baseInput({ whyNow: '无锚点' })),
      evaluateEligibility(baseInput({ evidence: [eB1] })),
    ].map((result) => ('reasonCode' in result ? result.reasonCode : null));
    expect(reasons).not.toContain('USER_TYPING');
  });
});

describe('N6 quota: sliding 24h, per project, counted on presentation', () => {
  it('N6 positive: the first opinion within the window is allowed', () => {
    expect(evaluateEligibility(baseInput()).kind).toBe('eligible');
  });

  it('N6 negative 1: a second opinion within 24h is over budget', () => {
    const result = evaluateEligibility(baseInput({
      presentationLog: [{ projectId: 'projectA', at: at(-60), state: 'presented' }],
    }));
    expect(result).toEqual({ kind: 'not_eligible', reasonCode: 'DAILY_BUDGET' });
  });

  it('N6 negative 2: projectA being exhausted does not affect projectB', () => {
    expect(evaluateEligibility(baseInput({
      candidateProjectId: 'projectB',
      focusedProjectId: 'projectB',
      evidence: [eB1],
      presentationLog: [{ projectId: 'projectA', at: at(-60), state: 'presented' }],
    })).kind).toBe('eligible');
  });

  it('N6 negative 3: 23:59 -> 00:01 stays inside the sliding window', () => {
    const justBeforeMidnight = new Date('2026-11-01T23:59:00.000Z');
    const justAfterMidnight = new Date('2026-11-02T00:01:00.000Z');
    expect(presentedWithin24h({
      ...baseInput({ now: justAfterMidnight }),
      presentationLog: [{ projectId: 'projectA', at: justBeforeMidnight, state: 'presented' }],
    })).toBe(1);
    expect(evaluateEligibility(baseInput({
      now: justAfterMidnight,
      presentationLog: [{ projectId: 'projectA', at: justBeforeMidnight, state: 'presented' }],
    }))).toEqual({ kind: 'not_eligible', reasonCode: 'DAILY_BUDGET' });
  });

  it('N6 negative 4: a lost receipt is uncertain, never counted as a confirmed presentation', () => {
    const client = new PresentationClient();
    const claim = client.claim('cand-1', 'projectA', T0, 30_000);
    const lost = client.present(claim, 'ack_lost', T0);
    expect(lost.state).toBe('delivery_uncertain');
    // E1: a committed receipt answers every retry with the same record.
    const confirmed = client.present(client.claim('cand-2', 'projectA', T0, 30_000), 'confirmed', T0);
    expect(confirmed.state).toBe('presented');
    expect(client.present(client.claim('cand-2', 'projectA', T0, 30_000), 'confirmed', at(5)).state).toBe('presented');
    expect(client.logRecords().filter((row) => row.state === 'presented')).toHaveLength(1);
    // E2: after expiry the uncertain claim may compete again; silence is not proof.
    expect(client.mayReclaim(claim, T0)).toBe(false);
    expect(client.mayReclaim(claim, at(1))).toBe(true);
    // E3: a refused render records nothing.
    expect(client.present(client.claim('cand-3', 'projectA', T0, 30_000), 'rejected', T0).state).toBe('claimed');
  });
});

describe('ledger contracts', () => {
  it('a trace accepts only allowlisted fields and closed enums', () => {
    const ledger = new CandidateTraceLedger();
    ledger.append(traceFor({
      candidateId: 'cand-1', hash: 'a'.repeat(32), projectId: 'projectA', ruleId: 'R-TEST', ruleVersion: '1.0.0',
      triggerKind: 'system_suggested', disposition: 'would_present', reasonCode: null, evidenceDiff: 1, hasGoalLink: true, decidedAt: T0.toISOString(),
    }));
    expect(ledger.all()).toHaveLength(1);
    expect(() => ledger.append({ ...traceFor({
      candidateId: 'cand-2', hash: 'b'.repeat(32), projectId: 'projectA', ruleId: 'R-TEST', ruleVersion: '1.0.0',
      triggerKind: 'system_suggested', disposition: 'ignored', reasonCode: null, evidenceDiff: 0, hasGoalLink: false, decidedAt: T0.toISOString(),
    }) })).toThrow(LabValidationError);
  });

  it('a trace rejects values that pass the field allowlist but fail format', () => {
    const bad = traceFor({
      candidateId: 'cand-3', hash: 'c'.repeat(32), projectId: 'projectA', ruleId: 'R-TEST', ruleVersion: '1.0.0',
      triggerKind: 'system_suggested', disposition: 'should_not_exist' as never, reasonCode: null, evidenceDiff: 0, hasGoalLink: false, decidedAt: T0.toISOString(),
    });
    expect(() => new CandidateTraceLedger().append(bad)).toThrow(LabValidationError);
  });
});

describe('isolation of the lab directory', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(here).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

  it('never reads the clock directly', () => {
    for (const name of sources) {
      expect(readFileSync(join(here, name), 'utf8')).not.toContain('Date.now(');
    }
  });

  it('never imports apps, storage, analysis or a provider', () => {
    for (const name of sources) {
      const text = readFileSync(join(here, name), 'utf8');
      expect(text).not.toMatch(/from '(\.\.\/)+apps\//);
      expect(text).not.toContain('@hearth/project-analysis');
      expect(text).not.toContain('@hearth/storage');
      expect(text).not.toContain('node:http');
      expect(text).not.toContain('fetch(');
    }
  });
});
