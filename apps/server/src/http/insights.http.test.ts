import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from '../config.js';
import { Storage } from '@hearth/storage';
import { DEFAULT_SETTINGS, type Services } from './services.js';
import { EXTRACTOR_VERSION, InsightStore, processProjectRules } from '@hearth/project-insight';
import { makeSignal, testFailSignal } from '../../../../packages/project-insight/src/insights/fixtures.js';

let dir: string;
let store: Storage;
let insight: InsightStore;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let cookie: string;
let csrf: string;
const ORIGIN = 'http://127.0.0.1:4317';
const PROJECT = 'prj_aaaaaaaaaaaaaaaa';
const PROJECT_B = 'prj_bbbbbbbbbbbbbbbb';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-ins-http-'));
  store = new Storage(path.join(dir, 'app.sqlite'));
  insight = new InsightStore(path.join(dir, 'insights.sqlite'), { skipWriterLock: true });
  const config = loadConfig({
    dbPath: path.join(dir, 'app.sqlite'),
    observerDbPath: path.join(dir, 'observer.sqlite'),
    artifactRoot: path.join(dir, 'artifacts'),
    staticDir: null,
  });
  const services: Services = {
    discovery: {} as Services['discovery'],
    orchestrator: {} as Services['orchestrator'],
    chat: {} as Services['chat'],
    seedDemo: async () => ({ eventsIngested: 0 }),
  };
  app = buildApp({ config, storage: store, services, insight });
  store.setSetting('settings', DEFAULT_SETTINGS);
  const sessionRes = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  const rawCookie = sessionRes.headers['set-cookie'];
  const first = Array.isArray(rawCookie) ? rawCookie[0] : String(rawCookie);
  cookie = first.split(';')[0]!;
  csrf = (sessionRes.json() as { csrfToken: string }).csrfToken;
});

afterEach(async () => {
  insight.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
});

function inject(method: string, url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    ...(body === undefined ? {} : { payload: body }),
    headers: { cookie, 'x-csrf-token': csrf, origin: ORIGIN },
  });
}

function seedFailure(projectId = PROJECT, eventId = 'evt_aaaaaaaaaaaaaaaa', signalKey = 'b'.repeat(64)): void {
  const signal = makeSignal({
    ...testFailSignal(),
    projectId,
    signalKey,
    sourceEventIds: [eventId],
    evidenceRefs: [
      {
        kind: 'observer_event',
        projectId,
        id: eventId,
        observedAt: '2026-10-28T10:00:00.000Z',
        quality: 'OBSERVED',
        role: 'trigger',
      },
    ],
  });
  insight.commitSignalBatch({
    projectId,
    streamEpoch: 1,
    expectedRevision: 0,
    batch: {
      signals: [signal],
      proposedCursor: { afterSeq: signal.appendSeq ?? 2, streamEpoch: 1 },
      highWatermark: 2,
      outcome: 'OK',
      hasMore: false,
      legacyOrderReconstructed: false,
      extractorVersion: EXTRACTOR_VERSION,
      eventsRead: 1,
    },
  });
  processProjectRules(insight, { projectId, streamEpoch: 1, baseline: 'none' });
}

