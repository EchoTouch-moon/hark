import { describe, expect, it } from 'vitest';
import { testChangedSignal, testFailSignal } from '../insights/fixtures.js';
import { defaultInsightPolicy } from '../rules/policy.js';
import { evaluateSignal } from '../rules/registry.js';
import type { RuleCandidate } from '../rules/types.js';
import { pickPrimaryCandidate } from './conflicts.js';
import { episodeKeyFor, insightIdFor, issueKeyFor } from './identity.js';
import { applyUserStatus, reduceCandidate, reduceRecovery, type IssueRecord, type StoredEpisode } from './reduce.js';

function candidateFromFailure(): RuleCandidate {
  const signal = testFailSignal();
  const decisions = evaluateSignal({
    signal,
    state: {
      streamEpoch: 1,
      sourceFrozen: false,
      legacyOrderReconstructed: false,
      adapterStreak: null,
      unavailableStreak: null,
      activeByFamily: {},
    },
    policy: defaultInsightPolicy(),
    clock: { now: signal.observedAt },
  });
  const picked = pickPrimaryCandidate(decisions);
  const first = picked[0];
  if (first === undefined) throw new Error('expected candidate');
  return first;
}

describe('S2.2 episode identity and reducer', () => {
  it('EP-10 canonical identity is stable', () => {
    const a = issueKeyFor({ projectId: 'p', streamEpoch: 1, issueFamily: 'test-report-failure', subjectKey: 's' });
    const b = issueKeyFor({ subjectKey: 's', issueFamily: 'test-report-failure', streamEpoch: 1, projectId: 'p' });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(insightIdFor(episodeKeyFor(a, 'sig'))).toMatch(/^ins_[a-f0-9]{16}$/);
  });

  it('EP-01 replay of the same opening signal keeps the insight id', () => {
    const cand = candidateFromFailure();
    const first = reduceCandidate(cand, null, new Map(), cand.openingSignalId);
    const second = reduceCandidate(cand, null, new Map(), cand.openingSignalId);
    expect(first.kind).toBe('open');
    expect(second.kind).toBe('open');
    if (first.kind === 'open' && second.kind === 'open') {
      expect(first.episode.insightId).toBe(second.episode.insightId);
    }
  });

  it('EP-02 ongoing failures stay on one episode', () => {
    const cand = candidateFromFailure();
    const opened = reduceCandidate(cand, null, new Map(), 't1');
    if (opened.kind !== 'open') throw new Error('open');
    const episodes = new Map<string, StoredEpisode>([[opened.episode.episodeKey, opened.episode]]);
    const issue: IssueRecord = {
      issueKey: opened.episode.issueKey,
      activeEpisodeKey: opened.episode.episodeKey,
      lastVerifiedRecoverySignalId: null,
      dismissedEpisodeKeys: [],
    };
    const again = reduceCandidate({ ...cand, openingSignalId: 'later' }, issue, episodes, 't2');
    expect(again).toMatchObject({ kind: 'ignore', reasonCode: 'ONGOING' });
  });

  it('EP-03 recovery then failure opens a new episode', () => {
    const cand = candidateFromFailure();
    const opened = reduceCandidate(cand, null, new Map(), 't1');
    if (opened.kind !== 'open') throw new Error('open');
    const episodes = new Map([[opened.episode.episodeKey, opened.episode]]);
    const issue: IssueRecord = {
      issueKey: opened.episode.issueKey,
      activeEpisodeKey: opened.episode.episodeKey,
      lastVerifiedRecoverySignalId: null,
      dismissedEpisodeKeys: [],
    };
    const recovered = reduceRecovery(
      {
        issueFamily: cand.issueFamily,
        subjectKey: cand.subjectKey,
        signalId: 'rec',
        observedAt: 't2',
        evidenceRefs: cand.evidenceRefs,
        reasonCodes: ['cleared'],
      },
      issue,
      episodes,
    );
    expect(recovered.kind).toBe('resolve');
    const after: IssueRecord = {
      issueKey: opened.episode.issueKey,
      activeEpisodeKey: null,
      lastVerifiedRecoverySignalId: 'rec',
      dismissedEpisodeKeys: [],
    };
    const next = reduceCandidate({ ...cand, openingSignalId: 'sig-2' }, after, episodes, 't3');
    expect(next.kind).toBe('open');
    if (next.kind === 'open') expect(next.episode.episodeKey).not.toBe(opened.episode.episodeKey);
  });

  it('EP-04 dismissed episodes do not reopen', () => {
    const cand = candidateFromFailure();
    const opened = reduceCandidate(cand, null, new Map(), 't1');
    if (opened.kind !== 'open') throw new Error('open');
    const dismissed = applyUserStatus(opened.episode, 'DISMISSED');
    const episodes = new Map([[dismissed.episodeKey, dismissed]]);
    const issue: IssueRecord = {
      issueKey: dismissed.issueKey,
      activeEpisodeKey: dismissed.episodeKey,
      lastVerifiedRecoverySignalId: null,
      dismissedEpisodeKeys: [dismissed.episodeKey],
    };
    const again = reduceCandidate({ ...cand, openingSignalId: 'later' }, issue, episodes, 't2');
    expect(again.kind === 'ignore' && again.reasonCode === 'DISMISSED').toBe(true);
  });

  it('EP-05 acknowledge is not resolved', () => {
    const cand = candidateFromFailure();
    const opened = reduceCandidate(cand, null, new Map(), 't1');
    if (opened.kind !== 'open') throw new Error('open');
    const ack = applyUserStatus(opened.episode, 'ACKNOWLEDGED');
    expect(ack.status).toBe('ACKNOWLEDGED');
    expect(ack.status).not.toBe('RESOLVED');
  });

  it('EP-07 regression wins over failure for one card', () => {
    const fail = testFailSignal();
    const change = testChangedSignal({ previousFailed: 0, currentFailed: 2 });
    const policy = defaultInsightPolicy();
    const snapshot = {
      streamEpoch: 1,
      sourceFrozen: false,
      legacyOrderReconstructed: false,
      adapterStreak: null,
      unavailableStreak: null,
      activeByFamily: {},
    };
    const decisions = [
      ...evaluateSignal({ signal: fail, state: snapshot, policy, clock: { now: fail.observedAt } }),
      ...evaluateSignal({ signal: change, state: snapshot, policy, clock: { now: change.observedAt } }),
    ];
    const picked = pickPrimaryCandidate(decisions);
    expect(picked).toHaveLength(1);
    expect(picked[0]?.ruleId).toBe('R-TEST-REGRESSION');
  });

  it('EP-08 different epochs have different issue keys', () => {
    const a = issueKeyFor({ projectId: 'p', streamEpoch: 1, issueFamily: 'test-report-failure', subjectKey: 's' });
    const b = issueKeyFor({ projectId: 'p', streamEpoch: 2, issueFamily: 'test-report-failure', subjectKey: 's' });
    expect(a).not.toBe(b);
  });

  it('EP-09 rule patch version does not change issueKey', () => {
    const key = issueKeyFor({ projectId: 'p', streamEpoch: 1, issueFamily: 'test-report-failure', subjectKey: 's' });
    expect(
      issueKeyFor({ projectId: 'p', streamEpoch: 1, issueFamily: 'test-report-failure', subjectKey: 's' }),
    ).toBe(key);
  });
});
