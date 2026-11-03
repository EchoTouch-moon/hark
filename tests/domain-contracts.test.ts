import { describe, expect, it } from 'vitest';
import {
  EvidenceRef, Feedback, GroundedFact, OpinionBundle, OpinionRevision,
  Project, ProposedPlan, RevisionPair,
} from '../src/domain-contracts.js';

// All values below are synthetic; no user projects or real sources are read.
const time = '2026-11-03T12:00:00.000Z';
const later = '2026-11-04T12:00:00.000Z';
const hash = 'a'.repeat(64);
const project = { id: 'project-a', name: 'Synthetic A', description: 'A test project', state: 'active', createdAt: time };
const observer = { kind: 'observer', projectId: 'project-a', observerSourceId: 'source-a', epoch: 1, eventId: 'event-a', observedAt: time, quality: 'observed' };
const research = { kind: 'research', projectId: 'project-a', researchSourceId: 'paper-a', accessedAt: time, contentHash: hash, availability: 'available' };
const decision = { kind: 'decision', projectId: 'project-a', decisionId: 'decision-a', revision: 1, recordedAt: time, status: 'active' };
const facts = [
  { statement: 'A synthetic file was observed', subject: 'project', source: observer },
  { statement: 'A public source makes a claim', subject: 'external', source: research },
  { statement: 'The user selected a goal', subject: 'user_decision', source: decision },
];
const opinion = { id: 'opinion-a', projectId: 'project-a', topicKey: 'next-step', currentRevision: 1, status: 'draft' };
const revision = {
  id: 'revision-a1', opinionId: 'opinion-a', projectId: 'project-a', version: 1,
  facts, inferences: ['The project may benefit from review'], counterEvidence: [],
  counterEvidenceLimitation: 'No counterexample has yet been found',
  uncertainties: ['The original intent is unknown'], opinion: 'Review the design',
  whyNow: 'The source is available', alternatives: ['Defer review'],
  changeMyMindWhen: ['The user clarifies a different goal'], proposedPlanId: 'plan-a1', createdAt: time,
};
const plan = { id: 'plan-a1', projectId: 'project-a', revisionId: 'revision-a1', versionHash: hash, steps: ['Read evidence'], risks: ['Incomplete evidence'], validation: ['Ask user'], executable: false };
const feedback = { id: 'feedback-a1', projectId: 'project-a', revisionId: 'revision-a1', choice: 'accept', createdAt: time };
const bundle = { contractVersion: '1', project, opinion, revision, plan, feedback: [feedback] };

