import { z } from 'zod';

/**
 * ISO-8601 datetime with mandatory timezone offset (or Z).
 * Matches e.g. 2026-10-28T10:00:00+08:00 / 2026-10-28T02:00:00Z
 */
export const IsoDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/,
    'must be ISO-8601 datetime with timezone',
  );
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** Entity ids: printable, no spaces, bounded length. */
export const IdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/);
export type Id = z.infer<typeof IdSchema>;

/** Non-empty bounded string used for human-visible summaries. */
export const SummarySchema = z.string().min(1).max(2000);

export const TagsSchema = z.array(z.string().min(1).max(64)).max(16);
