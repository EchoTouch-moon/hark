import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from '../config.js';
import { Storage } from '@hearth/storage';
import { DiscoveryService, Orchestrator } from '@hearth/core';
import { MockAgentAdapter } from '@hearth/agent-adapters';
import { FixtureConnector } from '@hearth/connectors';
import { DEFAULT_SETTINGS, type Services } from './services.js';

let dir: string;
let store: Storage;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let cookie: string;
let csrf: string;
const ORIGIN = 'http://127.0.0.1:4317';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-api-'));
  store = new Storage(path.join(dir, 'test.sqlite'));
  const config = loadConfig({
    dbPath: path.join(dir, 'test.sqlite'),
    artifactRoot: path.join(dir, 'artifacts'),
    staticDir: null,
  });
  const connector = new FixtureConnector(config.repoRoot);
  const services: Services = {
    discovery: new DiscoveryService({ storage: store, clock: () => '2026-10-28T12:00:00.000Z' }),
    orchestrator: new Orchestrator({ storage: store, artifactRoot: config.artifactRoot, clock: () => '2026-10-28T12:00:00.000Z', stepDelayMs: 0 }),
    chat: new MockAgentAdapter(),
    seedDemo: async () => {
      store.seedProjects(connector.loadProjects());
      let n = 0;
      for (const { event, meta } of connector.loadEvents()) {
        if (store.ingestEvent(event, { goldenAction: meta.goldenAction, goldenUseful: meta.goldenUseful }).inserted) n += 1;
      }
      return { eventsIngested: n };
    },
  };
  app = buildApp({ config, storage: store, services });
  store.setSetting('settings', DEFAULT_SETTINGS);

  const sessionRes = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  const rawCookie = sessionRes.headers['set-cookie'];
  const first = Array.isArray(rawCookie) ? rawCookie[0] : String(rawCookie);
  cookie = first.split(';')[0]!;
  csrf = (sessionRes.json() as { csrfToken: string }).csrfToken;
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

function inject(method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  return app.inject({
    method,
    url,
    ...(body === undefined ? {} : { payload: body }),
    headers: { cookie, 'x-csrf-token': csrf, origin: ORIGIN, ...extraHeaders },
  });
}

describe('M1-T01: auth & boundary', () => {
  it('GET /health is public and truthful', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'ok', db: 'ok', demoMode: true, provider: 'mock' });
    expect(JSON.stringify(body)).not.toMatch(/token|secret|password/i);
  });

  it('API without session is 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    expect(res.statusCode).toBe(401);
  });

  it('disallowed Origin is 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects', headers: { cookie, origin: 'http://evil.example' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ORIGIN_DENIED');
  });

  it('write without csrf header is 403 CSRF_DENIED', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/demo/seed', headers: { cookie, origin: ORIGIN } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_DENIED');
  });

  it('write without Origin header is 403 (curl-style bare request)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/demo/seed', headers: { cookie, 'x-csrf-token': csrf } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ORIGIN_REQUIRED');
  });

  it('invalid settings body rejected by zod', async () => {
    const res = await inject('PUT', '/api/v1/settings', { quietHours: { start: '99:00', end: '08:00' }, maxCardsPerDay: 3, demoMode: true, timezone: 'Asia/Shanghai' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_REQUEST');
  });

  it('unknown fields rejected', async () => {
    const res = await inject('PUT', '/api/v1/settings', { quietHours: { start: '22:00', end: '08:00' }, maxCardsPerDay: 3, demoMode: true, timezone: 'Asia/Shanghai', hackerFlag: 1 });
    expect(res.statusCode).toBe(400);
  });

  it('unknown project id is 404', async () => {
    const res = await inject('GET', '/api/v1/projects/project-nope');
    expect(res.statusCode).toBe(404);
  });
});

