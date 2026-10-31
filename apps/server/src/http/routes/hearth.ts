import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { buildObserveView, type ObserveScopeQuery } from '../hearth/observe-view.js';
import { ObserveWriteBody, readHearthPermissions, writeObservePermission } from '../hearth/permissions.js';

const Query = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global') }).strict(),
  z.object({ scope: z.literal('project'), projectId: z.string().min(1).max(200) }).strict(),
]);

function perms(deps: AppDeps) {
  return readHearthPermissions(deps.storage, deps.config.hearthPermissions);
}

/** GET /api/v1/hearth — 只读观察视图；PUT /api/v1/hearth/permissions — 仅改 observe。 */
export function registerHearthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/hearth', async (req, reply) => {
    const raw = { scope: 'global', ...(req.query as Record<string, unknown>) };
    const parsed = Query.safeParse(raw);
    const base = { now: new Date(), staleMs: deps.config.observeStaleMs, permissions: perms(deps) };
    if (!parsed.success) {
      const denied = buildObserveView({ ...base, scope: { kind: 'global' }, port: undefined });
      if (denied.view.status === 'permission_denied') return reply.status(403).send(denied.view);
      return reply.status(400).send({
        mode: 'real',
        scope: { kind: 'global' },
        featuredOpinion: null,
        permissions: { ...perms(deps), execute: false },
        status: 'error',
        error: { code: 'invalid_request', message: 'scope 必须为 global 或 project（project 需 projectId）' },
        narrative: { flame: { level: 'neutral', reason: '暂无法判断', milestoneGold: false }, story: [] },
        observationFreshness: 'unavailable',
      });
    }
    const scope: ObserveScopeQuery =
      parsed.data.scope === 'project' ? { kind: 'project', projectId: parsed.data.projectId } : { kind: 'global' };
    const result = buildObserveView({ ...base, scope, port: deps.observer });
    return reply.status(result.httpStatus).send(result.view);
  });

  app.put('/api/v1/hearth/permissions', async (req, reply) => {
    const origin = req.headers['origin'];
    if (origin === undefined || !deps.config.allowedOrigins.includes(String(origin))) {
      return reply.status(403).send({ error: { code: 'origin_rejected', message: '仅接受本机同源请求' } });
    }
    const parsed = ObserveWriteBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'invalid_request', message: '请求体只能是 { observe: boolean }' },
      });
    }
    const next = writeObservePermission(deps.storage, deps.config.hearthPermissions, parsed.data.observe);
    return reply.status(200).send({ permissions: { ...next, execute: false as const } });
  });
}
