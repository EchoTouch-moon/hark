import { z } from 'zod';
import { SourceTypeSchema } from './enums.js';
import { IdSchema, IsoDateTimeSchema } from './common.js';

export const SourceRefSchema = z
  .object({
    sourceType: SourceTypeSchema,
    uri: z.string().min(1).max(2048),
    sourceId: IdSchema,
    observedAt: IsoDateTimeSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict();
export type SourceRef = z.infer<typeof SourceRefSchema>;
