/**
 * @fileoverview 项目洞察（Project Insights）HTTP 路由
 * 
 * 提供项目事件衍生出的洞察列表查询、全局健康度摘要、洞察详情与用户交互（确认/忽略/反馈）：
 * - `GET  /api/v1/insights`：分页按条件检索洞察项
 * - `GET  /api/v1/insights/summary`：汇总各项目未解决洞察数与引擎运行健康度
 * - `GET  /api/v1/insights/policy`：查询当前规则生效策略
 * - `GET  /api/v1/insights/:id`：获取单条洞察的完整事实、来源依据与模板上下文
 * - `POST /api/v1/insights/:id/acknowledge`：标记洞察为已确认/已阅
 * - `POST /api/v1/insights/:id/dismiss`：忽略并关闭洞察
 * - `POST /api/v1/insights/:id/feedback`：提交针对该洞察质量的用户有用性反馈
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  InsightFeedbackKindSchema,
  InsightStatusSchema,
  applyAcknowledge,
  applyDismiss,
  applyFeedback,
  getInsight,
  insightPolicy,
  isInsightError,
  listInsights,
  summarizeInsights,
  type InsightStore,
} from '@hearth/project-insight';
import type { AppDeps } from '../app.js';

/** 确保 InsightStore 已就绪，未配置时抛出 503 */
function requireInsight(deps: AppDeps): InsightStore {
  if (deps.insight === undefined) {
    const error = new Error('insight store is not configured');
    (error as { statusCode?: number }).statusCode = 503;
    throw error;
  }
  return deps.insight;
}

/** 统一处理洞察领域异常映射为标准 HTTP 状态码 */
function sendInsightError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, cause: unknown) {
  if (isInsightError(cause)) {
    const status = cause.code === 'NOT_FOUND' ? 404 : cause.code === 'INVALID_CURSOR' ? 400 : 400;
    return reply.status(status).send({ error: { code: cause.code, message: cause.message } });
  }
  throw cause;
}

/** 洞察列表查询参数校验 Schema */
const ListQuery = z
  .object({
    projectId: z.string().min(1).max(128).optional(),
    status: z.string().min(1).max(128).optional(),
    severity: z.enum(['info', 'attention', 'important']).optional(),
    cursor: z.string().min(1).max(256).optional(),
    limit: z.coerce.number().int().positive().max(50).optional(),
  })
  .strict();

/** 洞察用户反馈请求体 Schema */
const FeedbackBody = z.object({ kind: InsightFeedbackKindSchema }).strict();

/**
 * 注册项目洞察相关的 HTTP API 端点
 */
export function registerInsightRoutes(app: FastifyInstance, deps: AppDeps): void {
  // 分页查询洞察列表
  app.get('/api/v1/insights', async (req, reply) => {
    const insight = requireInsight(deps);
    try {
      const q = ListQuery.parse(req.query);
      const statuses = q.status
        ?.split(',')
        .map((item) => InsightStatusSchema.parse(item));
      const page = listInsights(insight, {
        projectId: q.projectId,
        statuses,
        severity: q.severity,
        cursor: q.cursor,
        limit: q.limit,
      });
      return reply.send(page);
    } catch (cause) {
      return sendInsightError(reply, cause);
    }
  });

  // 全局洞察摘要（引擎健康状态及各项目待处理数）
  app.get('/api/v1/insights/summary', async (_req, reply) => {
    const insight = requireInsight(deps);
    return reply.send(summarizeInsights(insight));
  });

  // 当前洞察引擎规则生效策略
  app.get('/api/v1/insights/policy', async (_req, reply) => {
    requireInsight(deps);
    return reply.send(insightPolicy());
  });

  // 单条洞察详情
  app.get('/api/v1/insights/:id', async (req, reply) => {
    const insight = requireInsight(deps);
    const { id } = req.params as { id: string };
    const detail = getInsight(insight, id);
    if (detail === null) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'insight not found' } });
    }
    return reply.send({ insight: detail });
  });

  // 确认洞察（标记已阅）
  app.post('/api/v1/insights/:id/acknowledge', async (req, reply) => {
    const insight = requireInsight(deps);
    const { id } = req.params as { id: string };
    try {
      return reply.send(applyAcknowledge(insight, id));
    } catch (cause) {
      return sendInsightError(reply, cause);
    }
  });

  // 忽略洞察（不再关注）
  app.post('/api/v1/insights/:id/dismiss', async (req, reply) => {
    const insight = requireInsight(deps);
    const { id } = req.params as { id: string };
    try {
      return reply.send(applyDismiss(insight, id));
    } catch (cause) {
      return sendInsightError(reply, cause);
    }
  });

  // 提交有用性反馈（如 useful 或 not_useful）
  app.post('/api/v1/insights/:id/feedback', async (req, reply) => {
    const insight = requireInsight(deps);
    const { id } = req.params as { id: string };
    try {
      const body = FeedbackBody.parse(req.body);
      return reply.send(applyFeedback(insight, id, body.kind));
    } catch (cause) {
      return sendInsightError(reply, cause);
    }
  });
}
