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

/** 本会话已探测到 G1–G4 真 API；此后不再用旧 Mock 叠层盖住服务端数据。 */
let liveApi = false;

export function isLiveApi(): boolean {
  return liveApi;
}

/** AppShell / 探测成功时调用：记录 liveApi 状态。原始本地历史数据完整保留，不执行删除。 */
export function preferLiveApi(): void {
  liveApi = true;
}

function isMockOverlayMessageId(id: string): boolean {
  return (
    id.startsWith('mock-proactive-') ||
    id.startsWith('mock-progress-') ||
    id.startsWith('mock-result-') ||
    id.startsWith('progress-pending-')
  );
}

/**
 * 历史数据完整保留，不删除 localStorage 中的消息或 parts。
 * 阻止旧模拟内容由读取和展示层过滤保证，保留原始数据以供审计。
 */
export function clearStaleMockOverlay(): void {
  // Deliberately no-op: raw local history and parts must remain intact for auditability.
  // Old mock overlays and actions are filtered out at the read/presentation layer.
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

/** 合并服务端历史 + 前端 Mock 叠加消息（同 id 去重，本地覆盖）。读取与展示层过滤掉旧 mock 模拟消息，不污染展示，且不删除存储。 */
export function mergeLocalMessages(threadId: string, server: CanvasMessage[]): CanvasMessage[] {
  const local = (readLocalMsgs()[threadId] ?? []).filter((m) => !isMockOverlayMessageId(m.id));
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
  // Do NOT re-attach browser-stored parts to server history.
  // Server history is the sole authoritative source of truth.
  const messages = server;
  const serverHasParts = server.some((m) => Array.isArray(m.parts) && m.parts.length > 0);
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
 * 服务端返回 suggestion: null 或 404/错误时，静默关闭，不伪造任何 Mock 建议。
 */
export async function fetchProactive(
  threadId: string,
  _opts?: { hasMessages?: boolean },
  signal?: AbortSignal,
): Promise<ProactiveDto> {
  try {
    const data = await apiFetch<{ suggestion: CanvasMessage | null }>(
      `/api/v1/threads/${encodeURIComponent(threadId)}/proactive`,
      { signal },
    );
    preferLiveApi();
    return { suggestion: data.suggestion ?? null, mock: false };
  } catch {
    // 404, 403, network failure, or unknown thread: fail closed, return null suggestion.
    return { suggestion: null, mock: false };
  }
}

export interface ExecuteActionResult {
  message: CanvasMessage;
  mock: boolean;
}

/**
 * 执行行动。服务端拒绝或不可用时直接抛错，绝不伪造本地进度或完成状态。
 */
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
    throw new ApiError(500, 'EMPTY_EXECUTE_RESPONSE', '执行接口未返回有效消息');
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError(0, 'EXECUTE_UNAVAILABLE', err instanceof Error ? err.message : '行动执行接口不可用');
  }
}