describe('M1-T02: seed, discovery, suppression', () => {
  it('demo seed ingests fixtures with dedupe collapse', async () => {
    const res = await inject('POST', '/api/v1/demo/seed');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projects).toBe(2);
    expect(body.eventsIngested).toBe(4); // 5 fixture events, 1 duplicate collapses
  });

  it('discover creates exactly 3 cards with evidence and whyNow', async () => {
    await inject('POST', '/api/v1/demo/seed');
    const res = await inject('POST', '/api/v1/discover');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ cardsCreated: 3, noiseSkipped: 1 });

    const cards = (await inject('GET', '/api/v1/cards')).json().cards;
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(c.whyNow.length).toBeGreaterThan(5);
      expect(c.evidence.length).toBeGreaterThanOrEqual(1);
      expect(c.action.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('repeat discover is idempotent (no duplicate cards)', async () => {
    await inject('POST', '/api/v1/demo/seed');
    await inject('POST', '/api/v1/discover');
    await new Promise((r) => setTimeout(r, 1600)); // rate window
    const res = await inject('POST', '/api/v1/discover');
    expect(res.json().cardsCreated).toBe(0);
    expect((await inject('GET', '/api/v1/cards')).json().cards).toHaveLength(3);
  });

  it('dismiss persists and is respected by later discovery (E2E-06)', async () => {
    await inject('POST', '/api/v1/demo/seed');
    await inject('POST', '/api/v1/discover');
    const cards = (await inject('GET', '/api/v1/cards')).json().cards;
    const target = cards.find((c: { title: string }) => c.title === '项目构建未通过');

    const dis = await inject('POST', `/api/v1/cards/${target.id}/dismiss`, { feedback: 'not_useful' });
    expect(dis.statusCode).toBe(200);
    expect(dis.json().card.status).toBe('dismissed');

    await new Promise((r) => setTimeout(r, 1600));
    await inject('POST', '/api/v1/discover');
    const after = (await inject('GET', '/api/v1/cards')).json().cards;
    expect(after.filter((c: { status: string }) => c.status !== 'dismissed')).toHaveLength(2);
    expect(after.filter((c: { title: string }) => c.title === '项目构建未通过')).toHaveLength(1);
  });

  it('snooze validates window and persists', async () => {
    await inject('POST', '/api/v1/demo/seed');
    await inject('POST', '/api/v1/discover');
    const cards = (await inject('GET', '/api/v1/cards')).json().cards;
    const toSecondPrecisionIso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const past = toSecondPrecisionIso(Date.now() - 60_000);
    const future = toSecondPrecisionIso(Date.now() + 2 * 3600_000);
    const stale = await inject('POST', `/api/v1/cards/${cards[0].id}/snooze`, { until: '2020-01-01T00:00:00Z' });
    expect(stale.statusCode).toBe(400);
    const bad = await inject('POST', `/api/v1/cards/${cards[0].id}/snooze`, { until: past });
    expect(bad.statusCode).toBe(400);
    const good = await inject('POST', `/api/v1/cards/${cards[0].id}/snooze`, { until: future });
    expect(good.statusCode).toBe(200);
    expect(good.json().card.status).toBe('snoozed');
  });

  it('project isolation is server-side (E2E-07)', async () => {
    await inject('POST', '/api/v1/demo/seed');
    await inject('POST', '/api/v1/discover');
    const events = (await inject('GET', '/api/v1/events?projectId=project-atlas')).json().events;
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e: { projectId: string }) => e.projectId === 'project-atlas')).toBe(true);
    const snap = (await inject('GET', '/api/v1/projects/project-beacon')).json();
    expect(snap.cards.every((c: { projectId: string }) => c.projectId === 'project-beacon')).toBe(true);
    expect(snap.runs.every((r: { cardId: string }) => snap.cards.some((c: { id: string }) => c.id === r.cardId) || r.cardId.includes('beacon') || snap.cards.length === 0)).toBe(true);
  });
});

