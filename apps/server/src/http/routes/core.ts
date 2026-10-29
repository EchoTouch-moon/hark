import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FixtureConnector } from '@hearth/connectors';
import { DEFAULT_SETTINGS, SettingsDtoSchema, type SettingsDto } from '../services.js';
import type { AppDeps } from '../app.js';
import type { SessionManager } from '../session.js';

const SETTINGS_KEY = 'settings';

export function registerCoreRoutes(app: FastifyInstance, deps: AppDeps, sessions: SessionManager): void {
  app.get('/api/v1/health', async (_req, reply) => {
    let db = 'ok';
    try {
      deps.storage.listProjects();
    } catch {
      db = 'error';
    }
    return reply.send({
      status: 'ok',
      db,
      demoMode: deps.config.demoMode,
      provider: 'mock', // Legacy chat identity, retained for compatibility.
      chatProvider: 'mock',
      analysisProvider: deps.analysis?.identity() ?? null,
      insightCoordinator: deps.coordinator?.health() ?? null,
      version: '0.1.0',
      contractVersion: '1',
    });
  });

  app.get('/api/v1/auth/session', async (req, reply) => {
    const session = sessions.current();
    return reply
      .header(
        'set-cookie',
        `hearth_session=${session.token}; HttpOnly; SameSite=Strict; Path=/`,
      )
      .send({ csrfToken: session.csrfToken, createdAt: session.createdAt });
  });

  app.get('/api/v1/settings', async (_req, reply) => {
    const stored = deps.storage.getSetting<SettingsDto>(SETTINGS_KEY);
    return reply.send(stored ?? DEFAULT_SETTINGS);
  });

  app.put('/api/v1/settings', async (req, reply) => {
    const dto = SettingsDtoSchema.parse(req.body);
    deps.storage.setSetting(SETTINGS_KEY, dto);
    deps.storage.audit('settings.updated', 'user', 'settings', { maxCardsPerDay: dto.maxCardsPerDay, quietHours: dto.quietHours });
    return reply.send(dto);
  });

  app.post('/api/v1/demo/seed', async (req, reply) => {
    if (!deps.config.demoMode) {
      return reply.status(409).send({ error: { code: 'NOT_DEMO', message: 'demo mode off; refusing to seed' } });
    }
    const connector = new FixtureConnector(deps.config.repoRoot ?? process.cwd());
    const projects = connector.loadProjects();
    deps.storage.seedProjects(projects);
    let eventsIngested = 0;
    for (const { event, meta } of connector.loadEvents()) {
      const r = deps.storage.ingestEvent(event, { goldenAction: meta.goldenAction, goldenUseful: meta.goldenUseful });
      if (r.inserted) eventsIngested += 1;
    }
    deps.storage.audit('demo.seeded', 'user', 'demo', { projects: projects.length, eventsIngested });
    return reply.send({ ok: true, projects: projects.length, eventsIngested });
  });

  app.post('/api/v1/demo/reset', async (req, reply) => {
    if (!deps.config.demoMode) {
      return reply.status(409).send({ error: { code: 'NOT_DEMO', message: 'demo mode off; refusing reset' } });
    }
    try {
      deps.storage.resetDemoData();
      deps.storage.audit('demo.reset', 'user', 'demo', {});
      return reply.send({ ok: true });
    } catch (err) {
      return reply.status(409).send({ error: { code: 'RESET_REFUSED', message: String(err) } });
    }
  });
}

export { SETTINGS_KEY, z };
