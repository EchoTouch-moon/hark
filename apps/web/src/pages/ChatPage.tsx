/**
 * 沉浸对话画布 · Style Bible v6 / v6.1 Ember Seed
 * 空态炉心 Seed → 首条后 Composer 落底；本地炉温；G1–G4 真 API 优先。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { gsap } from 'gsap';
import { HearthWelcome } from '../components/HearthWelcome';
import { emitEmberCue, isEmberMotionPaused } from '../features/ember-cues';
import { readWelcomePreference } from '../features/welcome';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useThreads } from '../app/AppShell';
import { ApiError } from '../features/api/client';
import { Link } from 'react-router-dom';
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
import { useViewModelSource } from '../features/hearthViewModel';
import { blockingError, ErrorBar, OpinionCard, StateNotices, StoryBeats } from '../components/ExperienceState';
import {
  useHearthTimeline,
  HEARTH_EASE,
  COMPOSER_FLIP_DURATION,
} from '../motion';
import './ChatPage.css';

// Unsaved drafts stay in memory only and are scoped to their own conversation.
const threadDrafts = new Map<string, string>();
const interruptedThreads = new Set<string>();

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
  _index,
  onAction,
  actionBusy,
}: {
  msg: CanvasMessage;
  _index?: number;
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

const SEED_CHIPS = [
  { id: 'project', label: '介绍我的项目' },
  { id: 'idea', label: '聊聊一个想法' },
];

function ComposerForm({
  draft,
  setDraft,
  sending,
  disabled,
  onSubmit,
  inputRef,
  placeholder,
}: {
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  disabled: boolean;
  onSubmit: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
}) {
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="canvas-input" className="visually-hidden">
        输入消息
      </label>
      <textarea
        id="canvas-input"
        ref={inputRef as RefObject<HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        rows={2}
        maxLength={4000}
        disabled={disabled}
        readOnly={sending}
      />
      <button
        type="submit"
        className="composer__send"
        disabled={sending || disabled}
        aria-disabled={sending || draft.trim().length === 0 || disabled || undefined}
        onClick={(e) => { if (draft.trim().length === 0) e.preventDefault(); }}
      >
        {sending ? '…' : '发送'}
      </button>
    </form>
  );
}

export function ChatPage() {
  const [welcomePreference] = useState(readWelcomePreference);
  const [welcomeVisible, setWelcomeVisible] = useState(!welcomePreference.completed);
  const [welcomeBlocking, setWelcomeBlocking] = useState(!welcomePreference.completed);
  const [displayName, setDisplayName] = useState(welcomePreference.name);
  const [arrival, setArrival] = useState(false);
  const columnRef = useRef<HTMLDivElement>(null);
  const { contextSafe } = useHearthTimeline({ scope: columnRef });
  const {
    activeThreadId,
    refreshThreads,
    recomputeEmber,
    emberBand,
    flameLife,
    hearthPeriod,
    motionPaused,
    welcomeReplay,
    setWelcomeReplay,
  } = useThreads();
  const [messages, setMessages] = useState<CanvasMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [interruptedNotice, setInterruptedNotice] = useState(false);
  const [motionScene, setMotionScene] = useState('rest');
  const pendingRequest = useRef<{ threadId: string; controller: AbortController; raw: string } | null>(null);
  const currentThread = useRef(activeThreadId);
  currentThread.current = activeThreadId;
  const updateDraft = useCallback((value: string) => {
    setDraft(value);
    if (currentThread.current) threadDrafts.set(currentThread.current, value);
  }, []);
  const slotRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const previousRect = useRef<ReturnType<NonNullable<typeof composerRef.current>['getBoundingClientRect']> | null>(null);
  const [pendingAction, setPendingAction] = useState<MessageAction | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);



  const vmSource = useViewModelSource();
  const vm = vmSource.kind === 'ready' ? vmSource.vm : null;
  const vmError = blockingError(vmSource);
  const seedCopy = { band: emberBand, reason: messages.some((m) => m.role === 'user') ? 'returning' : 'no-interaction' };

  const reload = useCallback(async (threadId: string) => {
    setLoading(true);
    setLoadError(null);
    // E1 runs on fixtures only: never call the legacy chat-history API.
    if (vmSource.kind === 'invalid' || vmSource.fixture) {
      if (currentThread.current === threadId) { setMessages([]); setLoading(false); }
      return;
    }
    try {
      const history = await fetchChatHistory(threadId);
      let next = history.messages;
      // Seed 判定看用户消息；proactive 可叠在空态上，不计入「已有对话」
      const hasUser = next.some((m) => m.role === 'user');
      const proactive = await fetchProactive(threadId, { hasMessages: hasUser });
      if (proactive.suggestion && !next.some((m) => m.id === proactive.suggestion!.id)) {
        next = [...next, proactive.suggestion];
      }
      if (currentThread.current === threadId) setMessages(next);
    } catch (err) {
      // 断网/API 失败：清空消息，仍走 Seed（轻提示），勿整页 ErrorState
      if (currentThread.current !== threadId) return;
      setMessages([]);
      setLoadError(err instanceof ApiError ? err.message : '无法加载聊天记录');
    } finally {
      if (currentThread.current === threadId) setLoading(false);
    }
  }, [vmSource]);

  // Switching conversations cancels only the local wait. Delivery may already
  // have occurred, so restore the original draft with an explicit warning.
  useEffect(() => {
    const pending = pendingRequest.current;
    if (pending && pending.threadId !== activeThreadId) {
      threadDrafts.set(pending.threadId, pending.raw);
      interruptedThreads.add(pending.threadId);
      pending.controller.abort();
      pendingRequest.current = null;
      setSending(false);
    }
    setDraft(activeThreadId ? threadDrafts.get(activeThreadId) ?? '' : '');
    setInterruptedNotice(activeThreadId ? interruptedThreads.has(activeThreadId) : false);
  }, [activeThreadId]);
  useEffect(() => () => {
    const pending = pendingRequest.current;
    if (pending) {
      threadDrafts.set(pending.threadId, pending.raw);
      interruptedThreads.add(pending.threadId);
      pending.controller.abort();
      pendingRequest.current = null;
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
    () => messages.some((m) => m.role === 'user' && !m.id.startsWith('local-')),
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

  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!activeThreadId || text.length === 0 || sending) return;
      setSending(true);
      setLoadError(null);
      interruptedThreads.delete(activeThreadId);
      setInterruptedNotice(false);
      const controller = new AbortController();
      const request = { threadId: activeThreadId, controller, raw };
      pendingRequest.current = request;
      const timer = window.setTimeout(() => controller.abort(), 15_000);
      const previousUserIds = new Set(messages.filter((message) => message.role === 'user').map((message) => message.id));
      let requestAccepted = false;
      const optimistic: CanvasMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
        adapter: 'mock',
        threadId: activeThreadId,
      };
      setMessages((prev) => [...prev, optimistic]);
      updateDraft('');

      try {
        emitEmberCue('waiting');
        await sendChatMessage(activeThreadId, text, controller.signal);
        requestAccepted = true;
        const confirmed = await fetchChatHistory(activeThreadId, controller.signal);
        if (!confirmed.confirmedUserMessages.some((message) => message.content === text && !previousUserIds.has(message.id))) {
          throw new Error('用户消息尚未确认保存');
        }
        if (currentThread.current !== activeThreadId || pendingRequest.current !== request) return;
        setMessages(confirmed.messages);
        emitEmberCue('acknowledged');
        setMotionScene(seedCopy.band === 'hot' ? 'settle' : seedCopy.reason === 'no-interaction' ? 'ignite' : 'rekindle');
        void refreshThreads();
        recomputeEmber();
      } catch (err) {
        if (currentThread.current !== activeThreadId || pendingRequest.current !== request) return;
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        updateDraft(raw);
        emitEmberCue('request-failed');
        setLoadError(requestAccepted ? '消息已发送，但暂时无法确认是否保存。请先查看会话，再决定是否重试。' : err instanceof ApiError ? `发送失败：${err.message}` : '发送失败，请重试');
      } finally {
        window.clearTimeout(timer);
        if (pendingRequest.current === request) {
          pendingRequest.current = null;
          setSending(false);
          if (currentThread.current === activeThreadId) requestAnimationFrame(() => inputRef.current?.focus());
        }
      }
    },
    [activeThreadId, sending, refreshThreads, recomputeEmber, seedCopy.band, seedCopy.reason, messages, updateDraft],
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

        recomputeEmber();
        void refreshThreads();
      } catch (err) {
        emitEmberCue('failed');
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

  const onChip = useCallback((label: string) => {
    updateDraft(label === '介绍我的项目' ? '我想介绍一下我的项目：' : '我有一个想法：');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [updateDraft]);


  // GSAP animation for new message entrance
  useHearthTimeline(() => {
    const list = listRef.current;
    if (!list) return;
    const unentered = list.querySelectorAll<HTMLElement>('.chat-msg:not([data-msg-enter="ready"])');
    if (unentered.length === 0) return;

    if (motionPaused || isEmberMotionPaused()) {
      unentered.forEach((el) => {
        el.dataset.msgEnter = 'ready';
      });
      return;
    }

    gsap.fromTo(
      unentered,
      { opacity: 0, y: 14 },
      {
        opacity: 1,
        y: 0,
        duration: 0.4,
        stagger: 0.06,
        ease: HEARTH_EASE.snap,
        clearProps: 'transform,opacity',
        onComplete: () => {
          unentered.forEach((el) => {
            el.dataset.msgEnter = 'ready';
          });
        },
      }
    );
  }, { scope: listRef, dependencies: [messages, motionPaused] });

  // GSAP animation for empty state seed glow breathing
  useHearthTimeline(() => {
    if (!showSeed || motionPaused || isEmberMotionPaused()) return;
    const glow = columnRef.current?.querySelector<HTMLElement>('.ember-seed__glow');
    if (!glow) return;
    const tween = gsap.fromTo(
      glow,
      { opacity: 0.70, scale: 0.98 },
      {
        opacity: 1.0,
        scale: 1.04,
        duration: 3.8,
        ease: HEARTH_EASE.breath,
        repeat: -1,
        yoyo: true,
      }
    );
    return () => {
      tween.kill();
    };
  }, { scope: columnRef, dependencies: [showSeed, motionPaused] });

  useHearthTimeline(() => {
    const node = composerRef.current;
    if (!node) return;
    const align = () => {
      node.style.top = showSeed && slotRef.current && columnRef.current
        ? `${slotRef.current.getBoundingClientRect().top - columnRef.current.getBoundingClientRect().top}px`
        : '';
    };
    align();
    const observer = new window.ResizeObserver(align);
    if (columnRef.current) observer.observe(columnRef.current);
    if (slotRef.current) observer.observe(slotRef.current);
    window.addEventListener('resize', align);
    const rect = node.getBoundingClientRect();
    const previous = previousRect.current;
    const media = gsap.matchMedia();
    media.add({ full: '(prefers-reduced-motion: no-preference)', reduced: '(prefers-reduced-motion: reduce)' }, (context) => {
      const still = motionPaused || isEmberMotionPaused() || context.conditions?.reduced;
      const timeline = gsap.timeline({ paused: true, defaults: { ease: HEARTH_EASE.snap } });
      if (previous && (Math.abs(previous.x - rect.x) > 1 || Math.abs(previous.y - rect.y) > 1)) {
        timeline.fromTo(node, { x: previous.x - rect.x, y: previous.y - rect.y }, { x: 0, y: 0, duration: COMPOSER_FLIP_DURATION, clearProps: 'transform' }, 0);
      }
      if (arrival && !welcomeBlocking) {
        timeline.fromTo(columnRef.current, { opacity: 0.3 }, { opacity: 1, duration: 0.7, clearProps: 'opacity' }, 0);
      }
      const visibility = () => {
        if (document.hidden) timeline.pause();
        else if (!still) timeline.resume();
      };
      document.addEventListener('visibilitychange', visibility);
      if (still) timeline.progress(1);
      else if (!document.hidden) timeline.play();
      return () => document.removeEventListener('visibilitychange', visibility);
    }, columnRef);
    previousRect.current = rect;
    return () => { media.revert(); observer.disconnect(); window.removeEventListener('resize', align); };
  }, { scope: columnRef, dependencies: [showSeed, loading, loadError, motionPaused, welcomeBlocking, arrival], revertOnUpdate: true });
  useEffect(() => { if (!loading && !welcomeBlocking) inputRef.current?.focus(); }, [showSeed, loading, welcomeBlocking]);
  useEffect(() => {
    const column = columnRef.current;
    if (welcomeBlocking) column?.setAttribute('inert', '');
    else column?.removeAttribute('inert');
    return () => column?.removeAttribute('inert');
  }, [welcomeBlocking]);
  useEffect(() => {
    if (!welcomeReplay) return;
    setWelcomeVisible(true);
    setWelcomeBlocking(true);
    setArrival(false);
    setWelcomeReplay(false);
  }, [welcomeReplay, setWelcomeReplay]);

  const finishWelcome = useCallback(() => {
    setWelcomeVisible(false);
    setArrival(false);
    inputRef.current?.focus();
  }, []);
  const startWelcomeExit = useCallback((name: string) => {
    setDisplayName(name);
    setWelcomeBlocking(false);
    setArrival(true);
  }, []);
  const chips = SEED_CHIPS;

  return (
    <section data-motion-engine="gsap" data-motion-paused={motionPaused} data-motion-scene={motionScene} data-arrival={arrival} className={`canvas-page${showSeed ? ' canvas-page--seed' : ' canvas-page--grown'}`}>
      <div ref={columnRef} aria-hidden={welcomeBlocking || undefined} className={`canvas-column${showSeed ? ' canvas-column--seed' : ' canvas-column--grown'}`}>
        {loading ? (
          <div className="chat-loading" role="status">
            正在加载…
          </div>
        ) : showSeed ? (
          <div className="ember-seed" data-ember-band={seedCopy.band} data-flame-stage={flameLife.stage}>
            <div className="ember-seed__glow" aria-hidden="true" />
            {vmError ? <ErrorBar message={vmError.message} code={vmError.code} /> : null}
            {vm && !vmError ? <StateNotices vm={vm} only="permission" /> : null}
            {vmError ? null : (
              <h1 className="ember-seed__greeting" data-flame-level={flameLife.level}>{displayName && vm?.status === 'empty' ? `${displayName}，从哪儿开始？` : flameLife.greeting}</h1>
            )}
            {vmError ? null : <p className="ember-seed__reason" aria-hidden="true">{flameLife.reason}</p>}
            {vm && !vmError ? <StateNotices vm={vm} only="stale" /> : null}
            <div ref={slotRef} className="ember-seed__composer-slot" aria-hidden="true" />
            {vmError ? null : <div className="ember-seed__chips" aria-label="开始讨论">
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
            </div>}
            <SeedActions vmError={!!vmError} status={vm?.status ?? null} />
            {vm && !vmError && vm.status === 'ok' ? (
              <>
                <OpinionCard vm={vm} />
                <StoryBeats story={vm.narrative.story} />
              </>
            ) : null}
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
                _index={i}
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

        {!loading ? (
          <div ref={composerRef} className={showSeed ? "narrative-composer narrative-composer--seed" : "narrative-composer composer-dock"}>
            {interruptedNotice && <p className="composer-status composer-status--warning" role="alert">切换时中断了发送，消息可能已经送达。请先检查会话，再决定是否重试。</p>}
            {sending && <p className="composer-status" role="status">正在等待本机演示回复…</p>}
            <ComposerForm
              draft={draft}
              setDraft={updateDraft}
              sending={sending}
              disabled={!activeThreadId}
              onSubmit={() => void sendText(draft)}
              inputRef={inputRef}
              placeholder={showSeed ? "说说你正在想的事…" : "继续说说你的想法…"}
            />
          </div>
        ) : null}
      </div>

      {welcomeVisible && <HearthWelcome initialName={displayName} paused={motionPaused} period={hearthPeriod} onExitStart={startWelcomeExit} onComplete={finishWelcome} />}
      <ConfirmSheet
        open={pendingAction !== null}
        title="需要你确认"
        what={pendingAction ? `要执行「${pendingAction.label}」` : ''}
        impact={pendingAction?.impact}
        riskNote={pendingAction?.riskNote}
        confirmText="批准"
        cancelText="拒绝"
        busy={actionBusy}
        onCancel={() => { setPendingAction(null); emitEmberCue('declined'); }}
        onConfirm={() => {
          if (pendingAction) void runAction(pendingAction);
        }}
      />
    </section>
  );
}

/**
 * Text actions below the Seed (spec 2026-10-31). Never calls /api/v1/discover:
 * ok/stale → 重新扫描 (visual no-op); permission_denied → disabled + 去授权;
 * error → 重新读取 (re-runs the ViewModel load only); empty → 添加项目.
 */
function SeedActions({ vmError, status }: { vmError: boolean; status: string | null }) {
  if (vmError) {
    // Fixture mode: the ViewModel load is synchronous and local, so this is a no-op re-read.
    return <div className="xp-seed-actions"><button type="button" className="xp-text-btn">重新读取</button></div>;
  }
  if (status === 'empty') {
    return <div className="xp-seed-actions"><Link to="/projects" className="xp-primary-btn">添加项目</Link></div>;
  }
  if (status === 'permission_denied') {
    return (
      <div className="xp-seed-actions">
        <button type="button" className="xp-text-btn" aria-disabled="true" disabled title="未授权读取，无法扫描">重新扫描</button>
        <Link to="/settings" className="xp-text-btn">去授权</Link>
      </div>
    );
  }
  return <div className="xp-seed-actions"><button type="button" className="xp-text-btn">重新扫描</button></div>;
}
