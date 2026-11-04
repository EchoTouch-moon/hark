import { RunState } from './contracts.js';

const transitions: Readonly<Record<RunState, readonly RunState[]>> = {
  queued: ['awaiting_approval', 'executing'],
  awaiting_approval: ['executing', 'blocked'],
  executing: ['verifying', 'failed', 'cancelled', 'pending_verification'],
  verifying: ['completed', 'failed', 'pending_verification'],
  pending_verification: ['verifying'],
  completed: [], failed: [], blocked: [], cancelled: [],
};

export function assertRunTransition(from: unknown, to: unknown, independentVerificationPassed = false): asserts to is RunState {
  const a = RunState.parse(from);
  const b = RunState.parse(to);
  if (!transitions[a].includes(b)) throw new Error(`Illegal run transition: ${a} -> ${b}`);
  if (b === 'completed' && !independentVerificationPassed) throw new Error('Independent verification required');
}
