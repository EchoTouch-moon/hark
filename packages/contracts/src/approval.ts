import { z } from 'zod';
import { RiskSchema } from './enums.js';
import { IdSchema, IsoDateTimeSchema } from './common.js';

export const ApprovalGrantSchema = z
  .object({
    id: IdSchema,
    principalId: IdSchema,
    cardId: IdSchema,
    actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    targetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    risk: RiskSchema,
    authorizedCapabilities: z.array(z.string().min(1).max(64)).max(16),
    expiresAt: IsoDateTimeSchema,
    grantedAt: IsoDateTimeSchema,
    consumedAt: IsoDateTimeSchema.optional(),
  })
  .strict();
export type ApprovalGrant = z.infer<typeof ApprovalGrantSchema>;
