/**
 * Chat + G2/G3/G4 适配层。
 * 真 API（优先）：POST/GET chat（sessionId≡threadId，含 parts）、
 *   GET /api/v1/threads/:id/proactive、POST .../actions/:id/execute。
 * 仅 404 / 501 / 网络失败时降级 localStorage Mock。
 * 真 API 可用时：忽略并清理旧 Mock 注入，history 已有 parts 不再叠本地假行动。
 */

import { z } from 'zod';
import { apiFetch, ApiError } from './api/client';
import type { ChatMessage, ChatRole } from './api/types';
import { touchLocalThread } from './threads';

export type { ChatMessage, ChatRole };

/** 消息内行动（≤3） */
export interface MessageAction {
  id: string;
  label: string;
  needsConfirm: boolean;
  /** 一行风险/影响说明 */
  riskNote?: string;
  impact?: string;
  /** 演示标记：勿当真洞察 */
  demo?: boolean;
}

export interface ProgressStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
}

export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'actions'; actions: MessageAction[] }
  | { type: 'progress'; steps: ProgressStep[]; runRef?: string }
  | { type: 'result'; text: string; ok: boolean };

export interface CanvasMessage extends ChatMessage {
  threadId?: string;
  parts?: ChatMessagePart[];
}

export interface ChatReplyDto {
  reply: CanvasMessage;
  steps: Array<{ name: string; detail: string }>;
  adapter: string;
  live: boolean;
  label: string;
}

export interface ConfirmedUserMessage {
  id: string;
  role: 'user';
  content: string;
  createdAt: string;
}

export interface ChatHistoryDto {
  messages: CanvasMessage[];
  /** Validated server messages, before any optional local display overlays. */
  confirmedUserMessages: ConfirmedUserMessage[];
  adapter: string;
  live: boolean;
}

export interface ProactiveDto {
  /** 无事时 suggestion 为 null */
  suggestion: CanvasMessage | null;
  mock: boolean;
}

const PARTS_STORAGE = 'hearth.chat.parts.v2';
const LOCAL_MSGS_STORAGE = 'hearth.chat.localMsgs.v2';
const PROACTIVE_INJECT_PREFIX = 'hearth.proactive.injected.';

/** 本会话已探测到 G1–G4 真 API；此后不再用旧 Mock 叠层盖住服务端数据。 */
let liveApi = false;

export function isLiveApi(): boolean {
  return liveApi;
}

/** AppShell / 探测成功时调用：切 live，并清掉会盖住真 proactive 的旧 Mock。 */
export function preferLiveApi(): void {
  const first = !liveApi;
  liveApi = true;
  if (first) clearStaleMockOverlay();
}

function isMockOverlayMessageId(id: string): boolean {
  return (
    id.startsWith('mock-proactive-') ||
    id.startsWith('mock-progress-') ||
    id.startsWith('mock-result-') ||
    id.startsWith('progress-pending-')
  );
}

/** 清 proactive 注入标记 + 本地假消息/假 parts；保留 CSRF 等其它 key。 */
export function clearStaleMockOverlay(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PROACTIVE_INJECT_PREFIX)) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {
    // ignore
  }
  try {
    const bag = readLocalMsgs();
    let changed = false;
    for (const threadId of Object.keys(bag)) {
      const list = bag[threadId] ?? [];
      const next = list.filter((m) => !isMockOverlayMessageId(m.id));
      if (next.length !== list.length) {
        bag[threadId] = next;
        changed = true;
      }
      if ((bag[threadId] ?? []).length === 0) {
        delete bag[threadId];
        changed = true;
      }
    }
    if (changed) writeLocalMsgs(bag);
  } catch {
    // ignore
  }
  try {
    const parts = readPartsBag();
    let changed = false;
    for (const id of Object.keys(parts)) {
      if (isMockOverlayMessageId(id)) {
        delete parts[id];
        changed = true;
      }
    }
    if (changed) writePartsBag(parts);
  } catch {
    // ignore
  }
}


type PartsBag = Record<string, ChatMessagePart[]>;

function readPartsBag(): PartsBag {
  try {
    const raw = window.localStorage.getItem(PARTS_STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as PartsBag) : {};
  } catch {
    return {};
  }
}

function writePartsBag(bag: PartsBag): void {
  try {
    window.localStorage.setItem(PARTS_STORAGE, JSON.stringify(bag));
  } catch {
    // ignore
  }
}

export function saveMessageParts(messageId: string, parts: ChatMessagePart[]): void {
  const bag = readPartsBag();
  bag[messageId] = parts;
  writePartsBag(bag);
}


type LocalMsgBag = Record<string, CanvasMessage[]>;

function readLocalMsgs(): LocalMsgBag {
  try {
    const raw = window.localStorage.getItem(LOCAL_MSGS_STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as LocalMsgBag) : {};
  } catch {
    return {};
  }
}

