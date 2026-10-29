/**
 * @fileoverview Fastify HTTP 服务构建与安全门禁装配（HTTP App Builder）
 *
 * 强制安全机制：
 * 1. Origin 校验门禁（onRequest）：若请求包含 Origin，必须在 allowedOrigins 白名单中
 * 2. 身份与 CSRF 校验门禁（preHandler）：针对 `/api/v1/*` 路由（除公开 health 与 auth 探测外），
 *    强制校验 HttpOnly Cookie 中的 session 令牌；针对状态写入（POST/PUT/DELETE），强制校验 `x-csrf-token` 与 Origin
 * 3. 统一全局异常处理（ZodError 格式化校验失败为 400，业务异常按状态码响应）
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';
import type { ServerConfig } from '../config.js';
import type { Storage } from '@hearth/storage';
import type { ProjectObserver } from '@hearth/project-observer';
import type { InsightStore } from '@hearth/project-insight';
import { SessionManager, parseSessionCookie } from './session.js';
import { registerCoreRoutes } from './routes/core.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerCardRoutes } from './routes/cards.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerObserverRoutes } from './routes/observer.js';
import { registerInsightRoutes } from './routes/insights.js';
import type { Services } from './services.js';

/** 服务构建所需全部依赖 */
export interface AppDeps {
  config: ServerConfig;
  storage: Storage;
  services: Services;
  observer?: ProjectObserver;
  insight?: InsightStore;
}

/**
 * 构建并初始化 Fastify 服务实例
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });

  const sessions = new SessionManager(
    () => deps.storage.getSetting<unknown>('session'),
    (v) => deps.storage.setSetting('session', v),
  );

  // --- Origin 门禁：任何包含 Origin 头的请求必须严格命中白名单
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = req.headers['origin'];
    if (origin !== undefined && !deps.config.allowedOrigins.includes(String(origin))) {
      return reply.status(403).send({ error: { code: 'ORIGIN_DENIED', message: 'origin not allowed' } });
    }
  });

  // --- 鉴权与 CSRF 门禁：仅拦截 /api/v1/* 接口（静态页面公开可达）；
  //     /health 与 /auth/session 保持公开
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
      // 浏览器 fetch 发起 POST 时必带 Origin；无 Origin 的外部写入不是正规 UI 发起
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
    if (typeof maybeStatus === 'number' && maybeStatus >= 400 && maybeStatus < 600) {
      return reply.status(maybeStatus).send({
        error: { code: maybeStatus >= 500 ? 'UNAVAILABLE' : 'REQUEST_FAILED', message: err.message },
      });
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
  registerInsightRoutes(app, deps);

  return app;
}
