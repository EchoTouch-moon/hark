import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig, type ServerConfig } from '../config.js';
import { Storage } from '@hearth/storage';
import { DEFAULT_SETTINGS, type Services } from './services.js';
import { ProjectObserver } from '@hearth/project-observer';
import { HearthViewModel } from '@hearth/hearth-contract';
import { createGitRepo } from '../../../../packages/project-observer/src/testkit/git-fixture.js';
import { buildObserveView } from './hearth/observe-view.js';

/** 任何访问都抛错并计数：证明观察接口不触达研究 / 模型 / 卡片服务 */
const touched: string[] = [];
function forbidden<T>(name: string): T {
  return new Proxy({}, {
    get(_t, prop) {
      touched.push(`${name}.${String(prop)}`);
      throw new Error(`${name} must not be touched by observe`);
    },
  }) as T;
}

let dir: string;
let store: Storage;
let observer: ProjectObserver;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let cookie: string;

async function setup(over: Partial<ServerConfig>, withObserver = true) {
  const config = loadConfig({
    dbPath: path.join(dir, 'app.sqlite'),
    observerDbPath: path.join(dir, 'observer.sqlite'),
    artifactRoot: path.join(dir, 'artifacts'),
    staticDir: null,
    ...over,
  });
  const services: Services = {
    discovery: forbidden('discovery'),
    orchestrator: forbidden('orchestrator'),
    chat: forbidden('chat'),
    seedDemo: async () => { touched.push('seedDemo'); return { eventsIngested: 0 }; },
  };
  app = buildApp({
    config, storage: store, services,
    ...(withObserver ? { observer } : {}),
    insight: forbidden('insight'),
    analysis: forbidden('analysis'),
    coordinator: forbidden('coordinator'),
  });
  store.setSetting('settings', DEFAULT_SETTINGS);
  const res = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  const raw = res.headers['set-cookie'];
  cookie = (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0]!;
}

const OBSERVE_ON = { hearthPermissions: { observe: true, research: false, model: false } };

async function get(url: string) {
  const setSpy = vi.spyOn(store, 'setSetting');
  const res = await app.inject({ method: 'GET', url, headers: { cookie } });
  expect(setSpy).not.toHaveBeenCalled(); // 不写任何持久状态
  setSpy.mockRestore();
  expect(touched).toEqual([]);
  return { status: res.statusCode as number, body: HearthViewModel.parse(res.json()) };
}

beforeEach(async () => {
  touched.length = 0;
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-observe-http-'));
  store = new Storage(path.join(dir, 'app.sqlite'));
  observer = new ProjectObserver({ dbPath: path.join(dir, 'observer.sqlite'), watchEnabled: false });
});

afterEach(async () => {
  observer.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('GET /api/v1/hearth', () => {
  it('defaults to observe=false → 403 permission_denied', async () => {
    await setup({});
    const { status, body } = await get('/api/v1/hearth');
    expect(status).toBe(403);
    expect(body.status).toBe('permission_denied');
    expect(body.permissions).toEqual({ observe: false, research: false, model: false, execute: false });
    expect(body.mode).toBe('real');
  });

  it('checks permission before touching the observer', async () => {
    await setup({});
    const spy = vi.spyOn(observer, 'listProjects');
    const { status, body } = await get('/api/v1/hearth?scope=project&projectId=%3Cscript%3E');
    expect(status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
    expect(body.scope).toEqual({ kind: 'global' });
    expect(JSON.stringify(body)).not.toContain('<script>');
  });

  it('empty when no projects', async () => {
    await setup(OBSERVE_ON);
    const { status, body } = await get('/api/v1/hearth');
    expect(status).toBe(200);
    expect(body.status).toBe('empty');
    expect(body.narrative.flame.level).toBe('neutral');
  });

  it('ok + fresh for a just-observed project, execute stays false', async () => {
    await setup(OBSERVE_ON);
    const repo = await createGitRepo(dir, 'repo-a');
    const p = await observer.registerProject(repo, { name: 'Repo A' });
    const { status, body } = await get(`/api/v1/hearth?scope=project&projectId=${p.id}`);
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.observationFreshness).toBe('fresh');
    expect(body.scope).toEqual({ kind: 'project', projectId: p.id, title: 'Repo A' });
    expect(body.permissions.execute).toBe(false);
    expect(body.narrative.story[0]?.evidence[0]?.kind).toBe('observer');
    expect(body.featuredOpinion).toBeNull();
  });

  it('stale observation → ok + stale', async () => {
    await setup({ ...OBSERVE_ON, observeStaleMs: -1 });
    const repo = await createGitRepo(dir, 'repo-b');
    await observer.registerProject(repo, { name: 'Repo B' });
    const { status, body } = await get('/api/v1/hearth?scope=global');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.observationFreshness).toBe('stale');
    expect(body.narrative.flame.reason).toContain('Repo B');
  });

  it('observer failure → 503 error, never fixture data', async () => {
    await setup(OBSERVE_ON);
    vi.spyOn(observer, 'listProjects').mockImplementation(() => { throw new Error('db gone'); });
    const { status, body } = await get('/api/v1/hearth');
    expect(status).toBe(503);
    expect(body.status).toBe('error');
    if (body.status === 'error') expect(body.error.code).toBe('observer_unavailable');
    expect(body.narrative.story).toEqual([]);
  });

  it('observer not configured → 503 error', async () => {
    await setup(OBSERVE_ON, false);
    const { status, body } = await get('/api/v1/hearth');
    expect(status).toBe(503);
    expect(body.status).toBe('error');
  });

  it('unknown project → 404 error; bad query → 400 error', async () => {
    await setup(OBSERVE_ON);
    expect((await get('/api/v1/hearth?scope=project&projectId=nope')).status).toBe(404);
    const spy = vi.spyOn(observer, 'listProjects');
    const bad = await get('/api/v1/hearth?scope=project');
    expect(spy).not.toHaveBeenCalled();
    expect(bad.status).toBe(400);
    expect(bad.body.status).toBe('error');
  });
});

describe('buildObserveView (pure)', () => {
  it('only reads through the port and never mutates input', () => {
    const port = { listProjects: vi.fn(() => []), getObserverHealth: vi.fn() };
    const input = { permissions: { observe: true, research: true, model: true }, scope: { kind: 'global' } as const, port, now: new Date(), staleMs: 1000 };
    const frozen = JSON.stringify(input.permissions);
    const r = buildObserveView(input);
    expect(HearthViewModel.parse(r.view).status).toBe('empty');
    expect(JSON.stringify(input.permissions)).toBe(frozen);
    expect(port.listProjects).toHaveBeenCalledTimes(1);
  });
});