describe('project knowledge contracts', () => {
  it('accepts a synthetic project with distinct observed, research and user-decision sources', () => {
    expect(Project.safeParse(project).success).toBe(true);
    expect([observer, research, decision].every(source => EvidenceRef.safeParse(source).success)).toBe(true);
    expect(OpinionBundle.safeParse(bundle).success).toBe(true);
    expect(OpinionBundle.safeParse({ ...bundle, contractVersion: '2' }).success).toBe(false);
    const { contractVersion: _missing, ...unversioned } = bundle;
    expect(OpinionBundle.safeParse(unversioned).success).toBe(false);
  });

  it('rejects missing and undeclared fields even inside nested evidence', () => {
    const { observerSourceId: _missing, ...withoutSource } = observer;
    expect(EvidenceRef.safeParse(withoutSource).success).toBe(false);
    expect(Project.safeParse({ ...project, approved: true }).success).toBe(false);
    expect(GroundedFact.safeParse({ ...facts[0], source: { ...observer, verified: true } }).success).toBe(false);
    expect(EvidenceRef.safeParse({ ...research, contentHash: 'not-a-hash' }).success).toBe(false);
  });

  it('does not let external research or a user decision masquerade as an observed project fact', () => {
    expect(GroundedFact.safeParse({ statement: 'External', subject: 'project', source: research }).success).toBe(false);
    expect(GroundedFact.safeParse({ statement: 'A choice', subject: 'project', source: decision }).success).toBe(false);
    expect(GroundedFact.safeParse({ statement: 'A file', subject: 'external', source: observer }).success).toBe(false);
  });

  it('rejects evidence belonging to another project within a revision', () => {
    const crossProject = { ...observer, projectId: 'project-b' };
    const modified = { ...revision, facts: [{ ...facts[0], source: crossProject }] };
    expect(OpinionRevision.safeParse(modified).success).toBe(false);
    expect(OpinionRevision.safeParse({ ...revision, counterEvidence: [{ ...research, projectId: 'project-b' }] }).success).toBe(false);
  });

  it('requires an explicit limitation when no counterevidence is included', () => {
    const { counterEvidenceLimitation: _missing, ...withoutLimitation } = revision;
    expect(OpinionRevision.safeParse(withoutLimitation).success).toBe(false);
    expect(OpinionRevision.safeParse({ ...withoutLimitation, counterEvidence: [research] }).success).toBe(true);
  });

  it('rejects cross-project and mismatched identity references in assembled bundles', () => {
    expect(OpinionBundle.safeParse({ ...bundle, opinion: { ...opinion, projectId: 'project-b' } }).success).toBe(false);
    expect(OpinionBundle.safeParse({ ...bundle, revision: { ...revision, opinionId: 'other' } }).success).toBe(false);
    expect(OpinionBundle.safeParse({ ...bundle, opinion: { ...opinion, currentRevision: 2 } }).success).toBe(false);
    expect(OpinionBundle.safeParse({ ...bundle, feedback: [{ ...feedback, projectId: 'project-b' }] }).success).toBe(false);
    expect(OpinionBundle.safeParse({ ...bundle, feedback: [{ ...feedback, revisionId: 'other' }] }).success).toBe(false);
  });

  it('requires a non-executable plan tied to the same project and revision', () => {
    expect(ProposedPlan.safeParse({ ...plan, executable: true }).success).toBe(false);
    expect(OpinionBundle.safeParse({ ...bundle, plan: { ...plan, projectId: 'project-b' } }).success).toBe(false);
    expect(OpinionBundle.safeParse({ ...bundle, plan: { ...plan, revisionId: 'other' } }).success).toBe(false);
    expect(OpinionBundle.safeParse({ ...bundle, plan: { ...plan, id: 'other' } }).success).toBe(false);
  });

  it('keeps a user challenge or deferral as feedback with its required context', () => {
    expect(Feedback.safeParse({ ...feedback, choice: 'challenge' }).success).toBe(false);
    expect(Feedback.safeParse({ ...feedback, choice: 'challenge', reason: 'The goal is different' }).success).toBe(true);
    expect(Feedback.safeParse({ ...feedback, choice: 'defer' }).success).toBe(false);
    expect(Feedback.safeParse({ ...feedback, choice: 'defer', deferUntil: later }).success).toBe(true);
    expect(Feedback.safeParse({ ...feedback, choice: 'accept', deferUntil: later }).success).toBe(false);
  });

  it('requires a sequential revision within the same project and opinion', () => {
    const current = { ...revision, id: 'revision-a2', version: 2, proposedPlanId: 'plan-a2' };
    expect(RevisionPair.safeParse({ previous: revision, current, reason: 'New evidence' }).success).toBe(true);
    expect(RevisionPair.safeParse({ previous: revision, current: { ...current, version: 3 }, reason: 'New evidence' }).success).toBe(false);
    expect(RevisionPair.safeParse({ previous: revision, current: { ...current, id: revision.id }, reason: 'New evidence' }).success).toBe(false);
    expect(RevisionPair.safeParse({ previous: revision, current: { ...current, opinionId: 'other' }, reason: 'New evidence' }).success).toBe(false);
    const otherProject = { ...current, projectId: 'project-b', facts: current.facts.map(f => ({ ...f, source: { ...f.source, projectId: 'project-b' } })) };
    expect(RevisionPair.safeParse({ previous: revision, current: otherProject, reason: 'New evidence' }).success).toBe(false);
  });
});
