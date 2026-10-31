import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { buildObserveView, type ObserveScopeQuery } from '../hearth/observe-view.js';

const Query = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global') }).strict(),
  z.object({ scope: z.literal('project'), projectId: z.string().min(1).max(200) }).strict(),
]);

/** GET /api/v1/hearth — M1 只读观察视图（HearthViewModel）。不研究、不调模型、不写卡片。 */
export function registerHearthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/hearth', async (req, reply) => {
    const raw = { scope: 'global', ...(req.query as Record<string, unknown>) };
    const parsed = Query.safeParse(raw);
    const scope: ObserveScopeQuery =
      parsed.success && parsed.data.scope === 'project'
        ? { kind: 'project', projectId: parsed.data.projectId }
        : { kind: 'global' };
    const result = buildObserveView({
      permissions: deps.config.hearthPermissions,
      scope,
      port: deps.observer,
      now: new Date(),
      staleMs: deps.config.observeStaleMs,
    });
    if (!parsed.success && result.view.status !== 'permission_denied') {
      return reply.status(400).send({
        ...result.view,
        status: 'error',
        error: { code: 'invalid_request', message: 'scope 必须为 global 或 project（project 需 projectId）' },
        narrative: { flame: { level: 'neutral', reason: '暂无法判断', milestoneGold: false }, story: [] },
        observationFreshness: 'unavailable',
      });
    }
    return reply.status(result.httpStatus).send(result.view);
  });
}
