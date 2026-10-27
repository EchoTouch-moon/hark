import { z } from 'zod';
import type { MockAgentAdapter } from '@hearth/agent-adapters';
import type { DiscoveryService, Orchestrator } from '@hearth/core';

/** Services injected into routes. */
export interface Services {
  discovery: DiscoveryService;
  orchestrator: Orchestrator;
  chat: MockAgentAdapter;
  seedDemo: () => Promise<{ eventsIngested: number }>;
}

export const SettingsDtoSchema = z
  .object({
    quietHours: z.object({
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }),
    maxCardsPerDay: z.number().int().min(1).max(10),
    demoMode: z.boolean(),
    timezone: z.string().min(1).default('Asia/Shanghai'),
  })
  .strict();

export type SettingsDto = z.infer<typeof SettingsDtoSchema>;

export const DEFAULT_SETTINGS: SettingsDto = {
  quietHours: { start: '22:00', end: '08:00' },
  maxCardsPerDay: 3,
  demoMode: true,
  timezone: 'Asia/Shanghai',
};
