import { createHash } from 'node:crypto';

/** Deterministic JSON for insight identity hashes. Keys sorted; no extra whitespace. */
export function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalSerialize(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`).join(',')}}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function insightDedupKey(input: {
  projectId: string;
  ruleId: string;
  ruleMajorVersion: number;
  subjectKey: string;
  episodeKey: string;
}): string {
  return sha256Hex(
    canonicalSerialize({
      episodeKey: input.episodeKey,
      projectId: input.projectId,
      ruleId: input.ruleId,
      ruleMajorVersion: input.ruleMajorVersion,
      subjectKey: input.subjectKey,
    }),
  );
}
