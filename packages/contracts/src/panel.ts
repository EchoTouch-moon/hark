import { z } from 'zod';
import { IdSchema } from './common.js';

export const PanelComponentTypeSchema = z.enum(['text', 'metric', 'list', 'status', 'link']);

export const PanelSpecSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(['metric', 'list', 'timeline', 'activity']),
    projectId: IdSchema.optional(),
    dataQueryId: z.string().min(1).max(128),
    refreshSeconds: z.number().int().min(5).max(3600),
    components: z
      .array(
        z
          .object({
            type: PanelComponentTypeSchema,
            field: z.string().min(1).max(128),
            label: z.string().min(1).max(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();
export type PanelSpec = z.infer<typeof PanelSpecSchema>;
