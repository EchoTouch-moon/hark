import { z } from 'zod';
/** Only the server decides which product mode is enabled. Unknown fields are discarded. */
export const RuntimeModeSchema = z.object({ demoMode: z.boolean() });
