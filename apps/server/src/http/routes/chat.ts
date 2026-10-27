import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';

const ChatBodySchema = z
  .object({ sessionId: z.string().min(1).max(128), message: z.string().min(1).max(4000) })
  .strict();

export function registerChatRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/v1/chat', async (req, reply) => {
    const body = ChatBodySchema.parse(req.body);
    const now = new Date().toISOString();
    deps.storage.appendChat({
      id: `msg-${body.sessionId}-${Date.now()}-u`,
      sessionId: body.sessionId,
      role: 'user',
      content: body.message,
      adapter: 'mock',
      createdAt: now,
    });
    const history = deps.storage
      .listChat(body.sessionId)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ sessionId: m.sessionId, role: m.role as 'user' | 'assistant', content: m.content, createdAt: m.createdAt }));
    const replyOut = await deps.services.chat.reply({ message: body.message, history });
    const replyId = `msg-${body.sessionId}-${Date.now()}-a`;
    deps.storage.appendChat({
      id: replyId,
      sessionId: body.sessionId,
      role: 'assistant',
      content: replyOut.content,
      adapter: 'mock',
      createdAt: new Date().toISOString(),
    });
    return reply.send({
      reply: { id: replyId, role: 'assistant', content: replyOut.content, adapter: 'mock', createdAt: new Date().toISOString() },
      steps: replyOut.steps,
      adapter: 'mock',
      live: false,
      label: '离线演示 · 不连接模型',
    });
  });

  app.get('/api/v1/chat/history', async (req, reply) => {
    const q = req.query as { sessionId?: string };
    const sessionId = q.sessionId ?? 'default';
    return reply.send({ messages: deps.storage.listChat(sessionId), adapter: 'mock', live: false });
  });
}
