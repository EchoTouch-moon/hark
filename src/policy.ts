import { ObservationGrant } from './contracts.js';
import { z } from 'zod';

const request = z.object({ principalId: z.string().min(1), projectId: z.string().min(1), rootId: z.string().min(1), operation: z.enum(['observe', 'research', 'model', 'execute']) }).strict();
export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

/** Pure policy check only: the caller must obtain the grant from trusted storage and enforce path boundaries. */
export function evaluateAdmission(rawRequest: unknown, rawGrant: unknown, now: Date = new Date()): PolicyDecision {
  const parsed = request.safeParse(rawRequest);
  if (!parsed.success) return { allowed: false, reason: 'invalid_request' };
  // No research, model or execution channel is implemented. Fail closed even with a purported approval.
  if (parsed.data.operation !== 'observe') return { allowed: false, reason: 'capability_not_implemented' };
  const grant = ObservationGrant.safeParse(rawGrant);
  if (!grant.success) return { allowed: false, reason: 'missing_or_invalid_grant' };
  if (!grant.data.enabled || grant.data.paused || grant.data.revokedAt !== null) return { allowed: false, reason: 'grant_inactive' };
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return { allowed: false, reason: 'invalid_clock' };
  if (Date.parse(grant.data.expiresAt) <= nowMs) return { allowed: false, reason: 'grant_expired' };
  if (grant.data.principalId !== parsed.data.principalId || grant.data.projectId !== parsed.data.projectId || grant.data.rootId !== parsed.data.rootId) return { allowed: false, reason: 'scope_mismatch' };
  return { allowed: true };
}
