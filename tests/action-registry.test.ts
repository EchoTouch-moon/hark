import { describe, expect, it } from 'vitest';
import { evaluateActionProposal } from '../src/action-registry.js';

const proposal = { actionType: 'repo.read_diagnose', projectId: 'A', target: { resourceId: 'synthetic' }, params: {} };

describe('untrusted action proposals fail closed', () => {
  it.each(['report.generate', 'checklist.generate', 'draft.generate', 'repo.read_diagnose'])('keeps %s disabled', actionType => {
    expect(evaluateActionProposal({ ...proposal, actionType })).toEqual({ allowed: false, reason: 'action_disabled' });
  });
  it('rejects unknown actions, unreviewed parameters and target fields', () => {
    for (const bad of [
      { ...proposal, actionType: 'other' },
      { ...proposal, params: { shell: 'anything' } },
      { ...proposal, target: { ...proposal.target, path: '../outside' } },
      { ...proposal, projectId: '' },
    ]) expect(evaluateActionProposal(bad)).toEqual({ allowed: false, reason: 'invalid_proposal' });
    expect(evaluateActionProposal({ ...proposal, projectId: 'B', target: { resourceId: 'project-A' } })).toEqual({ allowed: false, reason: 'action_disabled' });
  });
  it('never accepts client-supplied risk, effect, capability, approval or completion', () => {
    for (const extra of [
      { risk: 'L0' }, { risk: 'L2' }, { risk: 'L3' }, { effect: 'external_write' },
      { allowedCapabilities: ['write'] }, { approved: true }, { state: 'completed' }, { verifier: 'pass' },
    ]) expect(evaluateActionProposal({ ...proposal, ...extra })).toEqual({ allowed: false, reason: 'invalid_proposal' });
  });
});