describe('insight HTTP', () => {
  it('requires session and csrf', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/insights' })).statusCode).toBe(401);
    seedFailure();
    const id = (await inject('GET', '/api/v1/insights')).json().items[0].id as string;
    const noCsrf = await app.inject({
      method: 'POST',
      url: `/api/v1/insights/${id}/dismiss`,
      payload: {},
      headers: { cookie, origin: ORIGIN },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('lists an empty feed without fake cards and without writes', async () => {
    const before = insight.db.prepare('SELECT COUNT(*) AS n FROM insight_rule_progress').get() as { n: number };
    const res = await inject('GET', '/api/v1/insights');
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
    expect(res.json().nextCursor).toBeNull();
    const after = insight.db.prepare('SELECT COUNT(*) AS n FROM insight_rule_progress').get() as { n: number };
    expect(after.n).toBe(before.n);
    const summary = (await inject('GET', '/api/v1/insights/summary')).json();
    expect(summary.engineHealth).toBe('NOT_EVALUATED');
    expect(summary.openCount).toBe(0);
  });

  it('returns 503 when the insight store is not configured', async () => {
    const config = loadConfig({
      dbPath: path.join(dir, 'app.sqlite'),
      observerDbPath: path.join(dir, 'observer.sqlite'),
      artifactRoot: path.join(dir, 'artifacts'),
      staticDir: null,
    });
    const bare = buildApp({
      config,
      storage: store,
      services: {
        discovery: {} as Services['discovery'],
        orchestrator: {} as Services['orchestrator'],
        chat: {} as Services['chat'],
        seedDemo: async () => ({ eventsIngested: 0 }),
      },
    });
    const sessionRes = await bare.inject({ method: 'GET', url: '/api/v1/auth/session' });
    const rawCookie = sessionRes.headers['set-cookie'];
    const first = (Array.isArray(rawCookie) ? rawCookie[0] : String(rawCookie)) ?? '';
    const res = await bare.inject({
      method: 'GET',
      url: '/api/v1/insights',
      headers: { cookie: first.split(';')[0]!, origin: ORIGIN },
    });
    expect(res.statusCode).toBe(503);
  });

  it('returns feed, detail, observe href, and stable pagination', async () => {
    seedFailure();
    seedFailure(PROJECT_B, 'evt_bbbbbbbbbbbbbbbb', '1'.repeat(64));
    const list = await inject('GET', '/api/v1/insights');
    expect(list.json().items).toHaveLength(2);
    const ids = (list.json().items as Array<{ id: string }>).map((item) => item.id);
    expect(new Set(ids).size).toBe(2);
    const item = list.json().items[0];
    expect(item.headBinding).toBe('UNDETERMINED');
    expect(String(item.summary).toLowerCase().includes('regression')).toBe(false);
    const detail = await inject('GET', `/api/v1/insights/${item.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().insight.observeHref).toBe(`/observe/${item.projectId}`);
    expect(detail.json().insight.reasonCodes).toEqual(['junit_failures_gt_0']);
    expect(JSON.stringify(detail.json()).includes('/Users/')).toBe(false);
    const missing = await inject('GET', '/api/v1/insights/ins_missingmissing1');
    expect(missing.statusCode).toBe(404);
    const page = await inject('GET', '/api/v1/insights?limit=1');
    expect(page.json().items).toHaveLength(1);
    expect(page.json().nextCursor).toBeTypeOf('string');
    const page2 = await inject('GET', `/api/v1/insights?limit=1&cursor=${encodeURIComponent(page.json().nextCursor)}`);
    expect(page2.json().items[0].id).not.toBe(page.json().items[0].id);
    const policy = await inject('GET', '/api/v1/insights/policy');
    expect(policy.json().rules['R-TEST-EVIDENCE-GAP'].enabled).toBe(false);
    const badCursor = await inject('GET', '/api/v1/insights?cursor=nope');
    expect(badCursor.statusCode).toBe(400);
    const badStatus = await inject('GET', '/api/v1/insights?status=LOVE');
    expect(badStatus.statusCode).toBe(400);
  });

  it('acknowledge is not resolved; dismiss hides from default feed; feedback is idempotent', async () => {
    seedFailure();
    const id = (await inject('GET', '/api/v1/insights')).json().items[0].id as string;
    const beforeWrite = insight.db.prepare('SELECT COUNT(*) AS n FROM insight_feedback').get() as { n: number };
    const read = await inject('GET', `/api/v1/insights/${id}`);
    expect(read.statusCode).toBe(200);
    expect((insight.db.prepare('SELECT COUNT(*) AS n FROM insight_feedback').get() as { n: number }).n).toBe(beforeWrite.n);
    const ack = await inject('POST', `/api/v1/insights/${id}/acknowledge`, {});
    expect(ack.json().status).toBe('ACKNOWLEDGED');
    const ack2 = await inject('POST', `/api/v1/insights/${id}/acknowledge`, {});
    expect(ack2.json().status).toBe('ACKNOWLEDGED');
    expect((await inject('GET', `/api/v1/insights/${id}`)).json().insight.status).toBe('ACKNOWLEDGED');
    const useful = await inject('POST', `/api/v1/insights/${id}/feedback`, { kind: 'useful' });
    expect(useful.json().kind).toBe('useful');
    const useful2 = await inject('POST', `/api/v1/insights/${id}/feedback`, { kind: 'useful' });
    expect(useful2.json().kind).toBe('useful');
    const flip = await inject('POST', `/api/v1/insights/${id}/feedback`, { kind: 'not_useful' });
    expect(flip.json().kind).toBe('not_useful');
    expect((await inject('GET', `/api/v1/insights/${id}`)).json().insight.status).toBe('ACKNOWLEDGED');
    const evidence = insight.db.prepare('SELECT COUNT(*) AS n FROM insight_evidence_refs WHERE insight_id = ?').get(id) as {
      n: number;
    };
    const dismissed = await inject('POST', `/api/v1/insights/${id}/dismiss`, {});
    expect(dismissed.json().status).toBe('DISMISSED');
    expect((await inject('GET', '/api/v1/insights')).json().items).toEqual([]);
    expect((await inject('GET', '/api/v1/insights?status=DISMISSED')).json().items[0].id).toBe(id);
    expect((insight.db.prepare('SELECT COUNT(*) AS n FROM insight_evidence_refs WHERE insight_id = ?').get(id) as { n: number }).n).toBe(
      evidence.n,
    );
    const bad = await inject('POST', `/api/v1/insights/${id}/feedback`, { kind: 'love-it' });
    expect(bad.statusCode).toBe(400);
    const missing = await inject('POST', '/api/v1/insights/ins_missingmissing1/feedback', { kind: 'useful' });
    expect(missing.statusCode).toBe(404);
  });

  it('reports missing evidence instead of available after inbox deletion', async () => {
    seedFailure();
    const id = (await inject('GET', '/api/v1/insights')).json().items[0].id as string;
    insight.db.prepare('DELETE FROM signal_inbox').run();
    const detail = (await inject('GET', `/api/v1/insights/${id}`)).json().insight;
    expect(detail.evidenceAvailability).toBe('MISSING');
  });
});
