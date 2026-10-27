import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './common.js';
import { SourceRefSchema } from './source.js';
import { ActionSpecSchema } from './action.js';

export const CardStatusSchema = z.enum([
  'proposed',
  'dismissed',
  'snoozed',
  'expired',
  'ready',
  'awaiting_approval',
  'executing',
  'verifying',
  'completed',
  'failed',
  'blocked',
]);
export type CardStatus = z.infer<typeof CardStatusSchema>;

export const UserFeedbackSchema = z.enum(['useful', 'not_useful', 'irrelevant']);
export type UserFeedback = z.infer<typeof UserFeedbackSchema>;

export const ActionCardSchema = z
  .object({
    id: IdSchema,
    candidateId: IdSchema,
    projectId: IdSchema,
    title: z.string().min(1).max(200),
    whyNow: z.string().min(1).max(500),
    evidence: z.array(SourceRefSchema).min(1).max(16),
    action: ActionSpecSchema,
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    status: CardStatusSchema,
    snoozedUntil: IsoDateTimeSchema.optional(),
    userFeedback: UserFeedbackSchema.optional(),
  })
  .strict();
export type ActionCard = z.infer<typeof ActionCardSchema>;
