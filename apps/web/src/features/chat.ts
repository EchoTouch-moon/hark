import { apiFetch } from './api/client';
import type { ChatMessage, ChatRole } from './api/types';

/** POST /api/v1/chat 响应（真实 Mock Adapter 生成） */
export interface ChatReplyDto {
  reply: ChatMessage;
  steps: Array<{ name: string; detail: string }>;
  adapter: string;
  live: boolean;
  label: string;
}

export interface ChatHistoryDto {
  messages: ChatMessage[];
  adapter: string;
  live: boolean;
}

const SESSION_ID = 'default';

export async function fetchChatHistory(signal?: AbortSignal): Promise<ChatHistoryDto> {
  return apiFetch<ChatHistoryDto>(`/api/v1/chat/history?sessionId=${encodeURIComponent(SESSION_ID)}`, {
    signal,
  });
}

export async function sendChatMessage(message: string, signal?: AbortSignal): Promise<ChatReplyDto> {
  return apiFetch<ChatReplyDto>('/api/v1/chat', {
    method: 'POST',
    json: { sessionId: SESSION_ID, message },
    signal,
  });
}

export type { ChatMessage, ChatRole };
