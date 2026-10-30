/** Conversation threads. Legacy proactive and simulated execution are fail-closed. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { isUnsafeLegacyMessage } from './legacy-chat.js';

const CreateThreadSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    projectId: z.string().min(1).max(128).nullable().optional(),
  })
  .strict();

const ListThreadsSchema = z.object({ projectId: z.string().min(1).max(128).optional() }).strict();

// Thread links refer to the read-only Observer registry. Legacy Demo project
// identities must never silently establish a real project scope.
function hasObservedProject(deps: AppDeps, projectId: string): boolean {
  return deps.observer?.listProjects().some(project => project.id === projectId) ?? false;
}

function threadDto(t: { id: string; title: string; preview: string; projectId: string | null; updatedAt: string }, deps: AppDeps) {
  const matching = t.preview ? deps.storage.listChat(t.id).filter(message => message.content.slice(0, 80) === t.preview) : [];
  const safePreview = matching.length > 0 && matching.every(message => !isUnsafeLegacyMessage(message));
  return {
    id: t.id,
    title: t.title,
    preview: safePreview ? t.preview : undefined,
    projectId: t.projectId,
    updatedAt: t.updatedAt,
  };
}

export function registerThreadRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/threads', async (req, reply) => {
    const query = ListThreadsSchema.parse(req.query);
    if (query.projectId && !hasObservedProject(deps, query.projectId)) {
      return reply.status(404).send({ error: { code: 'PROJECT_NOT_FOUND', message: '该项目尚未登记只读观察，或已被移除。' } });
    }
    const threads = deps.storage.listThreads().filter(thread => !query.projectId || thread.projectId === query.projectId);
    return reply.send({ threads: threads.map(thread => threadDto(thread, deps)) });
  });

  app.post('/api/v1/threads', async (req, reply) => {
    const body = CreateThreadSchema.parse(req.body ?? {});
    if (body.projectId && !hasObservedProject(deps, body.projectId)) {
      return reply.status(404).send({ error: { code: 'PROJECT_NOT_FOUND', message: '请先登记一个本地项目，再开始谈话。' } });
    }
    const now = new Date().toISOString();
    const id = `thread-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const thread = {
      id,
      title: (body.title ?? '新线程').trim() || '新线程',
      preview: '',
      projectId: body.projectId ?? null,
      proactiveStatus: 'idle',
      proactiveMessageId: null,
      updatedAt: now,
      createdAt: now,
    };
    deps.storage.insertThread(thread);
    deps.storage.audit('thread.created', 'user', id, { title: thread.title });
    return reply.status(201).send({ thread: threadDto(thread, deps) });
  });

  app.get('/api/v1/threads/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const thread = deps.storage.getThread(id);
    if (!thread) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'thread not found' } });
    return reply.send({ thread: threadDto(thread, deps) });
  });

  // The old endpoint mixed projects and mutated history on GET. Keep it empty
  // until project identity and an independently authorized delivery exist.
  app.get('/api/v1/threads/:id/proactive', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.storage.getThread(id)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'thread not found' } });
    return reply.send({ suggestion: null });
  });

  // Client-supplied demo labels cannot establish mode, scope or completion.
  app.post('/api/v1/threads/:id/actions/:actionId/execute', async (_req, reply) =>
    reply.status(403).send({ error: { code: 'LEGACY_ACTIONS_DISABLED', message: '旧模拟操作当前不可用。' } }),
  );
}
