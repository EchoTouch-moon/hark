import { buildApp, type AppDeps } from './http/app.js';
import { loadConfig } from './config.js';
import { Storage } from '@hearth/storage';
import { DiscoveryService, Orchestrator } from '@hearth/core';
import { MockAgentAdapter } from '@hearth/agent-adapters';
import { FixtureConnector } from '@hearth/connectors';
import { existsSync } from 'node:fs';
import { readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SETTINGS } from './http/services.js';

export async function startServer(overrides: Partial<Parameters<typeof loadConfig>[0]> = {}) {
  const config = loadConfig(overrides);
  const storage = new Storage(config.dbPath);

  // ensure settings defaults exist
  if (storage.getSetting('settings') === null) storage.setSetting('settings', DEFAULT_SETTINGS);

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

  const deps: AppDeps = {
    config,
    storage,
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
  // empty shell (E2E disables this via HEARTH_AUTOSEED=0 to test the empty state)
  if (config.demoMode && storage.listProjects().length === 0 && process.env['HEARTH_AUTOSEED'] !== '0') {
    await deps.services.seedDemo();
    await discovery.discover();
  }

  // S09: reconcile interrupted runs before serving traffic (never blindly re-execute)
  const recovered = await orchestrator.recoverInterrupted();
  if (recovered.length > 0) {
    console.log(`[hearth-server] recovered ${recovered.length} interrupted run(s)`);
  }

  const app = buildApp(deps);

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
      const rel = req.url === '/' ? 'index.html' : (req.url.split('?')[0] ?? req.url).replace(/^\//, '');
      const abs = path.resolve(root, rel);
      if (!abs.startsWith(path.resolve(root)) || !existsSync(abs)) {
        return reply.type('text/html').send(await fsReadFile(path.join(root, 'index.html')));
      }
      return reply.type(mime[path.extname(abs)] ?? 'application/octet-stream').send(await fsReadFile(abs));
    });
  }

  await app.listen({ host: config.host, port: config.port });
  return { app, config, storage, orchestrator, discovery };
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