function writeLocalMsgs(bag: LocalMsgBag): void {
  try {
    window.localStorage.setItem(LOCAL_MSGS_STORAGE, JSON.stringify(bag));
  } catch {
    // ignore
  }
}

/** 合并服务端历史 + 前端 Mock 叠加消息（同 id 去重，本地覆盖）。 */
export function mergeLocalMessages(threadId: string, server: CanvasMessage[]): CanvasMessage[] {
  const local = readLocalMsgs()[threadId] ?? [];
  if (local.length === 0) return server;
  const byId = new Map<string, CanvasMessage>();
  for (const m of server) byId.set(m.id, m);
  for (const m of local) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function appendLocalMessage(threadId: string, message: CanvasMessage): void {
  const bag = readLocalMsgs();
  const list = bag[threadId] ?? [];
  bag[threadId] = [...list.filter((m) => m.id !== message.id), { ...message, threadId }];
  writeLocalMsgs(bag);
  if (message.parts) saveMessageParts(message.id, message.parts);
}

export function patchLocalMessage(threadId: string, message: CanvasMessage): void {
  appendLocalMessage(threadId, message);
}


/** 仅补齐服务端缺失的 parts；已有 parts 一律用服务端，不叠本地假行动。 */
function attachStoredParts(messages: CanvasMessage[]): CanvasMessage[] {
  const bag = readPartsBag();
  return messages.map((m) => {
    if (m.parts && m.parts.length > 0) return m;
    return bag[m.id] ? { ...m, parts: bag[m.id] } : m;
  });
}

export async function fetchChatHistory(
  threadId: string,
  signal?: AbortSignal,
): Promise<ChatHistoryDto> {
  const qs = new URLSearchParams({
    sessionId: threadId,
    threadId,
  });
  const data = await apiFetch<ChatHistoryDto>(`/api/v1/chat/history?${qs}`, { signal });
  const server = data.messages ?? [];
  // Only the server response can establish a saved interaction. The schema
  // deliberately strips parts, adapter metadata and other unrelated fields.
  const confirmedSchema = z.object({
    id: z.string().min(1),
    role: z.literal('user'),
    content: z.string(),
    createdAt: z.string(),
    threadId: z.string().optional(),
  }).strip();
  const confirmedUserMessages = server.flatMap((message) => {
    const result = confirmedSchema.safeParse(message);
    if (!result.success || (result.data.threadId && result.data.threadId !== threadId)) return [];
    const { id, role, content, createdAt } = result.data;
    return [{ id, role, content, createdAt }];
  });
  const withParts = attachStoredParts(server);
  const serverHasParts = server.some((m) => Array.isArray(m.parts) && m.parts.length > 0);
  // 真 API / 服务端已带 parts：不合并旧 Mock 本地消息
  const messages =
    liveApi || serverHasParts
      ? withParts
      : mergeLocalMessages(threadId, withParts);
  if (serverHasParts && !liveApi) preferLiveApi();
  return {
    ...data,
    messages,
    confirmedUserMessages,
  };
}

export async function sendChatMessage(
  threadId: string,
  message: string,
  signal?: AbortSignal,
): Promise<ChatReplyDto> {
  const out = await apiFetch<ChatReplyDto>('/api/v1/chat', {
    method: 'POST',
    json: { sessionId: threadId, threadId, message },
    signal,
  });
  touchLocalThread(threadId, message);
  return out;
}

/**
 * G3 proactive：打开线程时拉未处理建议。
 * 无后端时：空线程注入一条诚实 Mock 建议（文案标明演示）。
 */
export async function fetchProactive(
  threadId: string,
  opts: { hasMessages: boolean },
  signal?: AbortSignal,
): Promise<ProactiveDto> {
  try {
    const data = await apiFetch<{ suggestion: CanvasMessage | null }>(
      `/api/v1/threads/${encodeURIComponent(threadId)}/proactive`,
      { signal },
    );
    preferLiveApi();
    try {
      window.localStorage.removeItem(`${PROACTIVE_INJECT_PREFIX}${threadId}`);
    } catch {
      // ignore
    }
    return { suggestion: data.suggestion ?? null, mock: false };
  } catch (err) {
    if (err instanceof ApiError && err.status !== 404 && err.status !== 501 && err.status !== 0) {
      // continue to mock
    }
  }

  // 真 API 已可用但本拍 proactive 失败：安静，绝不回灌旧 Mock 盖住
  if (liveApi) {
    return { suggestion: null, mock: false };
  }

  if (opts.hasMessages) {
    return { suggestion: null, mock: true };
  }

  const injectedKey = `${PROACTIVE_INJECT_PREFIX}${threadId}`;
  try {
    if (window.localStorage.getItem(injectedKey) === '1') {
      return { suggestion: null, mock: true };
    }
  } catch {
    // ignore
  }

  const id = `mock-proactive-${threadId}`;
  const actions: MessageAction[] = [
    {
      id: 'mock-diagnose',
      label: '诊断',
      needsConfirm: false,
      riskNote: '只读演示，不改任何东西',
      demo: true,
    },
    {
      id: 'mock-approve-build',
      label: '批准重跑',
      needsConfirm: true,
      impact: '演示：假装批准一次本地构建（不会真的执行）',
      riskNote: '演示授权 · 无真实副作用',
      demo: true,
    },
    {
      id: 'mock-ignore',
      label: '忽略',
      needsConfirm: false,
      demo: true,
    },
  ];
  const suggestion: CanvasMessage = {
    id,
    role: 'assistant',
    content:
      '演示：有一件事值得看一眼——本地演示仓库的最近一次检查还没跟进。（这是假建议，尚未接真洞察。）',
    createdAt: new Date().toISOString(),
    adapter: 'mock',
    threadId,
    parts: [
      {
        type: 'text',
        text: '演示：有一件事值得看一眼——本地演示仓库的最近一次检查还没跟进。（这是假建议，尚未接真洞察。）',
      },
      { type: 'actions', actions },
    ],
  };
  saveMessageParts(id, suggestion.parts ?? []);
  appendLocalMessage(threadId, suggestion);
  try {
    window.localStorage.setItem(injectedKey, '1');
  } catch {
    // ignore
  }
  return { suggestion, mock: true };
}

export interface ExecuteActionResult {
  message: CanvasMessage;
  mock: boolean;
}

/** G4：执行行动后在同线程回写 ProgressBlock + 结果（Mock 本地模拟）。 */
export async function executeMessageAction(
  threadId: string,
  action: MessageAction,
  signal?: AbortSignal,
): Promise<ExecuteActionResult> {
  try {
    const data = await apiFetch<{ message: CanvasMessage }>(
      `/api/v1/threads/${encodeURIComponent(threadId)}/actions/${encodeURIComponent(action.id)}/execute`,
      { method: 'POST', json: { action }, signal },
    );
    if (data.message) {
      preferLiveApi();
      return { message: data.message, mock: false };
    }
  } catch {
    // mock path
  }

  // 真 API 会话下 execute 失败：抛给调用方，不伪造本地 Progress
  if (liveApi) {
    throw new ApiError(0, 'execute_unavailable', '行动执行接口不可用');
  }

  if (action.id === 'mock-ignore' || action.id === 'demo-ignore' || action.label === '忽略') {
    const message: CanvasMessage = {
      id: `mock-result-${Date.now()}`,
      role: 'assistant',
      content: '好，已忽略这条演示建议。',
      createdAt: new Date().toISOString(),
      adapter: 'mock',
      threadId,
      parts: [{ type: 'result', text: '好，已忽略这条演示建议。', ok: true }],
    };
    saveMessageParts(message.id, message.parts ?? []);
    appendLocalMessage(threadId, message);
    return { message, mock: true };
  }

  const runRef = `mock-run-${Date.now()}`;
  const steps: ProgressStep[] = [
    { name: '确认范围', status: 'done', detail: '演示步骤' },
    { name: action.needsConfirm ? '按批准执行' : '只读诊断', status: 'running', detail: '…' },
    { name: '汇总结果', status: 'pending' },
  ];
  const progressId = `mock-progress-${Date.now()}`;
  const progressMsg: CanvasMessage = {
    id: progressId,
    role: 'assistant',
    content: `正在处理「${action.label}」…`,
    createdAt: new Date().toISOString(),
    adapter: 'mock',
    threadId,
    parts: [{ type: 'progress', steps, runRef }],
  };
  saveMessageParts(progressId, progressMsg.parts ?? []);

  // 同步模拟短延迟由调用方 await；这里直接给终态消息，调用方可先插 progress 再换 result
  await new Promise<void>((resolve) => {
    const t = window.setTimeout(resolve, 700);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(t);
      resolve();
    });
  });

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
      detail: action.demo ? '假结果 · 未接真洞察/真构建' : '完成',
    },
  ];
  const resultText = action.demo
    ? `「${action.label}」演示跑通了：进度与结果留在本线程。这不是真实洞察或真实构建。`
    : `「${action.label}」已完成。`;
  const message: CanvasMessage = {
    id: progressId,
    role: 'assistant',
    content: resultText,
    createdAt: new Date().toISOString(),
    adapter: 'mock',
    threadId,
    parts: [
      { type: 'progress', steps: finalSteps, runRef },
      { type: 'result', text: resultText, ok: true },
    ],
  };
  saveMessageParts(message.id, message.parts ?? []);
  appendLocalMessage(threadId, message);
  touchLocalThread(threadId, resultText);
  return { message, mock: true };
}
