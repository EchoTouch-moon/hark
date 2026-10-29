import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from '../config.js';
import { Storage } from '@hearth/storage';
import { DEFAULT_SETTINGS, type Services } from './services.js';
import { ProjectObserver } from '@hearth/project-observer';
import { EXTRACTOR_VERSION, InsightStore, processProjectRules } from '@hearth/project-insight';
import { makeSignal, testFailSignal } from '../../../../packages/project-insight/src/insights/fixtures.js';
import { createGitRepo } from '../../../../packages/project-observer/src/testkit/git-fixture.js';
import { OverviewResponseSchema, type OverviewResponse } from '@hearth/contracts';

let dir: string;
let store: Storage;
let observer: ProjectObserver;
let insight: InsightStore;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let cookie: string;
let csrf: string;
const ORIGIN = 'http://127.0.0.1:4317';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-overview-http-'));
  store = new Storage(path.join(dir, 'app.sqlite'));
  observer = new ProjectObserver({
    dbPath: path.join(dir, 'observer.sqlite'),
    watchEnabled: false,
  });
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

  app = buildApp({ config, storage: store, services, observer, insight });
  store.setSetting('settings', DEFAULT_SETTINGS);

  const sessionRes = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  const rawCookie = sessionRes.headers['set-cookie'];
  const first = Array.isArray(rawCookie) ? rawCookie[0] : String(rawCookie);
  cookie = first.split(';')[0]!;
  csrf = (sessionRes.json() as { csrfToken: string }).csrfToken;
});

afterEach(async () => {
  insight.close();
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

describe('GET /api/v1/overview', () => {
  it('returns empty overview when no projects are registered', async () => {
    const res = await inject('GET', '/api/v1/overview');
    expect(res.statusCode).toBe(200);
    const body = OverviewResponseSchema.parse(res.json());

    expect(body.summary.status).toBe('NO_PROJECTS');
    expect(body.summary.headline).toBe('未登记项目');
    expect(body.projects).toHaveLength(0);
    expect(body.prioritizedInsights.items).toHaveLength(0);
    expect(body.recentObservations.events).toHaveLength(0);
    expect(body.sectionsAvailability.projects).toBe('AVAILABLE');
    expect(body.sectionsAvailability.insights).toBe('AVAILABLE');
    expect(body.sectionsAvailability.observations).toBe('AVAILABLE');
  });

  it('aggregates prioritized insights (max 3, severity sorted) and recent bounded observations', async () => {
    // 注册项目
    const repoDir = await createGitRepo(dir, 'sample-repo');
    await observer.registerProject(repoDir, { name: 'Alpha Project' });
    const projects = observer.listProjects();
    const projId = projects[0]!.id;

    // 录入 5 条不同级别的洞察
    for (let i = 1; i <= 5; i++) {
      const sig = makeSignal({
        ...testFailSignal(),
        projectId: projId,
        signalKey: `sig_${i}_${Date.now()}`,
        sourceEventIds: [`evt_${i}`],
        evidenceRefs: [
          {
            kind: 'observer_event',
            projectId: projId,
            id: `evt_${i}`,
            observedAt: `2026-10-29T10:0${i}:00.000Z`,
            quality: 'OBSERVED',
            role: 'trigger',
          },
        ],
      });
      insight.commitSignalBatch({
        projectId: projId,
        streamEpoch: 1,
        expectedRevision: i - 1,
        batch: {
          signals: [sig],
          proposedCursor: { afterSeq: i, streamEpoch: 1 },
          highWatermark: i,
          outcome: 'OK',
          hasMore: false,
          legacyOrderReconstructed: false,
          extractorVersion: EXTRACTOR_VERSION,
          eventsRead: 1,
        },
      });
    }
    processProjectRules(insight, { projectId: projId, streamEpoch: 1, baseline: 'none' });

    // 触发概览聚合
    const res = await inject('GET', '/api/v1/overview');
    expect(res.statusCode).toBe(200);
    const body: OverviewResponse = OverviewResponseSchema.parse(res.json());

    expect(body.summary.status).toBe('ATTENTION_NEEDED');
    expect(body.prioritizedInsights.items.length).toBeLessThanOrEqual(3);
    expect(body.prioritizedInsights.totalOpenCount).toBeGreaterThanOrEqual(1);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]!.name).toBe('Alpha Project');
    expect(body.projects[0]!.testStatus).toBe('NOT_CONFIGURED'); // 未声明 JUnit 报告
  });

  it('determines summary status accurately: NO_SIGNALS, ALL_CLEAR, and PAUSED', async () => {
    // 1. 注册无事件项目 -> NO_SIGNALS
    const repoA = await createGitRepo(dir, 'repo-a');
    await observer.registerProject(repoA, { name: 'Repo A' });

    let res = await inject('GET', '/api/v1/overview');
    expect(res.statusCode).toBe(200);
    let body = OverviewResponseSchema.parse(res.json());
    expect(body.summary.status).toBe('NO_SIGNALS');
    expect(body.summary.headline).toBe('尚无可评估信号');

    // 2. 暂停项目 -> PAUSED
    const project = observer.listProjects()[0]!;
    await observer.setProjectEnabled(project.id, false);

    res = await inject('GET', '/api/v1/overview');
    expect(res.statusCode).toBe(200);
    body = OverviewResponseSchema.parse(res.json());
    expect(body.summary.status).toBe('PAUSED');
    expect(body.summary.headline).toBe('项目观察已暂停');
  });

  it('bounds observations to 10 latest events in descending order', async () => {
    const repoB = await createGitRepo(dir, 'repo-b');
    const project = await observer.registerProject(repoB, { name: 'Repo B' });

    // listRecentEvents 返回有界记录
    const res = await inject('GET', `/api/v1/overview?projectId=${project.id}`);
    expect(res.statusCode).toBe(200);
    const body = OverviewResponseSchema.parse(res.json());
    expect(body.recentObservations.events.length).toBeLessThanOrEqual(10);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]!.id).toBe(project.id);
  });

  it('supports projectId filtering and partial failure degradation without 500', async () => {
    // 模拟关闭 insight 实例引发降级
    insight.close();

    const res = await inject('GET', '/api/v1/overview');
    expect(res.statusCode).toBe(200);
    const body = OverviewResponseSchema.parse(res.json());

    // 洞察区块标记 DEGRADED，成功区块保持可用
    expect(body.sectionsAvailability.insights).toBe('DEGRADED');
    expect(body.sectionsAvailability.projects).toBe('AVAILABLE');
    expect(body.summary.status).toBe('DEGRADED');
  });
});
