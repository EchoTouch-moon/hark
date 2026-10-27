import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './common.js';

export const RunStateSchema = z.enum([
  'queued',
  'awaiting_approval',
  'executing',
  'verifying',
  'completed',
  'pending_verification',
  'failed',
  'blocked',
  'cancelled',
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const VerificationVerdictSchema = z.enum(['pass', 'fail', 'unknown']);
export type VerificationVerdict = z.infer<typeof VerificationVerdictSchema>;

export const FailureClassSchema = z.enum([
  'timeout',
  'policy',
  'dependency',
  'executor',
  'verification',
  'unknown',
]);
export type FailureClass = z.infer<typeof FailureClassSchema>;

export const TaskRunSchema = z
  .object({
    id: IdSchema,
    cardId: IdSchema,
    actionId: IdSchema,
    idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
    state: RunStateSchema,
    createdAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.optional(),
    endedAt: IsoDateTimeSchema.optional(),
    resultArtifactRefs: z.array(z.string().min(1).max(1024)).max(32),
    verificationVerdict: VerificationVerdictSchema.optional(),
    failureClass: FailureClassSchema.optional(),
  })
  .strict();
export type TaskRun = z.infer<typeof TaskRunSchema>;

export const RunStepSchema = z
  .object({
    id: IdSchema,
    runId: IdSchema,
    sequence: z.number().int().min(0).max(999),
    name: z.string().min(1).max(128),
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
    startedAt: IsoDateTimeSchema.optional(),
    endedAt: IsoDateTimeSchema.optional(),
    detail: z.string().max(4000).optional(),
  })
  .strict();
export type RunStep = z.infer<typeof RunStepSchema>;

/**
 * State machine per docs/04-CONTRACTS.md (single source of truth).
 * Forbidden shortcuts (e.g. queued→completed, executing→completed) are
 * structurally impossible with this table.
 */
export const RUN_STATE_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  queued: ['awaiting_approval', 'executing', 'cancelled', 'blocked'],
  awaiting_approval: ['executing', 'blocked', 'cancelled'],
  executing: ['verifying', 'failed', 'cancelled', 'pending_verification'],
  verifying: ['completed', 'failed', 'pending_verification'],
  pending_verification: ['verifying', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  blocked: [],
  cancelled: [],
};

export const TERMINAL_RUN_STATES: readonly RunState[] = [
  'completed',
  'failed',
  'blocked',
  'cancelled',
];

export function isTerminalRunState(state: RunState): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return RUN_STATE_TRANSITIONS[from].includes(to);
}

export class InvalidRunTransitionError extends Error {
  constructor(
    public readonly from: RunState,
    public readonly to: RunState,
  ) {
    super(`illegal run state transition ${from} -> ${to}`);
    this.name = 'InvalidRunTransitionError';
  }
}

export function assertRunTransition(from: RunState, to: RunState): void {
  if (!canTransitionRun(from, to)) throw new InvalidRunTransitionError(from, to);
}
