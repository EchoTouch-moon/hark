/** The local hour changes the room's atmosphere, never a project's state. */
export type HearthPeriod = 'day' | 'night';

export function getHearthPeriod(now: Date): HearthPeriod {
  const hour = now.getHours();
  return Number.isFinite(hour) && hour >= 7 && hour < 19 ? 'day' : 'night';
}
