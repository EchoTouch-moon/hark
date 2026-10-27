import { z } from 'zod';
import { ActionTypeSchema, EffectTypeSchema, RiskSchema, VerificationKindSchema } from './enums.js';
import { IdSchema } from './common.js';

export const ActionVerificationSchema = z
  .object({
    kind: VerificationKindSchema,
    artifactPath: z.string().max(512).optional(),
    expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict();
export type ActionVerification = z.infer<typeof ActionVerificationSchema>;

export const ActionTargetSchema = z
  .object({
    resourceId: z.string().min(1).max(256),
    path: z.string().max(1024).optional(),
  })
  .strict();
export type ActionTarget = z.infer<typeof ActionTargetSchema>;

export const ActionSpecSchema = z
  .object({
    id: IdSchema,
    actionType: ActionTypeSchema,
    projectId: IdSchema,
    target: ActionTargetSchema,
    params: z.record(z.string(), z.unknown()),
    allowedCapabilities: z.array(z.string().min(1).max(64)).max(16),
    risk: RiskSchema,
    effect: EffectTypeSchema,
    maxSteps: z.number().int().min(1).max(64),
    timeoutMs: z.number().int().min(100).max(600_000),
    maxCostUsd: z.number().min(0).max(0), // P0: no paid model calls allowed
    idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
    expectedSourceVersion: z.string().min(1).max(128).optional(),
    verification: ActionVerificationSchema,
  })
  .strict();
export type ActionSpec = z.infer<typeof ActionSpecSchema>;
