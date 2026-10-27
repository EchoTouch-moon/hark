import { z } from 'zod';
import { ProvenanceSchema, SensitivitySchema } from './enums.js';
import { IdSchema, IsoDateTimeSchema, SummarySchema, TagsSchema } from './common.js';
import { SourceRefSchema } from './source.js';

export const EventSchema = z
  .object({
    id: IdSchema,
    type: z.string().min(1).max(128),
    projectId: IdSchema,
    source: SourceRefSchema,
    occurredAt: IsoDateTimeSchema,
    observedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema.optional(),
    summary: SummarySchema,
    dedupeKey: z.string().min(1).max(256),
    sensitivity: SensitivitySchema,
    provenance: ProvenanceSchema,
    payloadRef: z.string().max(2048).optional(),
    tags: TagsSchema,
  })
  .strict();
export type Event = z.infer<typeof EventSchema>;
