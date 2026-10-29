import { canonicalSerialize, sha256Hex } from '../canonical.js';

export function issueKeyFor(input: {
  projectId: string;
  streamEpoch: number;
  issueFamily: string;
  subjectKey: string;
}): string {
  return sha256Hex(
    canonicalSerialize({
      issueFamily: input.issueFamily,
      projectId: input.projectId,
      streamEpoch: input.streamEpoch,
      subjectKey: input.subjectKey,
    }),
  );
}

export function episodeKeyFor(issueKey: string, openingSignalId: string): string {
  return sha256Hex(canonicalSerialize({ issueKey, openingSignalId }));
}

export function insightIdFor(episodeKey: string): string {
  return `ins_${sha256Hex(episodeKey).slice(0, 16)}`;
}
