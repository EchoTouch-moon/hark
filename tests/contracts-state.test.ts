import { describe, expect, it } from 'vitest';
import { ActionCard, ActionSpec, Candidate, Event, ObservationGrant, SourceRef } from '../src/contracts.js';
import { assertRunTransition } from '../src/state-machine.js';

const observedAt = '2026-11-03T12:00:00.000Z';
const source = { sourceType: 'fixture', uri: 'fixture://project-a/readme', sourceId: 'source-a', observedAt };
const event = {
  id: 'event-a', type: 'file.observed', projectId: 'project-a', source,
  occurredAt: observedAt, observedAt, summary: 'Synthetic observation', dedupeKey: 'event-a-v1',
  sensitivity: 'personal', provenance: 'tool_observed', tags: ['synthetic'],
};
const action = {
  id: 'action-a', actionType: 'repo.read_diagnose', projectId: 'project-a',
  target: { resourceId: 'project-a' }, params: {}, allowedCapabilities: ['read'], risk: 'L0',
  effect: 'read', maxSteps: 1, timeoutMs: 1000, maxCostUsd: 0, idempotencyKey: 'key-a',
  verification: { kind: 'json_schema' },
};

describe('external data contracts', () => {
  it('accepts a sourced synthetic event and preserves its project and provenance', () => {
    const parsed = Event.parse(event);
    expect(parsed.source).toEqual(source);
    expect(parsed.projectId).toBe('project-a');
    expect(parsed.provenance).toBe('tool_observed');
  });

  it('rejects missing provenance and missing nested source identity', () => {
    const { provenance: _provenance, ...withoutProvenance } = event;
    const { sourceId: _sourceId, ...withoutSourceId } = source;
    expect(Event.safeParse(withoutProvenance).success).toBe(false);
    expect(Event.safeParse({ ...event, source: withoutSourceId }).success).toBe(false);
  });

  it('rejects unknown fields at the event and nested source boundaries', () => {
    expect(Event.safeParse({ ...event, approved: true }).success).toBe(false);
    expect(Event.safeParse({ ...event, source: { ...source, trusted: true } }).success).toBe(false);
    expect(SourceRef.safeParse({ ...source, observedAt: 'not-a-date' }).success).toBe(false);
  });

  it('checks action bounds and rejects unknown nested verification or target fields', () => {
    expect(ActionSpec.safeParse(action).success).toBe(true);
    expect(ActionSpec.safeParse({ ...action, maxSteps: 0 }).success).toBe(false);
    expect(ActionSpec.safeParse({ ...action, maxCostUsd: -1 }).success).toBe(false);
    expect(ActionSpec.safeParse({ ...action, target: { ...action.target, approved: true } }).success).toBe(false);
    expect(ActionSpec.safeParse({ ...action, verification: { ...action.verification, passed: true } }).success).toBe(false);
  });

  it('keeps observation grants explicit and rejects undeclared execution capabilities', () => {
    const grant = { id: 'grant-a', principalId: 'user-a', projectId: 'project-a', rootId: 'root-a', enabled: true, paused: false, expiresAt: '2099-01-01T00:00:00Z', revokedAt: null };
    expect(ObservationGrant.safeParse(grant).success).toBe(true);
    expect(ObservationGrant.safeParse({ ...grant, allowExecution: true }).success).toBe(false);
  });

  it('rejects candidate and card actions from a different project', () => {
    const candidate = { id: 'c', projectId: 'project-a', eventIds: ['e'], title: 'title', whyNow: 'why', evidence: [source], suggestedAction: action, score: 0.5, confidence: 0.5, risk: 'L0', expiresAt: observedAt, suppressionKey: 's', status: 'candidate' };
    const card = { id: 'card', candidateId: 'c', projectId: 'project-a', title: 'title', whyNow: 'why', evidence: [source], action, createdAt: observedAt, expiresAt: observedAt, status: 'proposed' };
    expect(Candidate.safeParse(candidate).success).toBe(true);
    expect(ActionCard.safeParse(card).success).toBe(true);
    expect(Candidate.safeParse({ ...candidate, suggestedAction: { ...action, projectId: 'project-b' } }).success).toBe(false);
    expect(ActionCard.safeParse({ ...card, action: { ...action, projectId: 'project-b' } }).success).toBe(false);
  });
});

describe('run state transitions', () => {
  it('allows the normal verified path and the explicit uncertain recovery path', () => {
    expect(() => assertRunTransition('queued', 'executing')).not.toThrow();
    expect(() => assertRunTransition('executing', 'verifying')).not.toThrow();
    expect(() => assertRunTransition('verifying', 'completed', true)).not.toThrow();
    expect(() => assertRunTransition('executing', 'pending_verification')).not.toThrow();
    expect(() => assertRunTransition('pending_verification', 'verifying')).not.toThrow();
  });

  it.each([
    ['queued', 'completed'],
    ['executing', 'completed'],
    ['pending_verification', 'executing'],
    ['blocked', 'completed'],
    ['completed', 'executing'],
  ])('rejects forbidden transition %s -> %s even if verification is claimed', (from, to) => {
    expect(() => assertRunTransition(from, to, true)).toThrow();
  });

  it('does not complete verification without an independent pass', () => {
    expect(() => assertRunTransition('verifying', 'completed')).toThrow('Independent verification required');
    expect(() => assertRunTransition('verifying', 'completed', false)).toThrow('Independent verification required');
  });

  it('rejects unknown states', () => {
    expect(() => assertRunTransition('queued', 'done')).toThrow();
    expect(() => assertRunTransition('invented', 'executing')).toThrow();
  });
});
