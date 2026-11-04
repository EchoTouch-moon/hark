import { describe, expect, it } from 'vitest';
import { assessEventFreshness } from '../src/event-freshness.js';

const now = new Date('2026-11-03T12:00:00Z');
const event = {
  id: 'e', type: 'synthetic', projectId: 'A',
  source: { sourceType: 'fixture', uri: 'fixture://a', sourceId: 's', observedAt: '2026-11-03T11:00:00Z' },
  occurredAt: '2026-11-03T11:00:00Z', observedAt: '2026-11-03T11:00:00Z', expiresAt: '2026-11-03T13:00:00Z',
  summary: 'synthetic', dedupeKey: 'e', sensitivity: 'restricted', provenance: 'tool_observed', tags: [],
};

describe('event freshness is only a precondition', () => {
  it('withholds missing, expired, malformed and future observations', () => {
    const { expiresAt: _expiry, ...withoutExpiry } = event;
    expect(assessEventFreshness(withoutExpiry, now)).toEqual({ status: 'withheld', reason: 'missing_expiry' });
    expect(assessEventFreshness({ ...event, expiresAt: '2026-11-03T12:00:00Z' }, now)).toEqual({ status: 'withheld', reason: 'expired' });
    expect(assessEventFreshness({ ...event, expiresAt: '2026-11-03T11:30:00Z' }, now)).toEqual({ status: 'withheld', reason: 'expired' });
    expect(assessEventFreshness({ ...event, observedAt: '2026-11-03T12:01:00Z' }, now)).toEqual({ status: 'withheld', reason: 'future_observation' });
    expect(assessEventFreshness({ ...event, source: { ...event.source, observedAt: '2026-11-03T12:01:00Z' } }, now)).toEqual({ status: 'withheld', reason: 'future_observation' });
    expect(assessEventFreshness({ ...event, occurredAt: '2026-11-03T12:01:00Z' }, now)).toEqual({ status: 'withheld', reason: 'future_observation' });
    expect(assessEventFreshness({ ...event, expiresAt: '2027-02-30T13:00:00Z' }, now)).toEqual({ status: 'withheld', reason: 'invalid_event' });
    expect(assessEventFreshness({ ...event, approved: true }, now)).toEqual({ status: 'withheld', reason: 'invalid_event' });
    expect(assessEventFreshness(event, new Date('invalid'))).toEqual({ status: 'withheld', reason: 'invalid_clock' });
  });
  it('does not promote a model inference into an observed fact', () => {
    expect(assessEventFreshness({ ...event, provenance: 'model_inferred' }, now)).toEqual({ status: 'withheld', reason: 'model_inference' });
  });
  it('only asks for source verification, without returning restricted content or authorizing use', () => {
    expect(assessEventFreshness(event, now)).toEqual({ status: 'needs_source_verification', projectId: 'A', eventId: 'e' });
  });
});