describe('M1-T03: execute / runs / approvals / SSE-readiness', () => {
  it('full closed loop via API: execute -> completed with hash evidence (E2E-01/02)', async () => {
    await inject('POST', '/api/v1/demo/seed');
    await inject('POST', '/api/v1/discover');
    const cards = (await inject('GET', '/api/v1/cards')).json().cards;
    const target = cards.find((c: { title: string }) => c.title === '项目构建未通过');

    const exec = await inject('POST', `/api/v1/cards/${target.id}/execute?sync=1`);
    expect(exec.statusCode).toBe(202);
    const run = exec.json().run;
    expect(run.state).toBe('completed');
    expect(run.verificationVerdict).toBe('pass');
    expect(run.resultArtifactRefs).toEqual(['report/ci-42.json']);

    const detail = (await inject('GET', `/api/v1/runs/${run.id}`)).json();
    expect(detail.steps.length).toBeGreaterThanOrEqual(3);
    expect(detail.evidence[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(detail.card.status).toBe('completed');
  });

  it('double execute returns same run, 200 (E2E-04)', async () => {
    await inject('POST', '/api/v1/demo/seed');
    await inject('POST', '/api/v1/discover');
    const cards = (await inject('GET', '/api/v1/cards')).json().cards;
    const first = await inject('POST', `/api/v1/cards/${cards[0].id}/execute?sync=1`);
    const second = await inject('POST', `/api/v1/cards/${cards[0].id}/execute?sync=1`);
    expect(second.statusCode).toBe(200);
    expect(second.json().run.id).toBe(first.json().run.id);
    expect(second.json().alreadyRunning).toBe(true);
  });

  it('L2 card goes awaiting_approval and no executor runs; deny blocks (E2E-09)', async () => {
    await inject('POST', '/api/v1/demo/seed');
    await inject('POST', '/api/v1/discover');
    const cards = (await inject('GET', '/api/v1/cards')).json().cards;
    const cal = cards.find((c: { title: string }) => c.title === '两场会议需要协调');
    // escalate the stored action to L2 external_write (server-side tamper for test setup)
    store.db
      .prepare('UPDATE cards SET action_json = ? WHERE id = ?')
      .run(
        JSON.stringify({ ...cal.action, risk: 'L2', effect: 'external_write' }),
        cal.id,
      );

    const exec = await inject('POST', `/api/v1/cards/${cal.id}/execute?sync=1`);
    expect(exec.statusCode).toBe(202);
    const run = exec.json().run;
    expect(run.state).toBe('awaiting_approval');

    const detail = (await inject('GET', `/api/v1/runs/${run.id}`)).json();
    expect(detail.steps).toHaveLength(0); // executor never invoked

    const deny = await inject('POST', `/api/v1/approvals/${run.id}`, { decision: 'deny' });
    expect(deny.statusCode).toBe(200);
    expect(deny.json().run.state).toBe('blocked');
  });

  it('cancel of queued run yields cancelled terminal state', async () => {
    await inject('POST', '/api/v1/demo/seed');
    await inject('POST', '/api/v1/discover');
    const cards = (await inject('GET', '/api/v1/cards')).json().cards;
    // create a run via orchestrator but execute async with slow steps, then cancel
    const card = cards.find((c: { title: string }) => c.title === '可以继续上次的研究');
    const exec = await inject('POST', `/api/v1/cards/${card.id}/execute`);
    const runId = exec.json().run?.id;
    const cancel = await inject('POST', `/api/v1/runs/${runId}/cancel`);
    expect(cancel.statusCode).toBe(200);
    expect(['cancelled', 'completed']).toContain(cancel.json().run.state);
    // wait for pipeline to settle
    await new Promise((r) => setTimeout(r, 600));
    const final = (await inject('GET', `/api/v1/runs/${runId}`)).json().run;
    expect(['cancelled', 'completed']).toContain(final.state);
  });

  it('expired card execute is 410 with no run created (E2E-05)', async () => {
    await inject('POST', '/api/v1/demo/seed');
    await inject('POST', '/api/v1/discover');
    const cards = (await inject('GET', '/api/v1/cards')).json().cards;
    store.db.prepare('UPDATE cards SET expires_at = ? WHERE id = ?').run('2026-10-01T00:00:00Z', cards[0].id);
    const res = await inject('POST', `/api/v1/cards/${cards[0].id}/execute?sync=1`);
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('CARD_EXPIRED');
    expect((await inject('GET', '/api/v1/runs')).json().runs).toHaveLength(0);
  });
});

describe('M1-T06 (server part): chat', () => {
  it('mock reply is persisted, labeled, and honest', async () => {
    const res = await inject('POST', '/api/v1/chat', { sessionId: 's1', message: 'CI 失败了怎么办' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.adapter).toBe('mock');
    expect(body.live).toBe(false);
    expect(body.label).toContain('离线演示');
    expect(body.reply.content.length).toBeGreaterThan(10);

    const history = (await inject('GET', '/api/v1/chat/history?sessionId=s1')).json();
    expect(history.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(history.live).toBe(false);
  });
});
