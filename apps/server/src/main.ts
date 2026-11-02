/**
 * @fileoverview 服务端启动主入口（Server Entrypoint）
 *
 * 启动步骤：
 * 1. 初始化持久化存储 Storage 并自动执行版本化迁移
 * 2. 组装 Orchestrator、DiscoveryService、MockAgentAdapter 与 ProjectObserver
 * 3. 首次启动自动导入 Demo Fixture 数据（如启用了 HEARTH_DEMO）
 * 4. 崩溃恢复（S09）：启动前对所有中断在 executing / verifying 状态的任务对账恢复
 * 5. 挂载 Single Page Application 静态文件代理与 API 路由
 */

import { buildApp, type AppDeps } from './http/app.js';
import { loadConfig } from './config.js';
import { Storage } from '@hearth/storage';
import { DiscoveryService, Orchestrator } from '@hearth/core';
import { MockAgentAdapter } from '@hearth/agent-adapters';
import { FixtureConnector } from '@hearth/connectors';
import { ProjectObserver } from '@hearth/project-observer';
import { InsightStore, InsightCoordinator, InProcessObserverReadPort, defaultInsightDbPath } from '@hearth/project-insight';
import {
  AnalysisService,
  AnalysisStore,
  MockAnalysisProvider,
  PiAnalysisProvider,
  defaultAnalysisDbPath,
} from '@hearth/project-analysis';
import { existsSync, statSync } from 'node:fs';
import { readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SETTINGS } from './http/services.js';

/**
 * 启动 Hearth 后端 HTTP 服务
 * @param overrides 可选配置覆盖项
 */
export async function startServer(overrides: Partial<Parameters<typeof loadConfig>[0]> = {}) {
  const config = loadConfig(overrides);
  const storage = new Storage(config.dbPath);

  // ensure settings defaults exist
  if (storage.getSetting('settings') === null) storage.setSetting('settings', {...DEFAULT_SETTINGS, demoMode: config.demoMode});

  const orchestrator = new Orchestrator({
    storage,
    artifactRoot: config.artifactRoot,
    clock: () => new Date().toISOString(),
    stepDelayMs: Number(process.env['HEARTH_STEP_DELAY_MS'] ?? 120),
  });
  const suppressionForDiscovery = () => {
    const s = storage.getSetting<{ quietHours: { start: string; end: string }; maxCardsPerDay: number; timezone?: string }>('settings');
    return {
      quietHours: { ...(s?.quietHours ?? { start: '22:00', end: '08:00' }), timezone: s?.timezone ?? 'Asia/Shanghai' },
      maxCardsPerDay: s?.maxCardsPerDay ?? 3,
      dismissCooldownHours: 72,
    };
  };
  const discovery = new DiscoveryService({
    storage,
    clock: () => new Date().toISOString(),
    get suppression() {
      return suppressionForDiscovery();
    },
  });
  const chat = new MockAgentAdapter();
  const connector = new FixtureConnector(config.repoRoot);

  const observer = new ProjectObserver({
    dbPath: config.observerDbPath,
    watchEnabled: process.env['HEARTH_OBSERVER_WATCH'] !== '0',
  });
  const insight = new InsightStore(defaultInsightDbPath(config.repoRoot));
  const analysisStore = new AnalysisStore(defaultAnalysisDbPath(config.repoRoot));
  const analysisProvider =
    (process.env['HEARTH_ANALYSIS_PROVIDER'] ?? 'mock') === 'pi'
      ? new PiAnalysisProvider()
      : new MockAnalysisProvider();
  const analysis = new AnalysisService({ observer, insight, store: analysisStore, provider: analysisProvider });

  analysis.recoverInterrupted();
  await analysis.recoverDeletions();

  const coordinator = new InsightCoordinator({
    store: insight, port: new InProcessObserverReadPort(observer),
    projectIds: () => observer.listProjects().filter(project => project.enabled).map(project => project.id),
  });
  const deps: AppDeps = {
    config,
    storage,
    observer,
    insight,
    analysis,
    coordinator,
    services: {
      discovery,
      orchestrator,
      chat,
      seedDemo: async () => {
        const projects = connector.loadProjects();
        storage.seedProjects(projects);
        let n = 0;
        for (const { event, meta } of connector.loadEvents()) {
          if (storage.ingestEvent(event, { goldenAction: meta.goldenAction, goldenUseful: meta.goldenUseful }).inserted) n += 1;
        }
        return { eventsIngested: n };
      },
    },
  };

  // first-run convenience: seed demo data automatically so Home is never an
  // empty shell (E2E disables this via HEARTH_AUTOSEED=0 to test the empty state).
  // First boot counts as a user action: quiet hours govern background scans,
  // not the explicit moment the user set the system up (docs/02 first-run matrix).
  if (config.demoMode === true && storage.listProjects().length === 0 && process.env['HEARTH_AUTOSEED'] !== '0') {
    await deps.services.seedDemo();
    await discovery.discover({ userInitiated: true });
  }

  // S09: reconcile interrupted runs before serving traffic (never blindly re-execute)
  const recovered = await orchestrator.recoverInterrupted();
  if (recovered.length > 0) {
    console.log(`[hearth-server] recovered ${recovered.length} interrupted run(s)`);
  }

  const app = buildApp(deps);
  app.addHook('onClose', async () => {
    await coordinator.stop();
    await analysis.shutdown();
    await observer.stop();
    observer.close();
    insight.close();

  });

  // serve the built SPA when present (same-origin for E2E/demo)
  if (config.staticDir && existsSync(path.join(config.staticDir, 'index.html'))) {
    const root: string = config.staticDir;
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
    };
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'no such api route' } });
      }
      const pathname = (req.url.split('?')[0] ?? req.url).replace(/^\//, '');
      const rel = pathname === '' ? 'index.html' : pathname;
      const abs = path.resolve(root, rel);
      if (!abs.startsWith(path.resolve(root)) || !existsSync(abs) || statSync(abs).isDirectory()) {
        return reply.type('text/html').send(await fsReadFile(path.join(root, 'index.html')));
      }
      return reply.type(mime[path.extname(abs)] ?? 'application/octet-stream').send(await fsReadFile(abs));
    });
  }

  await app.listen({ host: config.host, port: config.port });
  void observer.start().catch((cause) => {
    console.error('[hearth-server] observer start failed:', cause);
  });
  coordinator.start();
  return { app, config, storage, orchestrator, discovery, observer, coordinator };
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith('main.ts')) {
  startServer()
    .then(({ config }) => console.log(`[hearth-server] listening on http://${config.host}:${config.port} (demo=${config.demoMode})`))
    .catch((err) => {
      console.error('[hearth-server] failed to start:', err);
      process.exit(1);
    });
}
