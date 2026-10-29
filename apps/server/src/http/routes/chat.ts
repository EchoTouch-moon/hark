import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';

const ChatBodySchema = z
  .object({
    sessionId: z.string().min(1).max(128).optional(),
    threadId: z.string().min(1).max(128).optional(),
    message: z.string().min(1).max(4000),
    projectId: z.string().min(1).max(128).nullable().optional(),
  })
  .strict()
  .refine((b) => Boolean(b.sessionId || b.threadId), {
    message: 'sessionId or threadId required',
  });

export function registerChatRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/v1/chat', async (req, reply) => {
    const body = ChatBodySchema.parse(req.body);
    const threadId = body.threadId ?? body.sessionId!;
    deps.storage.ensureThread(threadId);
    const now = new Date().toISOString();
    deps.storage.appendChat({
      id: `msg-${threadId}-${Date.now()}-u`,
      sessionId: threadId,
      role: 'user',
      content: body.message,
      adapter: 'mock',
      createdAt: now,
      parts: [{ type: 'text', text: body.message }],
    });
    deps.storage.touchThread(threadId, body.message);
    const history = deps.storage
      .listChat(threadId)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        sessionId: m.sessionId,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: m.createdAt,
      }));
    const replyOut = await deps.services.chat.reply({ message: body.message, history });
    const replyId = `msg-${threadId}-${Date.now()}-a`;
    const createdAt = new Date().toISOString();
    const parts = [{ type: 'text' as const, text: replyOut.content }];
    deps.storage.appendChat({
      id: replyId,
      sessionId: threadId,
      role: 'assistant',
      content: replyOut.content,
      adapter: 'mock',
      createdAt,
      parts,
    });
    deps.storage.touchThread(threadId, replyOut.content);
    return reply.send({
      reply: {
        id: replyId,
        role: 'assistant',
        content: replyOut.content,
        adapter: 'mock',
        createdAt,
        threadId,
        parts,
      },
      steps: replyOut.steps,
      adapter: 'mock',
      live: false,
      label: '离线演示 · 不连接模型',
    });
  });

  app.get('/api/v1/chat/history', async (req, reply) => {
    const q = req.query as { sessionId?: string; threadId?: string };
    const threadId = q.threadId ?? q.sessionId ?? 'thread-default';
    deps.storage.ensureThread(threadId);
    const messages = deps.storage.listChat(threadId).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      adapter: m.adapter,
      createdAt: m.createdAt,
      threadId,
      runId: m.runId,
      ...(m.parts !== undefined ? { parts: m.parts } : {}),
    }));
    return reply.send({ messages, adapter: 'mock', live: false });
  });
}
