import type { Storage } from '@hearth/storage';

export type ThreadScopeDenial = {
  status: 403 | 409;
  code: 'PROJECT_CHAT_UNAVAILABLE' | 'UNBOUND_THREAD_HISTORY';
  message: string;
};

export const PROJECT_CHAT_UNAVAILABLE: ThreadScopeDenial = {
  status: 403,
  code: 'PROJECT_CHAT_UNAVAILABLE',
  message: '项目内聊天暂不可用，已有记录不会删除。',
};

/** Legacy project IDs do not prove binding; orphan messages cannot be adopted. */
export function globalThreadDenial(storage: Storage, threadId: string): ThreadScopeDenial | null {
  const thread = storage.getThread(threadId);
  if (thread && thread.projectId !== null) return PROJECT_CHAT_UNAVAILABLE;
  if (!thread && storage.listChat(threadId, 1).length > 0) {
    return { status: 409, code: 'UNBOUND_THREAD_HISTORY', message: '旧聊天记录尚未绑定，暂不可读取或写入。' };
  }
  return null;
}
