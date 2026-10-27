import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ConnectionBadge, EmptyState, ErrorState, PageHeader } from '../components';
import { ApiError } from '../features/api/client';
import {
  fetchChatHistory,
  sendChatMessage,
  type ChatMessage,
  type ChatReplyDto,
} from '../features/chat';
import './ChatPage.css';

/** 安全的极简 Markdown 渲染：**粗体**、`code`、换行；绝不注入 HTML。 */
function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code key={key++} className="chat-code">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <article className={`chat-msg ${isUser ? 'chat-msg--user' : 'chat-msg--assistant'}`}>
      <header className="chat-msg__meta">
        <span className="chat-msg__role">{isUser ? '你' : 'Hearth · Mock'}</span>
        <time dateTime={msg.createdAt}>{formatTime(msg.createdAt)}</time>
      </header>
      <div className="chat-msg__body">
        {msg.content.split('\n').map((line, i) => (
          <p key={i}>{line.length === 0 ? '\u00A0' : renderInline(line)}</p>
        ))}
      </div>
    </article>
  );
}

function StepsTimeline({ steps }: { steps: NonNullable<ChatReplyDto['steps']> }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return (
    <div className="chat-steps">
      <button
        type="button"
        className="chat-steps__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '收起' : '展开'}本次生成步骤（{steps.length}）
      </button>
      {open && (
        <ol className="chat-steps__list">
          {steps.map((s, i) => (
            <li key={i}>
              <span className="chat-steps__name">{s.name}</span>
              <span className="chat-steps__detail">{s.detail}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [lastSteps, setLastSteps] = useState<ChatReplyDto['steps'] | null>(null);
  const [adapterLabel, setAdapterLabel] = useState<string>('离线演示 · 不连接模型');
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const history = await fetchChatHistory();
      setMessages(history.messages);
      if (history.live === false) setAdapterLabel('离线演示 · 不连接模型');
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : '无法加载聊天记录');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    setLastSteps(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    // 乐观追加用户消息（提交失败会回滚）
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      adapter: 'mock',
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    try {
      const out = await sendChatMessage(text, controller.signal);
      setMessages((prev) => {
        const withoutLocal = prev.filter((m) => m.id !== optimistic.id);
        return [...withoutLocal, out.reply];
      });
      setLastSteps(out.steps);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      setLoadError(err instanceof ApiError ? `发送失败：${err.message}` : '发送失败，请重试');
    } finally {
      clearTimeout(timer);
      setSending(false);
    }
  }, [draft, sending]);

  return (
    <section className="page chat-page">
      <PageHeader
        title="对话"
        subtitle="和 Hearth 讨论，或让它解释卡片背后的证据"
        actions={<ConnectionBadge mode="demo" label={adapterLabel} />}
      />
      <div className="chat-layout">
        <div className="chat-main">
          {loading ? (
            <div className="chat-loading" role="status">
              正在加载会话…
            </div>
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={() => void reload()} />
          ) : messages.length === 0 ? (
            <EmptyState
              title="开始一段对话"
              hint="回复由本机 Mock Adapter 生成，不连接任何模型；消息会保存在本地数据库"
            />
          ) : (
            <div className="chat-list" ref={listRef} aria-live="polite">
              {messages.map((m) => (
                <MessageBubble key={m.id} msg={m} />
              ))}
              {lastSteps && <StepsTimeline steps={lastSteps} />}
            </div>
          )}
          <form
            className="chat-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="chat-input" className="visually-hidden">
              输入消息
            </label>
            <textarea
              id="chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="例如：CI 失败了怎么办？（Enter 发送，Shift+Enter 换行）"
              rows={2}
              maxLength={4000}
              disabled={sending}
            />
            <button
              type="submit"
              disabled={sending || draft.trim().length === 0}
              title={sending ? '正在等待回复' : undefined}
            >
              {sending ? '发送中…' : '发送'}
            </button>
          </form>
          <p className="chat-hint">
            当前为离线演示模式：回复由确定性 Mock 生成并保存在本地，不代表任何真实模型输出。
          </p>
        </div>
      </div>
    </section>
  );
}
