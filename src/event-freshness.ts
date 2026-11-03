import { Event } from './contracts.js';

export type EventFreshness =
  | { status: 'withheld'; reason: 'invalid_event' | 'invalid_clock' | 'missing_expiry' | 'expired' | 'future_observation' | 'model_inference' }
  | { status: 'needs_source_verification'; projectId: string; eventId: string };

function timestamp(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A time check is not source verification, authorization, or proof of truth.
 * Historical records remain stored even when they cannot be used as current facts.
 */
export function assessEventFreshness(input: unknown, now: Date = new Date()): EventFreshness {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return { status: 'withheld', reason: 'invalid_clock' };
  const parsed = Event.safeParse(input);
  if (!parsed.success) return { status: 'withheld', reason: 'invalid_event' };
  const event = parsed.data;
  if (event.provenance === 'model_inferred') return { status: 'withheld', reason: 'model_inference' };
  if (!event.expiresAt) return { status: 'withheld', reason: 'missing_expiry' };
  const expiry = timestamp(event.expiresAt), observation = timestamp(event.observedAt), sourceObservation = timestamp(event.source.observedAt), occurred = timestamp(event.occurredAt);
  if (expiry === null || observation === null || sourceObservation === null || occurred === null) return { status: 'withheld', reason: 'invalid_event' };
  if (expiry <= now.getTime()) return { status: 'withheld', reason: 'expired' };
  if (observation > now.getTime() || sourceObservation > now.getTime() || occurred > now.getTime()) return { status: 'withheld', reason: 'future_observation' };
  return { status: 'needs_source_verification', projectId: event.projectId, eventId: event.id };
}
