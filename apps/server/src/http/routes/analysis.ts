import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AnalysisTriggerSchema,
  isAnalysisError,
  type AnalysisService,
} from '@hearth/project-analysis';
import type { AppDeps } from '../app.js';

const StartBody = z
  .object({
    projectId: z.string().min(1).max(128),
    insightId: z.string().min(1).max(128).optional(),
    trigger: AnalysisTriggerSchema.default('observe'),
    consentFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict();

const FeedbackBody = z.object({ kind: z.enum(['useful', 'not_useful']) }).strict();

function requireAnalysis(deps: AppDeps): AnalysisService {
  if (deps.analysis === undefined) {
    const error = new Error('analysis service is not configured');
    (error as { statusCode?: number }).statusCode = 503;
    throw error;
  }
  return deps.analysis;
}

function sendAnalysisError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, cause: unknown) {
  if (isAnalysisError(cause)) {
    const status =
      cause.code === 'NOT_FOUND' ? 404 : ['IN_FLIGHT', 'STALE_INSIGHT', 'CAPACITY', 'BUDGET', 'PROJECT_DELETING', 'CONSENT_REQUIRED'].includes(cause.code) ? 409 : cause.code === 'CANCELLED' ? 409 : 400;
    return reply.status(status).send({ error: { code: cause.code, message: cause.message } });
  }
  throw cause;
}

export function registerAnalysisRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/v1/analysis/preview', async (req, reply) => {
    try { return reply.send(requireAnalysis(deps).preview(StartBody.parse(req.body))); }
    catch (cause) { return sendAnalysisError(reply, cause); }
  });
  app.put('/api/v1/analysis/privacy', async (req, reply) => {
    try {
      const body = z.object({ projectId: z.string().min(1).max(128), excludedPaths: z.array(z.string()).max(32) }).strict().parse(req.body);
      requireAnalysis(deps).setPrivacy(body.projectId, body.excludedPaths);
      return reply.send({ok: true});
    } catch (cause) { return sendAnalysisError(reply,cause); }
  });
  app.post('/api/v1/analysis/runs', async (req, reply) => {
    const analysis = requireAnalysis(deps);
    try {
      const body = StartBody.parse(req.body);
      const run = await analysis.start(body);
      return reply.status(201).send({ run });
    } catch (cause) {
      return sendAnalysisError(reply, cause);
    }
  });

  app.get('/api/v1/analysis/runs', async (req, reply) => {
    const analysis = requireAnalysis(deps);
    const query = z.object({ projectId: z.string().min(1).max(128) }).parse(req.query);
    return reply.send({ runs: analysis.list(query.projectId) });
  });

  app.get('/api/v1/analysis/runs/:id', async (req, reply) => {
    const analysis = requireAnalysis(deps);
    const { id } = req.params as { id: string };
    const run = analysis.get(id);
    if (run === null) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'analysis run not found' } });
    }
    return reply.send({ run });
  });

  app.post('/api/v1/analysis/runs/:id/cancel', async (req, reply) => {
    const analysis = requireAnalysis(deps);
    const { id } = req.params as { id: string };
    const run = analysis.get(id);
    if (run === null) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'analysis run not found' } });
    }
    analysis.cancel(id);
    return reply.send({ ok: true });
  });

  app.post('/api/v1/analysis/runs/:id/feedback', async (req, reply) => {
    const analysis = requireAnalysis(deps);
    const { id } = req.params as { id: string };
    try {
      const body = FeedbackBody.parse(req.body);
      analysis.feedback(id, body.kind);
      return reply.send({ ok: true, feedback: analysis.get(id)?.feedback ?? null });
    } catch (cause) {
      return sendAnalysisError(reply, cause);
    }
  });
}
