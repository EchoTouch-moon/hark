import type { Event } from '@hearth/contracts';
import { EventSchema } from '@hearth/contracts';
import { loadFixtures } from '@hearth/eval';

export interface FixtureEventWithMeta {
  event: Event;
  meta: { goldenAction: string | null; goldenUseful: boolean };
}

export interface ConnectorInfo {
  id: string;
  scopes: readonly string[];
  enabled: boolean;
}

/**
 * Reads the synthetic planning-pack fixtures. This is the ONLY data source
 * enabled in P0; real vault/GitHub connectors stay off and unimplemented.
 */
export class FixtureConnector {
  readonly id = 'fixture';
  readonly scopes = ['fixtures.read'] as const;

  constructor(private readonly repoRoot: string) {}

  info(): ConnectorInfo {
    return { id: this.id, scopes: this.scopes, enabled: true };
  }

  loadProjects(): Array<{ id: string; name: string; description: string; visibility: string }> {
    const fx = loadFixtures(this.repoRoot);
    return fx.projects.projects.map((p) => ({ ...p, visibility: 'demo' }));
  }

  loadEvents(): FixtureEventWithMeta[] {
    const fx = loadFixtures(this.repoRoot);
    return fx.events.events.map((e) => ({
      event: EventSchema.parse(e.event),
      meta: { goldenAction: e.meta.goldenAction ?? null, goldenUseful: e.meta.goldenUseful ?? false },
    }));
  }
}

/** Placeholder contract for future read-only connectors (M2+). */
export interface ReadOnlyConnector {
  info(): ConnectorInfo;
}
