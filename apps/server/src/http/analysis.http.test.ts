import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from '../config.js';
import { Storage } from '@hearth/storage';
import { DEFAULT_SETTINGS, type Services } from './services.js';
import { ProjectObserver } from '@hearth/project-observer';
import { AnalysisService, AnalysisStore, MockAnalysisProvider } from '@hearth/project-analysis';
import { createGitRepo } from '../../../../packages/project-observer/src/testkit/git-fixture.js';

let dir: string;
let store: Storage;
let observer: ProjectObserver;
let analysis: AnalysisService;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let cookie: string;
let csrf: string;
const ORIGIN = 'http://127.0.0.1:4317';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-p2a-http-'));
  store = new Storage(path.join(dir, 'app.sqlite'));
  observer = new ProjectObserver({ dbPath: path.join(dir, 'observer.sqlite'), watchEnabled: false });
  const analysisStore = new AnalysisStore(path.join(dir, 'analysis.sqlite'));
  analysis = new AnalysisService({ observer, store: analysisStore, provider: new MockAnalysisProvider() });
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
  app = buildApp({ config, storage: store, services, observer, analysis });
  store.setSetting('settings', DEFAULT_SETTINGS);
  const sessionRes = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  const rawCookie = sessionRes.headers['set-cookie'];
  const first = Array.isArray(rawCookie) ? rawCookie[0] : String(rawCookie);
  cookie = first.split(';')[0]!;
  csrf = (sessionRes.json() as { csrfToken: string }).csrfToken;
});

afterEach(async () => {
  analysis.close();
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

describe('analysis HTTP', () => {
  it('requires session and does not analyze on GET', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/analysis/runs?projectId=prj_x' })).statusCode).toBe(401);
    const listed = await inject('GET', '/api/v1/analysis/runs?projectId=prj_missingmissing1');
    expect(listed.statusCode).toBe(200);
    expect(listed.json().runs).toEqual([]);
  });

  it('starts a mock analysis and returns a card with evidence', async () => {
    const repo = await createGitRepo(dir, 'app', { commit: true, files: { 'README.md': '# App\n' } });
    const project = await observer.registerProject(repo, { name: 'app' });
    const created = await inject('POST', '/api/v1/analysis/runs', {
      projectId: project.id,
      trigger: 'observe',
    });
    expect(created.statusCode).toBe(201);
    const run = created.json().run;
    expect(run.status).toBe('succeeded');
    expect(run.recommendation.findings.length).toBeGreaterThan(0);
    expect(run.recommendation.statusSummary.includes('不能当作测试通过')).toBe(true);
    expect(run.recommendation.statusSummary.includes('测试全部通过')).toBe(false);
    const listed = await inject('GET', `/api/v1/analysis/runs?projectId=${project.id}`);
    expect(listed.json().runs).toHaveLength(1);
    const detail = await inject('GET', `/api/v1/analysis/runs/${run.id}`);
    expect(detail.json().run.id).toBe(run.id);
    const feedback = await inject('POST', `/api/v1/analysis/runs/${run.id}/feedback`, { kind: 'useful' });
    expect(feedback.statusCode).toBe(200);
    const bad = await inject('POST', `/api/v1/analysis/runs/${run.id}/feedback`, { kind: 'love' });
    expect(bad.statusCode).toBe(400);
  });
});
