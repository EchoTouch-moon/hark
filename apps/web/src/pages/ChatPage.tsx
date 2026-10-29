/**
 * 沉浸对话画布 · Style Bible v6 / v6.1 Ember Seed
 * 空态炉心 Seed → 首条后 Composer 落底；本地炉温；G1–G4 真 API 优先。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useThreads } from '../app/AppShell';
import { ApiError } from '../features/api/client';
import {
  appendLocalMessage,
  executeMessageAction,
  fetchChatHistory,
  fetchProactive,
  isLiveApi,
  sendChatMessage,
  type CanvasMessage,
  type MessageAction,
  type ProgressStep,
} from '../features/chat';
import {
  computeEmberHeat,
  markSessionSent,
  type EmberBand,
} from '../features/emberHeat';
import './ChatPage.css';

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

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** CSS 火焰 widget（无 keyframe PNG 时对齐 v6.1：外焰+内芯+煤底+aura） */
function EmberFlame({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`ember-flame${compact ? ' ember-flame--compact' : ''}`}
      aria-hidden="true"
    >
      <span className="ember-flame__aura" />
      <span className="ember-flame__outer" />
      <span className="ember-flame__inner" />
      <span className="ember-flame__coal" />
    </div>
  );
}

function ProgressBlock({ steps, runRef }: { steps: ProgressStep[]; runRef?: string }) {
  const [openEvidence, setOpenEvidence] = useState(false);
  return (
    <div className="progress-block" aria-label="执行进度">
      <ol className="progress-block__list">
        {steps.map((s, i) => (
          <li key={`${s.name}-${i}`} className={`progress-block__step is-${s.status}`}>
            <span className="progress-block__status" aria-hidden="true">
              {s.status === 'done' ? '✓' : s.status === 'failed' ? '!' : s.status === 'running' ? '…' : '·'}
            </span>
            <span className="progress-block__name">{s.name}</span>
            {s.detail ? <span className="progress-block__detail">{s.detail}</span> : null}
          </li>
        ))}
      </ol>
      {runRef ? (
        <div className="progress-block__evidence">
          <button
            type="button"
            className="progress-block__evidence-toggle"
            onClick={() => setOpenEvidence((v) => !v)}
          >
            {openEvidence ? '收起原始证据' : '查看原始证据'}
          </button>
          {openEvidence ? (
            <p className="progress-block__evidence-body">
              runRef <code className="chat-code">{runRef}</code>
              （演示引用；完整证据不跳 Activity 首页）
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AgentActions({
  actions,
  disabled,
  onAction,
}: {
  actions: MessageAction[];
  disabled?: boolean;
  onAction: (action: MessageAction) => void;
}) {
  // 合同：≤2 chip；忽略作文字链
  const primary = actions.filter((a) => a.label !== '忽略').slice(0, 2);
  const ignore = actions.find((a) => a.label === '忽略');
  return (
    <div className="agent-actions">
      <p className="agent-actions__whisper">炉边敲一下</p>
      <div className="agent-actions__row">
        {primary.map((a) => (
          <button
            key={a.id}
            type="button"
            className="agent-action"
            disabled={disabled}
            onClick={() => onAction(a)}
          >
            {a.label}
          </button>
        ))}
      </div>
      {ignore ? (
        <button
          type="button"
          className="agent-action-ignore"
          disabled={disabled}
          onClick={() => onAction(ignore)}
        >
          忽略
        </button>
      ) : null}
      {primary.some((a) => a.demo || a.riskNote) ? (
        <p className="agent-actions__note">
          {primary.find((a) => a.riskNote)?.riskNote ?? '演示行动 · 尚未接真洞察'}
        </p>
      ) : null}
    </div>
  );
}

function MessageTurn({
  msg,
  index,
  onAction,
  actionBusy,
}: {
  msg: CanvasMessage;
  index: number;
  onAction: (action: MessageAction) => void;
  actionBusy: boolean;
}) {
  const isUser = msg.role === 'user';
  const textPart = msg.parts?.find((p) => p.type === 'text');
  const body = textPart && textPart.type === 'text' ? textPart.text : msg.content;
  const actionsPart = msg.parts?.find((p) => p.type === 'actions');
  const progressPart = msg.parts?.find((p) => p.type === 'progress');
  const resultPart = msg.parts?.find((p) => p.type === 'result');

  return (
    <article
      className={`chat-msg ${isUser ? 'chat-msg--user' : 'chat-msg--assistant'}`}
      style={{ animationDelay: `${Math.min(index, 8) * 80}ms` }}
    >
      <header className="chat-msg__meta">
        <span className="chat-msg__role">{isUser ? '你' : 'Hearth'}</span>
        <time dateTime={msg.createdAt}>{formatTime(msg.createdAt)}</time>
      </header>
      <div className="chat-msg__body">
        {body.split('\n').map((line, i) => (
          <p key={i}>{line.length === 0 ? '\u00A0' : renderInline(line)}</p>
        ))}
      </div>
      {actionsPart && actionsPart.type === 'actions' ? (
        <div className="mini-card">
          <AgentActions
            actions={actionsPart.actions}
            disabled={actionBusy}
            onAction={onAction}
          />
        </div>
      ) : null}
      {progressPart && progressPart.type === 'progress' ? (
        <ProgressBlock steps={progressPart.steps} runRef={progressPart.runRef} />
      ) : null}
      {resultPart && resultPart.type === 'result' ? (
        <p className={`chat-msg__result${resultPart.ok ? '' : ' is-fail'}`}>{resultPart.text}</p>
      ) : null}
    </article>
  );
}

const SEED_CHIPS_HOT = [
  { id: 'continue', label: '接着刚才的说' },
  { id: 'today', label: '今天想先办啥' },
  { id: 'play', label: '随便聊聊' },
];
const SEED_CHIPS_WARM = [
  { id: 'catchup', label: '回来了，说两句' },
  { id: 'todo', label: '帮我理一下待办' },
  { id: 'play', label: '随便聊聊' },
];
const SEED_CHIPS_COOL = [
  { id: 'reignite', label: '吹一口气' },
  { id: 'hello', label: '还在吗' },
];

function seedChipsFor(band: EmberBand) {
  if (band === 'hot') return SEED_CHIPS_HOT;
  if (band === 'cool') return SEED_CHIPS_COOL;
  return SEED_CHIPS_WARM;
}

function ComposerForm({
  draft,
  setDraft,
  sending,
  disabled,
  onSubmit,
  inputRef,
  placeholder,
  withFlameMark,
}: {
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  disabled: boolean;
  onSubmit: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  withFlameMark?: boolean;
}) {
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {withFlameMark ? <EmberFlame compact /> : null}
      <label htmlFor="canvas-input" className="visually-hidden">
        输入消息
      </label>
      <textarea
        id="canvas-input"
        ref={inputRef as RefObject<HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        rows={2}
        maxLength={4000}
        disabled={disabled || sending}
      />
      <button
        type="submit"
        className="composer__send"
        disabled={sending || draft.trim().length === 0 || disabled}
      >
        {sending ? '…' : '发送'}
      </button>
    </form>
  );
}

export function ChatPage() {
  const {
    activeThreadId,
    threads,
    refreshThreads,
    recomputeEmber,
    emberBand,
  } = useThreads();
  const [messages, setMessages] = useState<CanvasMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [pendingAction, setPendingAction] = useState<MessageAction | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  const seedCopy = useMemo(
    () =>
      computeEmberHeat({
        threadId: activeThreadId,
        threadUpdatedAt: activeThread?.updatedAt,
      }),
    [activeThreadId, activeThread?.updatedAt, emberBand],
  );

  const reload = useCallback(async (threadId: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const history = await fetchChatHistory(threadId);
      let next = history.messages;
      // Seed 判定看用户消息；proactive 可叠在空态上，不计入「已有对话」
      const hasUser = next.some((m) => m.role === 'user');
      const proactive = await fetchProactive(threadId, { hasMessages: hasUser });
      if (proactive.suggestion && !next.some((m) => m.id === proactive.suggestion!.id)) {
        next = [...next, proactive.suggestion];
      }
      setMessages(next);
    } catch (err) {
      // 断网/API 失败：清空消息，仍走 Seed（轻提示），勿整页 ErrorState
      setMessages([]);
      setLoadError(err instanceof ApiError ? err.message : '无法加载聊天记录');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeThreadId) {
      setLoading(false);
      setMessages([]);
      return;
    }
    void reload(activeThreadId);
  }, [activeThreadId, reload]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  /** 合同：无用户正文 = Seed；单张 G3 主动卡旁挂不切 grown；首条用户/进度结果 → grown */
  const hasUserMessage = useMemo(
    () => messages.some((m) => m.role === 'user'),
    [messages],
  );
  const showSeed = useMemo(() => {
    if (loading) return false;
    if (hasUserMessage) return false;
    const assistants = messages.filter((m) => m.role === 'assistant');
    if (assistants.length === 0) return true;
    if (assistants.length === 1) {
      const m = assistants[0]!;
      const leftSeed = m.parts?.some(
        (p) => p.type === 'progress' || p.type === 'result',
      );
      return !leftSeed;
    }
    return false;
  }, [loading, hasUserMessage, messages]);
  const seedOverlays = useMemo(() => {
    if (!showSeed) return [] as CanvasMessage[];
    return messages.filter((m) => m.role === 'assistant').slice(0, 1);
  }, [showSeed, messages]);

  useEffect(() => {
    if (showSeed) {
      inputRef.current?.focus();
    }
  }, [showSeed, activeThreadId]);

  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!activeThreadId || text.length === 0 || sending) return;
      setSending(true);
      setLoadError(null);
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15_000);
      const optimistic: CanvasMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
        adapter: 'mock',
        threadId: activeThreadId,
      };
      setMessages((prev) => [...prev, optimistic]);
      setDraft('');
      markSessionSent(activeThreadId);
      recomputeEmber();
      try {
        const out = await sendChatMessage(activeThreadId, text, controller.signal);
        setMessages((prev) => {
          const withoutLocal = prev.filter((m) => m.id !== optimistic.id);
          const userKept: CanvasMessage = {
            ...optimistic,
            id: `user-${Date.now()}`,
          };
          return [...withoutLocal, userKept, out.reply];
        });
        void refreshThreads();
        recomputeEmber();
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(text);
        setLoadError(err instanceof ApiError ? `发送失败：${err.message}` : '发送失败，请重试');
      } finally {
        window.clearTimeout(timer);
        setSending(false);
      }
    },
    [activeThreadId, sending, refreshThreads, recomputeEmber],
  );

  const runAction = useCallback(
    async (action: MessageAction) => {
      if (!activeThreadId || actionBusy) return;
      setActionBusy(true);
      setPendingAction(null);
      try {
        setMessages((prev) => {
          const next = prev.map((m) => {
            if (!m.parts?.some((p) => p.type === 'actions')) return m;
            const patched = {
              ...m,
              parts: m.parts.filter((p) => p.type !== 'actions'),
            };
            if (!isLiveApi()) appendLocalMessage(activeThreadId, patched);
            return patched;
          });
          return next;
        });
        const placeholderId = `progress-pending-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: placeholderId,
            role: 'assistant',
            content: `正在处理「${action.label}」…`,
            createdAt: new Date().toISOString(),
            adapter: 'mock',
            threadId: activeThreadId,
            parts: [
              {
                type: 'progress',
                steps: [
                  { name: '确认范围', status: 'done' },
                  { name: action.label, status: 'running' },
                  { name: '汇总结果', status: 'pending' },
                ],
                runRef: 'pending',
              },
            ],
          },
        ]);
        const result = await executeMessageAction(activeThreadId, action);
        setMessages((prev) => prev.map((m) => (m.id === placeholderId ? result.message : m)));
        markSessionSent(activeThreadId);
        recomputeEmber();
        void refreshThreads();
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : '行动执行失败');
      } finally {
        setActionBusy(false);
      }
    },
    [activeThreadId, actionBusy, refreshThreads, recomputeEmber],
  );

  const onAction = useCallback(
    (action: MessageAction) => {
      if (action.needsConfirm) {
        setPendingAction(action);
        return;
      }
      void runAction(action);
    },
    [runAction],
  );

  const onChip = useCallback(
    (label: string) => {
      if (label === '吹一口气' || label === '还在吗') {
        void sendText(label === '吹一口气' ? '吹一口气，火会回来。' : '还在吗？');
        return;
      }
      setDraft(label);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [sendText],
  );

  const chips = seedChipsFor(seedCopy.band);

  return (
    <section className={`canvas-page${showSeed ? ' canvas-page--seed' : ' canvas-page--grown'}`}>
      <div className={`canvas-column${showSeed ? ' canvas-column--seed' : ' canvas-column--grown'}`}>
        {loading ? (
          <div className="chat-loading" role="status">
            正在加载…
          </div>
        ) : showSeed ? (
          <div className="ember-seed" data-ember-band={seedCopy.band}>
            <div className="ember-seed__glow" aria-hidden="true" />
            <EmberFlame />
            <p className="ember-seed__greeting">{seedCopy.greeting}</p>
            {seedCopy.subline ? (
              <p className="ember-seed__subline">{seedCopy.subline}</p>
            ) : null}
            <div className="ember-seed__composer-slot">
              <ComposerForm
                draft={draft}
                setDraft={setDraft}
                sending={sending}
                disabled={!activeThreadId}
                onSubmit={() => void sendText(draft)}
                inputRef={inputRef}
                placeholder="从炉边说一句…"
              />
            </div>
            <div className="ember-seed__chips" aria-label="好玩入口">
              {chips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="seed-chip"
                  disabled={sending || !activeThreadId}
                  onClick={() => onChip(c.label)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {seedOverlays.map((m) => {
              const textPart = m.parts?.find((p) => p.type === 'text');
              const body =
                textPart && textPart.type === 'text' ? textPart.text : m.content;
              const actionsPart = m.parts?.find((p) => p.type === 'actions');
              return (
                <div key={m.id} className="ember-seed__tap mini-card">
                  {body ? <p className="ember-seed__tap-body">{body}</p> : null}
                  {actionsPart && actionsPart.type === 'actions' ? (
                    <AgentActions
                      actions={actionsPart.actions}
                      disabled={actionBusy}
                      onAction={onAction}
                    />
                  ) : null}
                </div>
              );
            })}
            {loadError ? (
              <p className="chat-inline-error ember-seed__error" role="alert">
                {loadError}
                {activeThreadId ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="ember-seed__retry"
                      onClick={() => void reload(activeThreadId)}
                    >
                      重试
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="chat-list" ref={listRef} aria-live="polite">
            {messages.map((m, i) => (
              <MessageTurn
                key={m.id}
                msg={m}
                index={i}
                onAction={onAction}
                actionBusy={actionBusy}
              />
            ))}
          </div>
        )}

        {loadError && hasUserMessage ? (
          <p className="chat-inline-error" role="alert">
            {loadError}
          </p>
        ) : null}

        {!showSeed && !loading ? (
          <div className="composer-dock">
            <ComposerForm
              draft={draft}
              setDraft={setDraft}
              sending={sending}
              disabled={!activeThreadId}
              onSubmit={() => void sendText(draft)}
              inputRef={inputRef}
              placeholder="你想先处理什么？"
              withFlameMark
            />
          </div>
        ) : null}
      </div>

      <ConfirmSheet
        open={pendingAction !== null}
        title="需要你确认"
        what={pendingAction ? `要执行「${pendingAction.label}」` : ''}
        impact={pendingAction?.impact}
        riskNote={pendingAction?.riskNote}
        confirmText="批准"
        cancelText="拒绝"
        busy={actionBusy}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (pendingAction) void runAction(pendingAction);
        }}
      />
    </section>
  );
}
