import { z } from 'zod';
import { ActionType } from './contracts.js';

export type ProposalDecision = { allowed: false; reason: 'invalid_proposal' | 'action_disabled' };
const disabled = Object.freeze({ allowed: false, reason: 'action_disabled' } as const);
// No action policy has been approved yet. A registered type is not an enabled action.
const registry: Readonly<Record<z.infer<typeof ActionType>, typeof disabled>> = Object.freeze({
  'report.generate': disabled, 'checklist.generate': disabled,
  'draft.generate': disabled, 'repo.read_diagnose': disabled,
});

// Deliberately no risk, effect, capabilities, approval, state or verifier fields.
// No action-specific parameter schema is frozen, so no parameters are admitted.
const Proposal = z.object({
  actionType: ActionType,
  projectId: z.string().trim().min(1).max(256),
  target: z.object({ resourceId: z.string().trim().min(1).max(256) }).strict(),
  params: z.object({}).strict(),
}).strict();

/** Parse an untrusted proposal and fail closed; this does not authorize any action. */
export function evaluateActionProposal(input: unknown): ProposalDecision {
  const proposal = Proposal.safeParse(input);
  if (!proposal.success) return { allowed: false, reason: 'invalid_proposal' };
  return registry[proposal.data.actionType];
}
