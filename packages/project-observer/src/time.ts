const ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export type Clock = () => Date;

export function nowUtcIso(clock: Clock = () => new Date()): string {
  return clock().toISOString();
}

export function isIsoDateTime(value: string): boolean {
  return ISO.test(value);
}

export function toIsoUtc(date: Date): string {
  return date.toISOString();
}

export function parseIso(value: string): Date | null {
  if (!ISO.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function msBetween(fromIso: string, toIso: string): number | null {
  const from = parseIso(fromIso);
  const to = parseIso(toIso);
  if (from === null || to === null) return null;
  return to.getTime() - from.getTime();
}
