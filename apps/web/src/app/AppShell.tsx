/**
 * CanvasShell · Style Bible v6 Ember Seed
 * 顶栏：聊天|项目 + 搜索/头像；极简可收 thread rail；设置从头像进。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ElementRef,
} from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  createThread,
  getActiveThreadId,
  listThreads,
  setActiveThreadId,
  type ThreadSummary,
} from '../features/threads';
import { fetchChatHistory, preferLiveApi, type ConfirmedUserMessage } from '../features/chat';
import {
  applyEmberHeatCss,
  computeEmberHeat,
  latestConfirmedInteraction,
  confirmedInteractionTimes,
  type EmberBand,
} from '../features/emberHeat';
import { deriveProjectFlame, type ProjectFlameInfo } from '../features/projectEmber';
import { fetchProjectSnapshot } from '../features/projects';
import { EmberAtmosphere } from '../components/EmberAtmosphere';
import { getHearthPeriod, type HearthPeriod } from '../features/hearthPeriod';
import { readFlameSize, saveFlameSize } from '../features/flameSize';
import { emitEmberCue, isEmberMotionPaused } from '../features/ember-cues';
import { readWelcomePreference } from '../features/welcome';
import { useHearthTimeline, HEARTH_EASE } from '../motion';
import { gsap } from 'gsap';
import './AppShell.css';

/* ------------------------------------------------------------------ */
/* Detail Drawer 兼容插槽（v2 默认不用） */
/* ------------------------------------------------------------------ */

export interface DetailDrawerValue {
  content: ReactNode | null;
  setContent: (content: ReactNode | null) => void;
}

const DetailDrawerContext = createContext<DetailDrawerValue | null>(null);

