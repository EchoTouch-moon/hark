import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Storage } from '@hearth/storage';
import { FixtureConnector } from '@hearth/connectors';
import { DiscoveryService } from './discovery.js';

let dir: string;
let store: Storage;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-disc-'));
  store = new Storage(path.join(dir, 't.sqlite'));
  const connector = new FixtureConnector(process.cwd());
  store.seedProjects(connector.loadProjects());
  for (const { event, meta } of connector.loadEvents()) {
    store.ingestEvent(event, { goldenAction: meta.goldenAction, goldenUseful: meta.goldenUseful });
  }
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('quiet hours + budget integration (M2-T02)', () => {
  it('quiet hours defer new cards; next day discover surfaces them', async () => {
    const night = new DiscoveryService({
      storage: store,
      clock: () => '2026-10-28T15:30:00.000Z', // 23:30 +08
      suppression: { quietHours: { start: '22:00', end: '08:00', timezone: 'Asia/Shanghai' }, maxCardsPerDay: 3, dismissCooldownHours: 72 },
    });
    const r1 = await night.discover();
    expect(r1.quietHoursActive).toBe(true);
    expect(r1.cardsCreated).toBe(0);
    expect(store.listCards({ limit: 10 })).toHaveLength(0);

    const day = new DiscoveryService({
      storage: store,
      clock: () => '2026-10-29T04:00:00.000Z', // 12:00 +08 next day
      suppression: { quietHours: { start: '22:00', end: '08:00', timezone: 'Asia/Shanghai' }, maxCardsPerDay: 3, dismissCooldownHours: 72 },
    });
    const r2 = await day.discover();
    expect(r2.quietHoursActive).toBe(false);
    expect(r2.cardsCreated).toBe(3);
  });

  it('daily budget caps new cards per local day', async () => {
    const svc = new DiscoveryService({
      storage: store,
      clock: () => '2026-10-28T04:00:00.000Z', // 12:00 +08
      suppression: { quietHours: { start: '22:00', end: '08:00', timezone: 'Asia/Shanghai' }, maxCardsPerDay: 2, dismissCooldownHours: 72 },
    });
    const r = await svc.discover();
    expect(r.cardsCreated).toBe(2);
    expect(r.budgetExhausted).toBe(true);
    expect(store.listCards({ limit: 10 })).toHaveLength(2);
  });

  it('completed suppression key is not re-nagged, dismissed respected', async () => {
    const svc = new DiscoveryService({
      storage: store,
      clock: () => '2026-10-28T04:00:00.000Z',
      suppression: { quietHours: { start: '22:00', end: '08:00', timezone: 'Asia/Shanghai' }, maxCardsPerDay: 5, dismissCooldownHours: 72 },
    });
    await svc.discover();
    const cards = store.listCards({ limit: 10 });
    store.updateCard(cards[0]!.id, { status: 'completed' });
    store.updateCard(cards[1]!.id, { status: 'dismissed' });
    const r2 = await svc.discover();
    expect(r2.cardsCreated).toBe(0);
    expect(r2.dismissedRespected).toBe(1);
    expect(r2.duplicatesSuppressed).toBeGreaterThanOrEqual(1);
    expect(store.listCards({ limit: 10 })).toHaveLength(3);
  });
});
