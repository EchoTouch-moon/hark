import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';

const SnoozeBodySchema = z
  .object({ until: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/) })
  .strict();
const DismissBodySchema = z
  .object({ reason: z.string().max(500).optional(), feedback: z.enum(['not_useful', 'irrelevant']).optional() })
  .strict();

/** Per-app rate limiting (keyed by storage instance so tests/isolated apps don't share state). */
const lastDiscoverAtByStorage = new WeakMap<object, number>();

export function registerCardRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/cards', async (req, reply) => {
    const q = req.query as { status?: string; projectId?: string };
    const cards = deps.storage.listCards({ status: q.status, projectId: q.projectId, limit: 100 });
    return reply.send({ cards });
  });

  app.get('/api/v1/cards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const card = deps.storage.getCard(id);
    if (!card) return reply.status(404).send({ error: { code: 'CARD_NOT_FOUND', message: `card ${id} not found` } });
    const candidate = deps.storage.getCandidate(card.candidateId);
    const events = candidate
      ? candidate.eventIds.map((eid) => deps.storage.getEvent(eid)).filter((e) => e !== null)
      : [];
    const run = deps.storage.getRunByCard(id);
    return reply.send({ card, events, run });
  });

  app.post('/api/v1/cards/:id/dismiss', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = DismissBodySchema.parse(req.body ?? {});
    const card = deps.storage.getCard(id);
    if (!card) return reply.status(404).send({ error: { code: 'CARD_NOT_FOUND', message: `card ${id} not found` } });
    deps.storage.updateCard(id, { status: 'dismissed', userFeedback: body.feedback ?? 'not_useful' });
    deps.storage.insertFeedback({
      id: `fb-${id}-${Date.now()}`,
      cardId: id,
      kind: body.feedback ?? 'not_useful',
      reason: body.reason,
      createdAt: new Date().toISOString(),
    });
    deps.storage.audit('card.dismissed', 'user', id, { feedback: body.feedback ?? 'not_useful' });
    return reply.send({ ok: true, card: deps.storage.getCard(id) });
  });

  app.post('/api/v1/cards/:id/snooze', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = SnoozeBodySchema.parse(req.body);
    const card = deps.storage.getCard(id);
    if (!card) return reply.status(404).send({ error: { code: 'CARD_NOT_FOUND', message: `card ${id} not found` } });
    const until = new Date(body.until);
    const now = new Date();
    if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) {
      return reply.status(400).send({ error: { code: 'INVALID_SNOOZE_WINDOW', message: 'until must be in the future' } });
    }
    if (until.getTime() - now.getTime() > 7 * 24 * 3_600_000) {
      return reply.status(400).send({ error: { code: 'INVALID_SNOOZE_WINDOW', message: 'until must be within 7 days' } });
    }
    deps.storage.updateCard(id, { status: 'snoozed', snoozedUntil: body.until });
    deps.storage.audit('card.snoozed', 'user', id, { until: body.until });
    return reply.send({ ok: true, card: deps.storage.getCard(id) });
  });

  app.post('/api/v1/discover', async (_req, reply) => {
    const now = Date.now();
    const last = lastDiscoverAtByStorage.get(deps.storage) ?? 0;
    if (now - last < 1500) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'discover rate limited; retry shortly' } });
    }
    lastDiscoverAtByStorage.set(deps.storage, now);
    const result = await deps.services.discovery.discover();
    return reply.send(result);
  });
}
