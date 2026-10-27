import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { CardExpiredError, ConflictError, NotFoundError } from '@hearth/core';

const ApprovalBodySchema = z
  .object({ decision: z.enum(['approve', 'deny']) })
  .strict();

export function registerRunRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/v1/cards/:id/execute', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { sync?: string };
    try {
      const out = await deps.services.orchestrator.executeCard(id, 'user', {
        awaitCompletion: q['sync'] === '1' || q['sync'] === 'true',
      });
      const code = out.alreadyRunning ? 200 : 202;
      return reply.status(code).send({ run: out.run, card: deps.storage.getCard(id), alreadyRunning: out.alreadyRunning });
    } catch (err) {
      return mapOrchestratorError(reply, err);
    }
  });

  app.get('/api/v1/runs', async (req, reply) => {
    const q = req.query as { projectId?: string };
    return reply.send({ runs: deps.storage.listRuns({ projectId: q.projectId, limit: 100 }) });
  });

  app.get('/api/v1/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = deps.storage.getRun(id);
    if (!run) return reply.status(404).send({ error: { code: 'RUN_NOT_FOUND', message: `run ${id} not found` } });
    const steps = deps.storage.listSteps(id);
    const evidence = deps.storage.listEvidence(id);
    const card = deps.storage.getCard(run.cardId);
    return reply.send({ run, steps, evidence, card });
  });

  app.post('/api/v1/approvals/:runId', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const body = ApprovalBodySchema.parse(req.body);
    try {
      const run = await deps.services.orchestrator.decideApproval(runId, body.decision, 'user');
      return reply.send({ run });
    } catch (err) {
      return mapOrchestratorError(reply, err);
    }
  });

  app.post('/api/v1/runs/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const run = await deps.services.orchestrator.cancel(id, 'user');
      return reply.send({ run });
    } catch (err) {
      return mapOrchestratorError(reply, err);
    }
  });

  // --- SSE task progress: emits snapshots on state/step change, closes on terminal.
  app.get('/api/v1/runs/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = deps.storage.getRun(id);
    if (!run) return reply.status(404).send({ error: { code: 'RUN_NOT_FOUND', message: `run ${id} not found` } });

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const write = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let lastKey = '';
    const terminal = new Set(['completed', 'failed', 'blocked', 'cancelled']);
    const timer = setInterval(() => {
      const cur = deps.storage.getRun(id);
      if (!cur) {
        clearInterval(timer);
        reply.raw.end();
        return;
      }
      const steps = deps.storage.listSteps(id);
      const key = `${cur.state}|${steps.length}|${steps[steps.length - 1]?.status ?? ''}`;
      if (key !== lastKey) {
        lastKey = key;
        write('snapshot', { run: cur, steps });
      }
      if (terminal.has(cur.state)) {
        write('done', { run: cur, evidence: deps.storage.listEvidence(id) });
        clearInterval(timer);
        reply.raw.end();
      }
    }, 350);

    req.raw.on('close', () => clearInterval(timer));
  });
}

function mapOrchestratorError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof CardExpiredError) {
    return reply.status(410).send({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ConflictError) {
    return reply.status(409).send({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof NotFoundError) {
    return reply.status(404).send({ error: { code: err.code, message: err.message } });
  }
  throw err;
}