export function useDetailDrawer(): DetailDrawerValue {
  const value = useContext(DetailDrawerContext);
  if (value === null) {
    throw new Error('useDetailDrawer 必须在 AppShell 内部使用');
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Thread 上下文 */
/* ------------------------------------------------------------------ */

export type ShellMode = 'chat' | 'projects';

export interface ThreadContextValue {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  threadsMock: boolean;
  railCollapsed: boolean;
  setRailCollapsed: (v: boolean) => void;
  shellMode: ShellMode;
  setShellMode: (m: ShellMode) => void;
  emberBand: EmberBand;
  emberHeat: number;
  flameLife: ProjectFlameInfo;
  hearthPeriod: HearthPeriod;
  refreshThreads: () => Promise<void>;
  selectThread: (id: string) => void;
  addThread: () => Promise<void>;
  /** ChatPage 发送后刷新炉温 */
  recomputeEmber: () => void;
  motionPaused: boolean;
  setMotionPaused: (paused: boolean) => void;
  welcomeActive: boolean;
  setWelcomeActive: (active: boolean) => void;
  welcomeReplay: boolean;
  setWelcomeReplay: (value: boolean) => void;
}

const ThreadContext = createContext<ThreadContextValue | null>(null);

export function useThreads(): ThreadContextValue {
  const value = useContext(ThreadContext);
  if (value === null) {
    throw new Error('useThreads 必须在 AppShell 内部使用');
  }
  return value;
}

function isCanvasPath(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/t/');
}

function ThreadRail({
  threads,
  activeThreadId,
  collapsed,
  filter,
  onFilter,
  onToggle,
  onSelect,
  onCreate,
}: {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  collapsed: boolean;
  filter: string;
  onFilter: (value: string) => void;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const q = filter.trim().toLowerCase();
  const visible = q
    ? threads.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.preview ?? '').toLowerCase().includes(q),
      )
    : threads;

  if (collapsed) {
    return (
      <aside className="thread-rail thread-rail--collapsed" aria-label="线程侧栏（已收起）">
        <button
          type="button"
          className="thread-rail__expand"
          aria-label="展开线程列表"
          onClick={onToggle}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 4h10M3 8h10M3 12h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside className="thread-rail" aria-label="线程">
      <div className="thread-rail__head">
        <div className="thread-rail__brand">
            <span className="thread-rail__name">Hearth</span>
        </div>
        <button
          type="button"
          className="thread-rail__collapse"
          aria-label="收起侧栏"
          onClick={onToggle}
        >
          «
        </button>
      </div>

      <div className="thread-rail__actions">
        <button type="button" className="thread-rail__new" onClick={onCreate}>
          新线程
        </button>
      </div>

      <label className="thread-search">
        <span className="visually-hidden">搜索对话</span>
        <input type="search" aria-label="搜索对话" placeholder="搜索对话…" value={filter} onChange={(event) => onFilter(event.target.value)} />
      </label>
      <ul className="thread-list">
        {visible.map((t) => {
          const active = t.id === activeThreadId;
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`thread-item${active ? ' is-active' : ''}`}
                onClick={() => onSelect(t.id)}
                aria-current={active ? 'true' : undefined}
              >
                <span className="thread-item__title">{t.title}</span>
                {t.preview ? <span className="thread-item__preview">{t.preview}</span> : null}
              </button>
            </li>
          );
        })}
        {visible.length === 0 ? (
          <li className="thread-list__empty">无匹配线程</li>
        ) : null}
      </ul>
    </aside>
  );
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [drawerContent, setDrawerContent] = useState<ReactNode | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsMock, setThreadsMock] = useState(true);
  const [activeThreadId, setActiveId] = useState<string | null>(null);
  const [shellMode, setShellMode] = useState<ShellMode>('chat');
  const [motionPaused, setMotionPaused] = useState(isEmberMotionPaused);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => {
      setReducedMotion(media.matches);
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);
  const [flameSize, setFlameSize] = useState(readFlameSize);
  const [welcomeReplay, setWelcomeReplay] = useState(false);
  const [welcomeActive, setWelcomeActive] = useState(() => !readWelcomePreference().completed);
  const handleSetWelcomeReplay = useCallback((value: boolean) => {
    setWelcomeReplay(value);
    if (value) setWelcomeActive(true);
  }, []);
  const menuRef = useRef<ElementRef<'details'>>(null);
  useEffect(() => {
    document.documentElement.dataset.motionPaused = String(motionPaused || reducedMotion || isEmberMotionPaused());
    emitEmberCue('motion-preference', motionPaused);
    return () => {
      delete document.documentElement.dataset.motionPaused;
    };
  }, [motionPaused, reducedMotion]);
  const [searchQuery, setSearchQuery] = useState('');
  const [emberTick, setEmberTick] = useState(0);
  // History is always an on-demand surface; re-entering opens the conversation.
  const [railCollapsed, setRailCollapsed] = useState(true);

  const refreshThreads = useCallback(async () => {
    const listed = await listThreads();
    setThreads(listed.threads);
    setThreadsMock(listed.mock);
    if (!listed.mock) preferLiveApi();
    const fromQuery = searchParams.get('thread');
    const fromPath = location.pathname.startsWith('/t/')
      ? location.pathname.slice(3).split('/')[0]
      : null;
    const preferred =
      fromQuery ||
      fromPath ||
      getActiveThreadId() ||
      listed.threads[0]?.id ||
      'thread-default';
    if (preferred) {
      setActiveId(preferred);
      setActiveThreadId(preferred);
    }
  }, [location.pathname, searchParams]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  useEffect(() => {
    setDrawerContent(null);
  }, [location.pathname]);


  const [confirmedState, setConfirmedState] = useState<{
    threadId: string;
    at: string | null;
    times: string[];
    confirmedUserMessages: ConfirmedUserMessage[];
  } | null>(null);
  const [projectFlameContext, setProjectFlameContext] = useState<{
    project: {
      enabled?: boolean;
      createdAt?: string;
      lastObservedAt?: string | null;
      testStatus?: string;
      openInsightCount?: number;
      unborn?: boolean;
    } | null;
    cardsSummary: {
      total: number;
      completed: number;
      active: number;
      failed: number;
    } | null;
  }>({ project: null, cardsSummary: null });
  const [nowMs, setNowMs] = useState(Date.now);

  useEffect(() => {
    const controller = new AbortController();
    if (activeThreadId) {
      void fetchChatHistory(activeThreadId, controller.signal)
        .then((history) => {
          if (!controller.signal.aborted) {
            setConfirmedState({
              threadId: activeThreadId,
              at: latestConfirmedInteraction(history.confirmedUserMessages),
              times: confirmedInteractionTimes(history.confirmedUserMessages),
              confirmedUserMessages: history.confirmedUserMessages,
            });
            setNowMs(Date.now());
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setConfirmedState(null);
        });
    }
    return () => controller.abort();
  }, [activeThreadId, emberTick]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId),
    [threads, activeThreadId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const projectId = activeThread?.projectId;
    if (projectId) {
      void fetchProjectSnapshot(projectId, controller.signal)
        .then((snap) => {
          if (!controller.signal.aborted) {
            setProjectFlameContext({
              project: {
                enabled: true,
                lastObservedAt: snap.events[0]?.occurredAt ?? snap.events[0]?.source.observedAt ?? null,
                testStatus: snap.runs[0]?.state,
                openInsightCount: snap.events.length,
                unborn: false,
              },
              cardsSummary: {
                total: snap.cards.length,
                completed: snap.cards.filter((c) => c.status === 'completed').length,
                active: snap.cards.filter((c) =>
                  ['executing', 'ready', 'awaiting_approval', 'verifying'].includes(c.status),
                ).length,
                failed: snap.cards.filter((c) => c.status === 'failed').length,
              },
            });
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setProjectFlameContext({ project: null, cardsSummary: null });
          }
        });
    } else {
      setProjectFlameContext({ project: null, cardsSummary: null });
    }
    return () => controller.abort();
  }, [activeThread?.projectId, emberTick]);

  useEffect(() => {
    const update = () => {
      document.documentElement.dataset.pageHidden = String(document.hidden);
      if (!document.hidden) setNowMs(Date.now());
    };
    update();
    document.addEventListener('visibilitychange', update);
    const timer = window.setInterval(update, 60000);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  const hearthPeriod = getHearthPeriod(new Date(nowMs));
  const ember = computeEmberHeat({
    lastConfirmedAt: confirmedState?.threadId === activeThreadId ? confirmedState.at : null,
    interactionTimes: confirmedState?.threadId === activeThreadId ? confirmedState.times : [],
    nowMs,
  });

  const flameLife = useMemo(() => {
    return deriveProjectFlame({
      project: projectFlameContext.project,
      confirmedUserMessages:
        confirmedState?.threadId === activeThreadId ? confirmedState.confirmedUserMessages : [],
      cardsSummary: projectFlameContext.cardsSummary,
      nowMs,
    });
  }, [projectFlameContext, confirmedState, activeThreadId, nowMs]);

  useEffect(() => {
    applyEmberHeatCss(flameLife.heat);
  }, [flameLife.heat]);

  const shellRef = useRef<HTMLDivElement>(null);
  const { contextSafe } = useHearthTimeline({ scope: shellRef });

  const topVitalityBarRef = useRef<globalThis.HTMLDivElement>(null);
  const menuVitalityBarRef = useRef<globalThis.HTMLDivElement>(null);
  const topStageBadgeRef = useRef<globalThis.HTMLSpanElement>(null);
  const menuStageBadgeRef = useRef<globalThis.HTMLSpanElement>(null);
  const menuHeatLabelRef = useRef<globalThis.HTMLSpanElement>(null);
  const prevStageRef = useRef(flameLife.stage);

  // Smooth GSAP animation for vitality bars, numeric % counter, and stage badge flares
  useHearthTimeline(() => {
    const isPaused = motionPaused || reducedMotion || isEmberMotionPaused();
    const targetPct = Math.round(flameLife.heat * 100);
    const duration = isPaused ? 0 : 0.85;

    if (topVitalityBarRef.current) {
      gsap.to(topVitalityBarRef.current, {
        width: `${targetPct}%`,
        duration,
        ease: HEARTH_EASE.gentle,
      });
    }

    if (menuVitalityBarRef.current) {
      gsap.to(menuVitalityBarRef.current, {
        width: `${targetPct}%`,
        duration,
        ease: HEARTH_EASE.gentle,
      });
    }

    if (menuHeatLabelRef.current) {
      if (isPaused) {
        menuHeatLabelRef.current.textContent = `${targetPct}% 活力`;
      } else {
        const currentText = menuHeatLabelRef.current.textContent ?? '';
        const match = /(\d+)/.exec(currentText);
        const startVal = match ? parseInt(match[1]!, 10) : targetPct;
        const counter = { val: startVal };
        gsap.to(counter, {
          val: targetPct,
          duration,
          ease: HEARTH_EASE.gentle,
          onUpdate: () => {
            if (menuHeatLabelRef.current) {
              menuHeatLabelRef.current.textContent = `${Math.round(counter.val)}% 活力`;
            }
          },
        });
      }
    }

    if (prevStageRef.current !== flameLife.stage) {
      prevStageRef.current = flameLife.stage;
      if (!isPaused) {
        if (topStageBadgeRef.current) {
          gsap.fromTo(
            topStageBadgeRef.current,
            { scale: 1.18, opacity: 0.8 },
            { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(1.6)' }
          );
        }
        if (menuStageBadgeRef.current) {
          gsap.fromTo(
            menuStageBadgeRef.current,
            { scale: 1.18, opacity: 0.8 },
            { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(1.6)' }
          );
        }
      }
    }
  }, { dependencies: [flameLife.heat, flameLife.stage, motionPaused, reducedMotion] });

  const handleTopBarStoke = useCallback(
    contextSafe((btn?: HTMLElement) => {
      emitEmberCue('stoke');
      const isPaused = motionPaused || reducedMotion || isEmberMotionPaused();
      if (btn && !isPaused) {
        gsap.timeline()
          .to(btn, { scale: 0.94, duration: 0.08, ease: 'power2.in' })
          .to(btn, { scale: 1.06, duration: 0.16, ease: 'back.out(2)' })
          .to(btn, {
            scale: 1,
            duration: 0.12,
            onComplete: () => {
              menuRef.current?.removeAttribute('open');
            },
          });
      } else {
        menuRef.current?.removeAttribute('open');
      }
    }),
    [contextSafe, motionPaused, reducedMotion]
  );

  const recomputeEmber = useCallback(() => {
    setEmberTick((n) => n + 1);
  }, []);

  const selectThread = useCallback(
    (id: string) => {
      setActiveId(id);
      setActiveThreadId(id);
      setShellMode('chat');
      setRailCollapsed(true);
      const target = `/t/${encodeURIComponent(id)}`;
      if (location.pathname !== target) navigate(target);
    },
    [location.pathname, navigate],
  );

  const addThread = useCallback(async () => {
    const { thread } = await createThread({ title: '新线程' });
    await refreshThreads();
    selectThread(thread.id);
  }, [refreshThreads, selectThread]);

  const drawerValue = useMemo<DetailDrawerValue>(
    () => ({ content: drawerContent, setContent: setDrawerContent }),
    [drawerContent],
  );

  const isPaused = motionPaused || reducedMotion || isEmberMotionPaused();

  const threadValue = useMemo<ThreadContextValue>(
    () => ({
      threads,
      activeThreadId,
      threadsMock,
      railCollapsed,
      setRailCollapsed,
      shellMode,
      setShellMode,
      emberBand: ember.band,
      emberHeat: ember.heat,
      flameLife,
      hearthPeriod,
      refreshThreads,
      selectThread,
      addThread,
      recomputeEmber,
      motionPaused: isPaused,
      setMotionPaused,
      welcomeActive,
      setWelcomeActive,
      welcomeReplay,
      setWelcomeReplay: handleSetWelcomeReplay,
    }),
    [
      threads,
      activeThreadId,
      threadsMock,
      railCollapsed,
      setRailCollapsed,
      shellMode,
      ember.band,
      ember.heat,
      flameLife,
      hearthPeriod,
      refreshThreads,
      selectThread,
      addThread,
      recomputeEmber,
      isPaused,
      setMotionPaused,
      welcomeActive,
      welcomeReplay,
      handleSetWelcomeReplay,
    ],
  );

  const canvas = isCanvasPath(location.pathname);
  const chapter = `${location.pathname}:${activeThreadId ?? ''}:${shellMode}`;
  const previousChapter = useRef(chapter);
  useEffect(() => {
    if (previousChapter.current !== chapter) emitEmberCue('chapter');
    previousChapter.current = chapter;
  }, [chapter]);

  return (
    <DetailDrawerContext.Provider value={drawerValue}>
      <ThreadContext.Provider value={threadValue}>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <div
          ref={shellRef}
          className={[
            'canvas-shell',
            railCollapsed ? 'canvas-shell--rail-collapsed' : '',
            canvas ? 'canvas-shell--canvas' : 'canvas-shell--page',
            `canvas-shell--ember-${ember.band}`,
          ]
            .filter(Boolean)
            .join(' ')}
          data-hearth-period={hearthPeriod}
          data-motion-paused={isPaused}
          data-ember-band={ember.band}
          data-flame-stage={flameLife.stage}
          data-golden={flameLife.golden.toFixed(2)}
          data-dormant={flameLife.dormant.toFixed(2)}
          data-flame-state={flameLife.stage === 'blaze' ? 'lively' : flameLife.stage === 'sprout' ? 'warm' : 'dim'}
          data-ember-heat={flameLife.heat.toFixed(2)}
        >
          <EmberAtmosphere
            band={ember.band}
            heat={flameLife.heat}
            golden={flameLife.golden}
            dormant={flameLife.dormant}
            stage={flameLife.stage}
            period={hearthPeriod}
            size={flameSize}
          />
          <ThreadRail
            threads={threads}
            activeThreadId={activeThreadId}
            collapsed={railCollapsed}
            filter={searchQuery}
            onFilter={setSearchQuery}
            onToggle={() => setRailCollapsed(!railCollapsed)}
            onSelect={selectThread}
            onCreate={() => void addThread()}
          />
          <div className="canvas-body">
            {canvas ? (
              !welcomeActive && (
                <header className="canvas-chrome">
                  <button type="button" className="hearth-wordmark" onClick={() => { setShellMode('chat'); setRailCollapsed(true); }} aria-label="返回对话">Hearth<span aria-hidden="true">.</span></button>
                  <div className="hearth-header-actions">
                    <div className="hearth-flame-pill" data-flame-stage={flameLife.stage} title={`炉火生命态：${flameLife.stageLabel} (${Math.round(flameLife.heat * 100)}% 活力)`}>
                      <span className="hearth-flame-pill__icon" aria-hidden="true">
                        {flameLife.stage === 'spark' ? '✨' : flameLife.stage === 'sprout' ? '🌱' : flameLife.stage === 'blaze' ? '🔥' : flameLife.stage === 'golden' ? '🌟' : '🪵'}
                      </span>
                      <span ref={topStageBadgeRef} className={`status-badge is-${flameLife.stageBadgeTone}`}>{flameLife.stageLabel}</span>
                      <div className="hearth-vitality-track" aria-hidden="true" title={`${Math.round(flameLife.heat * 100)}% 活力`}>
                        <div ref={topVitalityBarRef} className="hearth-vitality-fill" style={{ width: `${Math.round(flameLife.heat * 100)}%` }} />
                      </div>
                    </div>
                    <span className="hearth-mode-label" role="status" aria-label="离线演示 · 不连接真实模型" title="回复由本机模拟生成，不连接真实模型">离线演示 · 不连接真实模型</span>
                    <details className="hearth-menu" ref={menuRef} onKeyDown={(event) => {
                      if (event.key === 'Escape') { menuRef.current?.removeAttribute('open'); menuRef.current?.querySelector('summary')?.focus(); }
                    }}>
                      <summary aria-label="打开菜单" title="菜单"><span aria-hidden="true">···</span></summary>
                      <div className="hearth-menu__panel">
                        <div className="hearth-menu__flame-status" data-flame-stage={flameLife.stage}>
                          <div className="hearth-menu__flame-row">
                            <span ref={menuStageBadgeRef} className={`status-badge is-${flameLife.stageBadgeTone}`}>{flameLife.stageLabel}</span>
                            <span ref={menuHeatLabelRef} className="hearth-menu__heat-label">{Math.round(flameLife.heat * 100)}% 活力</span>
                          </div>
                          <div className="hearth-vitality-track hearth-vitality-track--menu" aria-hidden="true">
                            <div ref={menuVitalityBarRef} className="hearth-vitality-fill" style={{ width: `${Math.round(flameLife.heat * 100)}%` }} />
                          </div>
                          <p className="hearth-menu__flame-poetry">{flameLife.stagePoetry}</p>
                          <button
                            type="button"
                            className="hearth-menu__stoke-action"
                            onClick={(e) => handleTopBarStoke(e.currentTarget)}
                          >
                            🔥 添一把柴（散发火星）
                          </button>
                        </div>
                        <button type="button" onClick={() => { setRailCollapsed(false); menuRef.current?.removeAttribute('open'); }}>历史对话</button>
                        <button type="button" onClick={() => { setShellMode('projects'); menuRef.current?.removeAttribute('open'); }}>项目与话题</button>
                        <button type="button" onClick={() => { setMotionPaused(!motionPaused); menuRef.current?.removeAttribute('open'); }}>{motionPaused ? '开启动效' : '暂停动效'}</button>
                        <button type="button" onClick={() => { setShellMode('chat'); setWelcomeReplay(true); menuRef.current?.removeAttribute('open'); }}>重看欢迎</button>
                        <Link to="/settings" onClick={() => menuRef.current?.removeAttribute('open')}>设置</Link>
                        <div className="hearth-flame-control">
                          <label htmlFor="hearth-flame-size">火焰大小 <output>{Math.round(flameSize * 100)}%</output></label>
                          <input id="hearth-flame-size" type="range" min="0.65" max="1.4" step="0.05" value={flameSize}
                            onChange={(event) => { const value = Number(event.currentTarget.value); setFlameSize(value); saveFlameSize(value); }} />
                        </div>
                        <p className="hearth-menu__hint">火光伴随项目的创立、推进与成果，赋予生命活力。</p>
                      </div>
                    </details>
                  </div>
                </header>
              )
            ) : (
              <header className="canvas-chrome canvas-chrome--page">
                <Link to="/" className="canvas-chrome__back" onClick={() => setShellMode('chat')}>
                  ← 对话
                </Link>
                <p className="canvas-chrome__title">{sectionLabel(location.pathname)}</p>
                <div className="canvas-chrome__right">
                  <span className="hearth-mode-label" role="status" aria-label="离线演示 · 不连接真实模型" title="回复由本机模拟生成，不连接真实模型">离线演示 · 不连接真实模型</span>
                </div>
              </header>
            )}
            <main className="canvas-main" id="main-content">
              {canvas && shellMode === 'projects' ? (
                <ProjectsPane
                  threads={threads}
                  activeThreadId={activeThreadId}
                  flameLife={flameLife}
                  filter={searchQuery}
                  onSelect={selectThread}
                  onCreate={() => void addThread()}
                  onStoke={handleTopBarStoke}
                />
              ) : (
                <Outlet />
              )}
            </main>
          </div>
          {drawerContent !== null ? (
            <aside className="detail-drawer" aria-label="详情面板">
              {drawerContent}
            </aside>
          ) : null}
        </div>
      </ThreadContext.Provider>
    </DetailDrawerContext.Provider>
  );
}

function ProjectsPane({
  threads,
  activeThreadId,
  flameLife,
  filter,
  onSelect,
  onCreate,
  onStoke,
}: {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  flameLife: ProjectFlameInfo;
  filter: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onStoke?: (btn: HTMLElement) => void;
}) {
  const q = filter.trim().toLowerCase();
  const visible = q
    ? threads.filter((t) => t.title.toLowerCase().includes(q))
    : threads;

  return (
    <section className="projects-pane" aria-label="项目（线程）">
      <header className="projects-pane__head">
        <h1 className="projects-pane__title">项目与话题</h1>
        <p className="projects-pane__hint">选择一段谈话继续，或把新的本地项目带到炉边。</p>
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          新线程
        </button>
      </header>

      <div className="projects-pane__flame-banner" data-flame-stage={flameLife.stage}>
        <div className="projects-pane__flame-head">
          <div className="projects-pane__flame-meta">
            <span className="projects-pane__flame-icon" aria-hidden="true">
              {flameLife.stage === 'spark' ? '✨' : flameLife.stage === 'sprout' ? '🌱' : flameLife.stage === 'blaze' ? '🔥' : flameLife.stage === 'golden' ? '🌟' : '🪵'}
            </span>
            <div>
              <span className="projects-pane__flame-title">炉火生命态：{flameLife.stageLabel}</span>
              <span className={`status-badge is-${flameLife.stageBadgeTone}`}>{flameLife.stage}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost projects-pane__stoke-btn"
            onClick={(e) => {
              if (onStoke) {
                onStoke(e.currentTarget);
              } else {
                emitEmberCue('stoke');
              }
            }}
            title="添一把柴，激荡火舌并飞升散发火星粒子"
          >
            🔥 添柴激荡
          </button>
        </div>
        <p className="projects-pane__flame-poetry">{flameLife.stagePoetry}</p>
        <p className="projects-pane__flame-hint">{flameLife.fuelHint}</p>
      </div>

      <Link to="/projects" className="projects-pane__manage">管理本地项目与观察范围 ↗</Link>
      <ul className="projects-pane__list">
        {visible.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className={`projects-pane__item${t.id === activeThreadId ? ' is-active' : ''}`}
              onClick={() => onSelect(t.id)}
            >
              <div className="projects-pane__item-header">
                <span className="projects-pane__item-title">{t.title}</span>
                {t.id === activeThreadId ? (
                  <span className={`status-badge is-${flameLife.stageBadgeTone}`}>{flameLife.stageLabel}</span>
                ) : null}
              </div>
              {t.preview ? (
                <span className="projects-pane__item-preview">{t.preview}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function sectionLabel(pathname: string): string {
  if (pathname.startsWith('/cards')) return '建议（调试）';
  if (pathname.startsWith('/observe')) return '项目观察（调试）';
  if (pathname.startsWith('/projects')) return '项目（调试）';
  if (pathname.startsWith('/insights')) return '洞察（调试）';
  if (pathname.startsWith('/activity')) return '活动（调试）';
  if (pathname.startsWith('/settings')) return '设置';
  return '页面';
}
