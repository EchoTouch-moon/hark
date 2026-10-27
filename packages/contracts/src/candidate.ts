import { z } from 'zod';
import { RiskSchema } from './enums.js';
import { IdSchema, IsoDateTimeSchema } from './common.js';
import { SourceRefSchema } from './source.js';
import { ActionSpecSchema } from './action.js';

export const CandidateStatusSchema = z.enum(['candidate', 'suppressed', 'proposed']);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

export const CandidateSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    eventIds: z.array(IdSchema).min(1).max(16),
    title: z.string().min(1).max(200),
    whyNow: z.string().min(1).max(500),
    evidence: z.array(SourceRefSchema).min(1).max(16),
    suggestedAction: ActionSpecSchema,
    score: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    risk: RiskSchema,
    expiresAt: IsoDateTimeSchema,
    suppressionKey: z.string().min(1).max(256),
    status: CandidateStatusSchema,
  })
  .strict();
export type Candidate = z.infer<typeof CandidateSchema>;
