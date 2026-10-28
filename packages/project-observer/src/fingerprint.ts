import type { ProjectSnapshot } from './contracts.js';
import { sha256Hex } from './ids.js';

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** Deterministic hash of the observable project state. Observation time is excluded. */
export function snapshotFingerprint(
  snapshot: Omit<ProjectSnapshot, 'id' | 'projectId' | 'observedAt' | 'fingerprint'>,
): string {
  return sha256Hex(
    canonicalJson({
      accessibility: snapshot.accessibility,
      headSha: snapshot.headSha,
      branch: snapshot.branch,
      detached: snapshot.detached,
      unborn: snapshot.unborn,
      gitIdentity: snapshot.gitIdentity,
      worktree: snapshot.worktree,
      test: {
        result: snapshot.test.result,
        evidenceQuality: snapshot.test.evidenceQuality,
        headBound: snapshot.test.headBound,
        stale: snapshot.test.stale,
        tests: snapshot.test.tests ?? null,
        passed: snapshot.test.passed ?? null,
        failed: snapshot.test.failed ?? null,
        skipped: snapshot.test.skipped ?? null,
        errors: snapshot.test.errors ?? null,
        reportFingerprint: snapshot.test.reportFingerprint ?? null,
        relativePath: snapshot.test.relativePath ?? null,
      },
    }),
  );
}
