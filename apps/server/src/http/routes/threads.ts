/**
 * G1 threads + G3 proactive + G4 action execute → 同线程回写.
 * 合同对齐前端 apps/web/src/features/threads.ts & chat.ts 探测形状.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';

const CreateThreadSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    projectId: z.string().min(1).max(128).nullable().optional(),
  })
  .strict();

const MessageActionSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(80),
    needsConfirm: z.boolean(),
    riskNote: z.string().max(400).optional(),
    impact: z.string().max(400).optional(),
    demo: z.boolean().optional(),
  })
  .strict();

const ExecuteBodySchema = z
  .object({
    action: MessageActionSchema,
  })
  .strict();

type ProgressStep = {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
};

function threadDto(t: {
  id: string;
  title: string;
  preview: string;
  projectId: string | null;
  updatedAt: string;
}) {
  return {
    id: t.id,
    title: t.title,
    preview: t.preview || undefined,
    projectId: t.projectId,
    updatedAt: t.updatedAt,
  };
}

function buildDemoSuggestion(threadId: string, now: string) {
  const id = `proactive-${threadId}`;
  const actions = [
    {
      id: 'demo-diagnose',
      label: '诊断',
      needsConfirm: false,
      riskNote: '只读演示，不改任何东西',
      demo: true,
    },
    {
      id: 'demo-approve-build',
      label: '批准重跑',
      needsConfirm: true,
      impact: '演示：假装批准一次本地构建（不会真的执行）',
      riskNote: '演示授权 · 无真实副作用',
      demo: true,
    },
    {
      id: 'demo-ignore',
      label: '忽略',
      needsConfirm: false,
      demo: true,
    },
  ];
  const text =
    '演示：有一件事值得看一眼——本地演示仓库的最近一次检查还没跟进。（这是假建议，尚未接真洞察。）';
  return {
    id,
    role: 'assistant' as const,
    content: text,
    createdAt: now,
    adapter: 'mock',
    threadId,
    parts: [
      { type: 'text' as const, text },
      { type: 'actions' as const, actions },
    ],
  };
}

function buildCardSuggestion(
  threadId: string,
  cards: Array<{ id: string; title: string; whyNow: string }>,
  now: string,
) {
  const slice = cards.slice(0, 3);
  const id = `proactive-cards-${threadId}`;
  const summary =
    slice.length === 1
      ? `有一件事值得处理：${slice[0]!.title}。${slice[0]!.whyNow}`
      : `有 ${slice.length} 件事值得看一眼：${slice.map((c) => c.title).join('；')}。`;
  const actions = slice.map((c) => ({
    id: `card-act-${c.id}`,
    label: c.title.slice(0, 24),
    needsConfirm: true,
    impact: c.whyNow.slice(0, 200),
    riskNote: '将走本机批准与执行（非演示路径请核对）',
    demo: false,
  }));
  if (actions.length < 3) {
    actions.push({
      id: 'demo-ignore',
      label: '忽略',
      needsConfirm: false,
      impact: '',
      riskNote: '',
      demo: true,
    });
  }
  return {
    id,
    role: 'assistant' as const,
    content: summary,
    createdAt: now,
    adapter: 'mock',
    threadId,
    parts: [
      { type: 'text' as const, text: summary },
      { type: 'actions' as const, actions },
    ],
  };
}

export function registerThreadRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/threads', async (_req, reply) => {
    deps.storage.ensureDefaultThread();
    const threads = deps.storage.listThreads().map(threadDto);
    return reply.send({ threads });
  });

  app.post('/api/v1/threads', async (req, reply) => {
    const body = CreateThreadSchema.parse(req.body ?? {});
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
    return reply.status(201).send({ thread: threadDto(thread) });
  });

  app.get('/api/v1/threads/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = deps.storage.getThread(id);
    if (!t) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'thread not found' } });
    }
    return reply.send({ thread: threadDto(t) });
  });

  /** G3: 空炉不抢 Seed——无用户消息不注入；用户开口后再允许一次主动；消费后安静。 */
  app.get('/api/v1/threads/:id/proactive', async (req, reply) => {
    const { id } = req.params as { id: string };
    const thread = deps.storage.ensureThread(id);
    if (thread.proactiveStatus === 'consumed') {
      return reply.send({ suggestion: null });
    }

    const history = deps.storage.listChat(id);
    const hasUserMessage = history.some((m) => m.role === 'user');
    // 产品/设计：无用户消息 = 空炉；不得写主动卡抢 Seed 首屏
    if (!hasUserMessage) {
      return reply.send({ suggestion: null });
    }

    if (thread.proactiveStatus === 'offered' && thread.proactiveMessageId) {
      const existing = history.find((m) => m.id === thread.proactiveMessageId);
      if (existing) {
        return reply.send({
          suggestion: {
            id: existing.id,
            role: existing.role,
            content: existing.content,
            createdAt: existing.createdAt,
            adapter: existing.adapter,
            threadId: id,
            parts: existing.parts,
          },
        });
      }
    }

    const now = new Date().toISOString();
    const proposed = deps.storage.listCards({ status: 'proposed', limit: 3 });
    const suggestion =
      proposed.length > 0
        ? buildCardSuggestion(
            id,
            proposed.map((c) => ({ id: c.id, title: c.title, whyNow: c.whyNow })),
            now,
          )
        : buildDemoSuggestion(id, now);

    // 持久化到线程历史，刷新后仍在
    if (!history.some((m) => m.id === suggestion.id)) {
      deps.storage.appendChat({
        id: suggestion.id,
        sessionId: id,
        role: 'assistant',
        content: suggestion.content,
        adapter: 'mock',
        createdAt: now,
        parts: suggestion.parts,
      });
    }
    deps.storage.updateThreadProactive(id, {
      proactiveStatus: 'offered',
      proactiveMessageId: suggestion.id,
    });
    deps.storage.touchThread(id, suggestion.content);

    return reply.send({ suggestion });
  });

  /** G4: 行动执行 → 同线程 Progress + result 回写（本拍 Mock 闭环，诚实标注）。 */
  app.post('/api/v1/threads/:id/actions/:actionId/execute', async (req, reply) => {
    const { id, actionId } = req.params as { id: string; actionId: string };
    const body = ExecuteBodySchema.parse(req.body ?? {});
    const action = body.action;
    if (action.id !== actionId) {
      return reply.status(400).send({
        error: { code: 'ACTION_ID_MISMATCH', message: 'path actionId must match body.action.id' },
      });
    }
    deps.storage.ensureThread(id);
    const now = new Date().toISOString();

    if (action.id === 'demo-ignore' || action.id === 'mock-ignore' || action.label === '忽略') {
      const message = {
        id: `result-${Date.now()}`,
        role: 'assistant' as const,
        content: '好，已忽略这条演示建议。',
        createdAt: now,
        adapter: 'mock',
        threadId: id,
        parts: [{ type: 'result' as const, text: '好，已忽略这条演示建议。', ok: true }],
      };
      deps.storage.appendChat({
        id: message.id,
        sessionId: id,
        role: 'assistant',
        content: message.content,
        adapter: 'mock',
        createdAt: now,
        parts: message.parts,
      });
      deps.storage.updateThreadProactive(id, { proactiveStatus: 'consumed' });
      deps.storage.touchThread(id, message.content);
      deps.storage.audit('thread.action.ignored', 'user', id, { actionId });
      return reply.send({ message });
    }

    const runRef = `demo-run-${Date.now()}`;
    const progressId = `progress-${Date.now()}`;
    const finalSteps: ProgressStep[] = [
      { name: '确认范围', status: 'done', detail: '演示步骤' },
      {
        name: action.needsConfirm ? '按批准执行' : '只读诊断',
        status: 'done',
        detail: '演示完成',
      },
      {
        name: '汇总结果',
        status: 'done',
        detail: action.demo !== false ? '假结果 · 未接真洞察/真构建' : '完成',
      },
    ];
    const resultText =
      action.demo !== false
        ? `「${action.label}」演示跑通了：进度与结果留在本线程。这不是真实洞察或真实构建。`
        : `「${action.label}」已完成（本拍仍为本地闭环，未接外部执行器）。`;

    const message = {
      id: progressId,
      role: 'assistant' as const,
      content: resultText,
      createdAt: now,
      adapter: 'mock',
      threadId: id,
      parts: [
        { type: 'progress' as const, steps: finalSteps, runRef },
        { type: 'result' as const, text: resultText, ok: true },
      ],
    };

    deps.storage.appendChat({
      id: message.id,
      sessionId: id,
      role: 'assistant',
      content: message.content,
      runId: runRef,
      adapter: 'mock',
      createdAt: now,
      parts: message.parts,
    });
    deps.storage.updateThreadProactive(id, { proactiveStatus: 'consumed' });
    deps.storage.touchThread(id, resultText);
    deps.storage.audit('thread.action.executed', 'user', id, {
      actionId,
      runRef,
      demo: action.demo !== false,
    });

    return reply.send({ message });
  });
}
