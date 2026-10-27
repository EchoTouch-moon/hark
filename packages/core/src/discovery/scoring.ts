import type { Candidate } from '@hearth/contracts';

/**
 * Deterministic ranking (M2-T01): score desc, tie-break by earliest
 * observedAt (older evidence first = more stable), then suppressionKey for
 * total order. Pure and replayable — the eval harness pins it to the golden
 * fixture set.
 */
export function rankCandidates<T extends Pick<Candidate, 'score' | 'id'> & { observedAt?: string }>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ao = a.observedAt ?? '';
    const bo = b.observedAt ?? '';
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

/** Quality gate: candidates below this score are suppressed as low-quality. */
export const MIN_CANDIDATE_SCORE = 0.45;

export function suppressLowQuality<T extends Pick<Candidate, 'score'>>(candidates: readonly T[]): {
  kept: T[];
  suppressed: T[];
} {
  const kept: T[] = [];
  const suppressed: T[] = [];
  for (const c of candidates) {
    (c.score >= MIN_CANDIDATE_SCORE ? kept : suppressed).push(c);
  }
  return { kept, suppressed };
}
