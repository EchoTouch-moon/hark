import type { Event } from '@hearth/contracts';

/** Project events for HTTP responses without exposing restricted payload references. */
export function projectEventForResponse(event: Event): Event {
  if (event.sensitivity !== 'restricted') return event;

  const projection = { ...event };
  delete projection.payloadRef;
  return projection;
}
