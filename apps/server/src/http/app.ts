import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';
import type { ServerConfig } from '../config.js';
import type { Storage } from '@hearth/storage';
import type { ProjectObserver } from '@hearth/project-observer';
import { SessionManager, parseSessionCookie } from './session.js';
import { registerCoreRoutes } from './routes/core.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerCardRoutes } from './routes/cards.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerObserverRoutes } from './routes/observer.js';
import type { Services } from './services.js';

export interface AppDeps {
  config: ServerConfig;
  storage: Storage;
  services: Services;
  observer?: ProjectObserver;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });

  const sessions = new SessionManager(
    () => deps.storage.getSetting<unknown>('session'),
    (v) => deps.storage.setSetting('session', v),
  );

  // --- Origin gate: any request whose Origin is present must be allowlisted.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = req.headers['origin'];
    if (origin !== undefined && !deps.config.allowedOrigins.includes(String(origin))) {
      return reply.status(403).send({ error: { code: 'ORIGIN_DENIED', message: 'origin not allowed' } });
    }
  });

  // --- Auth gate: only guards /api/v1/* (static pages stay public);
  //     /health and /auth/session are open.
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith('/api/v1/')) return;
    if (req.url === '/api/v1/health' || req.url.split('?')[0] === '/api/v1/auth/session') return;
    const token = parseSessionCookie(req.headers['cookie']);
    if (!sessions.isValidToken(token)) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'missing or invalid session' } });
    }
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      const csrf = req.headers['x-csrf-token'];
      const expected = sessions.csrfFor(token);
      if (!expected || String(csrf) !== expected) {
        return reply.status(403).send({ error: { code: 'CSRF_DENIED', message: 'missing or mismatched csrf token' } });
      }
      // Browser fetch always sends Origin on POST; originless writes are not a UI.
      if (req.headers['origin'] === undefined) {
        return reply.status(403).send({ error: { code: 'ORIGIN_REQUIRED', message: 'state-changing requests must carry an Origin header' } });
      }
    }
  });

  app.setErrorHandler((err: Error, _req: FastifyRequest, reply: FastifyReply) => {
    if (err.name === 'ZodError') {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'request failed schema validation',
          details: (err as unknown as ZodError).issues,
        },
      });
    }
    const maybeStatus = (err as { statusCode?: unknown }).statusCode;
    if (typeof maybeStatus === 'number' && maybeStatus >= 400 && maybeStatus < 500) {
      return reply.status(maybeStatus).send({ error: { code: 'REQUEST_FAILED', message: err.message } });
    }
    console.error('[hearth-server] unhandled error:', err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'internal error' } });
  });

  registerCoreRoutes(app, deps, sessions);
  registerProjectRoutes(app, deps);
  registerCardRoutes(app, deps);
  registerRunRoutes(app, deps);
  registerChatRoutes(app, deps);
  registerObserverRoutes(app, deps);

  return app;
}
