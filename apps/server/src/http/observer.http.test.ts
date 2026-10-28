import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from '../config.js';
import { Storage } from '@hearth/storage';
import { DiscoveryService, Orchestrator } from '@hearth/core';
import { MockAgentAdapter } from '@hearth/agent-adapters';
import { DEFAULT_SETTINGS, type Services } from './services.js';
import { ProjectObserver } from '@hearth/project-observer';
import { createGitRepo } from '../../../../packages/project-observer/src/testkit/git-fixture.js';

let dir: string;
let store: Storage;
let observer: ProjectObserver;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let cookie: string;
let csrf: string;
const ORIGIN = 'http://127.0.0.1:4317';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-obs-http-'));
  store = new Storage(path.join(dir, 'app.sqlite'));
  observer = new ProjectObserver({
    dbPath: path.join(dir, 'observer.sqlite'),
    watchEnabled: false,
  });
  const config = loadConfig({
    dbPath: path.join(dir, 'app.sqlite'),
    observerDbPath: path.join(dir, 'observer.sqlite'),
    artifactRoot: path.join(dir, 'artifacts'),
    staticDir: null,
  });
  const services: Services = {
    discovery: new DiscoveryService({ storage: store, clock: () => '2026-10-28T12:00:00.000Z' }),
    orchestrator: new Orchestrator({
      storage: store,
      artifactRoot: config.artifactRoot,
      clock: () => '2026-10-28T12:00:00.000Z',
      stepDelayMs: 0,
    }),
    chat: new MockAgentAdapter(),
    seedDemo: async () => ({ eventsIngested: 0 }),
  };
  app = buildApp({ config, storage: store, services, observer });
  store.setSetting('settings', DEFAULT_SETTINGS);
  const sessionRes = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  const rawCookie = sessionRes.headers['set-cookie'];
  const first = Array.isArray(rawCookie) ? rawCookie[0] : String(rawCookie);
  cookie = first.split(';')[0]!;
  csrf = (sessionRes.json() as { csrfToken: string }).csrfToken;
});

afterEach(async () => {
  await observer.stop();
  observer.close();
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

describe('observer HTTP', () => {
  it('requires session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/observer/projects' });
    expect(res.statusCode).toBe(401);
  });

  it('registers, lists, scans, and never infers PASS without a report', async () => {
    const repo = await createGitRepo(dir, 'api-repo');
    const created = await inject('POST', '/api/v1/observer/projects', {
      localPath: repo,
      name: 'API Repo',
      confirm: true,
    });
    expect(created.statusCode).toBe(201);
    const projectId = created.json().project.id as string;
    const list = await inject('GET', '/api/v1/observer/projects');
    expect(list.json().projects).toHaveLength(1);
    const detail = await inject('GET', `/api/v1/observer/projects/${projectId}`);
    expect(detail.json().snapshot.test.result).toBe('UNKNOWN');
    const events = await inject('GET', `/api/v1/observer/projects/${projectId}/events`);
    expect(events.json().events[0].type).toBe('PROJECT_REGISTERED');
    const scanned = await inject('POST', `/api/v1/observer/projects/${projectId}/scan`, {});
    expect(scanned.statusCode).toBe(200);
    await inject('POST', `/api/v1/observer/projects/${projectId}/enabled`, { enabled: false });
    expect((await inject('GET', `/api/v1/observer/projects/${projectId}`)).json().project.enabled).toBe(false);
  });

  it('SE-07 write without session or csrf is rejected', async () => {
    const repo = await createGitRepo(dir, 'csrf');
    const noAuth = await app.inject({
      method: 'POST',
      url: '/api/v1/observer/projects',
      payload: { localPath: repo, confirm: true },
      headers: { origin: ORIGIN },
    });
    expect(noAuth.statusCode).toBe(401);
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/observer/projects',
      payload: { localPath: repo, confirm: true },
      headers: { cookie, origin: ORIGIN },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('rejects unconfirmed registration', async () => {
    const repo = await createGitRepo(dir, 'no-confirm');
    const res = await inject('POST', '/api/v1/observer/projects', { localPath: repo });
    expect(res.statusCode).toBe(400);
  });
});
