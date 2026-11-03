import { z } from 'zod';
import { ACTION_POLICIES } from './action-policy.js';

export type ProposalDecision = { allowed: false; reason: 'invalid_proposal' | 'action_disabled' };
const disabled = Object.freeze({ allowed: false, reason: 'action_disabled' } as const);

const projectId = z.string().trim().min(1).max(256);
const target = z.object({ resourceId: z.string().trim().min(1).max(256) }).strict();

// Deliberately no risk, effect, capabilities, approval, state or verifier fields.
// Parameter schemas are frozen per type, but a valid parameter set still carries no permission.
const Proposal = z.discriminatedUnion('actionType', [
  z.object({ actionType: z.literal('report.generate'), projectId, target, params: ACTION_POLICIES['report.generate'].params }).strict(),
  z.object({ actionType: z.literal('checklist.generate'), projectId, target, params: ACTION_POLICIES['checklist.generate'].params }).strict(),
  z.object({ actionType: z.literal('draft.generate'), projectId, target, params: ACTION_POLICIES['draft.generate'].params }).strict(),
  z.object({ actionType: z.literal('repo.read_diagnose'), projectId, target, params: ACTION_POLICIES['repo.read_diagnose'].params }).strict(),
]);

/** Parse an untrusted proposal and fail closed; this does not authorize any action. */
export function evaluateActionProposal(input: unknown): ProposalDecision {
  const proposal = Proposal.safeParse(input);
  if (!proposal.success) return { allowed: false, reason: 'invalid_proposal' };
  return disabled;
}
