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
    const base = { now: new Date(), staleMs: deps.config.observeStaleMs, permissions: deps.config.hearthPermissions };
    if (!parsed.success) {
      // 先判授权（403 不读数据、不回显输入），再判参数；两者都不读观察数据。
      const denied = buildObserveView({ ...base, scope: { kind: 'global' }, port: undefined });
      if (denied.view.status === 'permission_denied') return reply.status(403).send(denied.view);
      return reply.status(400).send({
        mode: 'real',
        scope: { kind: 'global' },
        featuredOpinion: null,
        permissions: { ...deps.config.hearthPermissions, execute: false },
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
}
