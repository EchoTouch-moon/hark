/** Project-first conversation room. History and visual preferences open on demand. */
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
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  createThread,
  getActiveThreadId,
  listThreads,
  setActiveThreadId,
  type ThreadSummary,
} from '../features/threads';
import { preferLiveApi } from '../features/chat';
import {
  applyEmberHeatCss,
  type EmberBand,
} from '../features/emberHeat';
import { deriveProjectFlame, type ProjectFlameInfo } from '../features/projectEmber';
import { fetchObserverDetail } from '../features/observer';
import { EmberAtmosphere } from '../components/EmberAtmosphere';
import { getHearthPeriod, type HearthPeriod } from '../features/hearthPeriod';
import { readFlameSize, saveFlameSize } from '../features/flameSize';
import { emitEmberCue, isEmberMotionPaused } from '../features/ember-cues';
import { readWelcomePreference } from '../features/welcome';

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
  threadsError: string | null;
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
  openProject: (projectId: string) => Promise<void>;
  threadsReady: boolean;
  /** ChatPage 发送后刷新炉温 */
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
  error,
  onFilter,
  onToggle,
  onSelect,
  onCreate,
  onRetry,
}: {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  collapsed: boolean;
  filter: string;
  error?: string | null;
  onFilter: (value: string) => void;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRetry?: () => void;
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
        {error ? (
          <li className="thread-list__error" role="alert">
            <p className="thread-list__error-msg">{error}</p>
            {onRetry ? (
              <button type="button" className="thread-list__retry-btn" onClick={onRetry}>
                重试
              </button>
            ) : null}
          </li>
        ) : (
          visible.map((t) => {
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
          })
        )}
        {!error && visible.length === 0 ? (
          <li className="thread-list__empty">无匹配线程</li>
        ) : null}
      </ul>
    </aside>
  );
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerContent, setDrawerContent] = useState<ReactNode | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsReady, setThreadsReady] = useState(false);
  const openingProjects = useRef(new Map<string, Promise<ThreadSummary>>());
  const [threadsMock, setThreadsMock] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);
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
  // History is always an on-demand surface; re-entering opens the conversation.
  const [railCollapsed, setRailCollapsed] = useState(true);

  const currentRoute = useRef({ pathname: location.pathname, search: location.search });
  currentRoute.current = { pathname: location.pathname, search: location.search };
  const refreshGeneration = useRef(0);
  const refreshThreads = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const listed = await listThreads();
      if (generation !== refreshGeneration.current) return;
      if (listed.error) {
        setThreadsError(listed.error);
        setThreads([]);
        return;
      }
      setThreadsError(null);
      setThreads(listed.threads);
      setThreadsMock(listed.mock);
      if (!listed.mock) preferLiveApi();
      const route = currentRoute.current;
      const fromQuery = new URLSearchParams(route.search).get('thread');
      const fromPath = route.pathname.startsWith('/t/')
        ? route.pathname.slice(3).split('/')[0]
        : null;
      const preferred = [fromQuery, fromPath, getActiveThreadId(), listed.threads[0]?.id]
        .find(id => id && listed.threads.some(thread => thread.id === id)) ?? null;
      setActiveId(preferred);
      if (preferred) setActiveThreadId(preferred);
    } catch (err) {
      if (generation !== refreshGeneration.current) return;
      setThreadsError(err instanceof Error ? err.message : '加载线程列表失败');
      setThreads([]);
    } finally {
      if (generation === refreshGeneration.current) setThreadsReady(true);
    }
  }, []);

  useEffect(() => {
    void refreshThreads();
    return () => { refreshGeneration.current++; };
  }, [refreshThreads, location.pathname, location.search]);

  useEffect(() => {
    setDrawerContent(null);
  }, [location.pathname]);


  const [nowMs, setNowMs] = useState(Date.now);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId),
    [threads, activeThreadId],
  );

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
  const ember = { band: 'warm' as const, heat: 0.3 };

  // Neutral ambient light until a verified project-life projection exists.
  // Conversation count, old cards and observation switches are not progress.
  const flameLife = useMemo(() => deriveProjectFlame({}), []);
  useEffect(() => { applyEmberHeatCss(flameLife.heat); }, [flameLife.heat]);
  const shellRef = useRef<HTMLDivElement>(null);

  const selectThread = useCallback(
    (id: string) => {
      refreshGeneration.current++;
      setActiveId(id);
      setActiveThreadId(id);
      setShellMode('chat');
      setRailCollapsed(true);
      const target = `/t/${encodeURIComponent(id)}`;
      if (location.pathname !== target) navigate(target);
    },
    [location.pathname, navigate],
  );

  const openProject = useCallback(async (projectId: string) => {
    const detail = await fetchObserverDetail(projectId);
    let thread = threads.find(item => item.projectId === projectId);
    if (!thread) {
      let pending = openingProjects.current.get(projectId);
      if (!pending) {
        pending = createThread({ title: `${detail.project.name} · 讨论`, projectId }).then(result => result.thread);
        openingProjects.current.set(projectId, pending);
      }
      try { thread = await pending; }
      catch (cause) { openingProjects.current.delete(projectId); throw cause; }
    }
    await refreshThreads();
    selectThread(thread.id);
  }, [threads, refreshThreads, selectThread]);

  const addThread = useCallback(async () => {
    if (!activeThread?.projectId) { navigate('/projects'); return; }
    try {
      const detail = await fetchObserverDetail(activeThread.projectId);
      const { thread } = await createThread({ title: `${detail.project.name} · 新话题`, projectId: detail.project.id });
      await refreshThreads();
      selectThread(thread.id);
    } catch (cause) {
      setThreadsError(cause instanceof Error ? cause.message : '创建话题失败，请重试');
    }
  }, [activeThread?.projectId, navigate, refreshThreads, selectThread]);

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
      threadsError,
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
      openProject,
      threadsReady,
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
      threadsError,
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
      openProject,
      threadsReady,
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
            error={threadsError}
            onFilter={setSearchQuery}
            onToggle={() => setRailCollapsed(!railCollapsed)}
            onSelect={selectThread}
            onCreate={() => void addThread()}
            onRetry={() => void refreshThreads()}
          />
          <div className="canvas-body">
            {canvas ? (
              !welcomeActive && (
                <header className="canvas-chrome">
                  <button type="button" className="hearth-wordmark" onClick={() => { setShellMode('chat'); setRailCollapsed(true); }} aria-label="返回对话">Hearth<span aria-hidden="true">.</span></button>
                  <div className="hearth-header-actions">
                    <Link className="hearth-project-link" to="/projects">选择项目</Link>
                    <span className="hearth-mode-label" role="status" aria-label="当前对话为 Mock · 离线演示 · 不连接真实模型" title="对话回复由本机模拟生成，不连接真实模型">当前对话为 Mock · 离线演示</span>
                    <details className="hearth-menu" ref={menuRef} onKeyDown={(event) => {
                      if (event.key === 'Escape') { menuRef.current?.removeAttribute('open'); menuRef.current?.querySelector('summary')?.focus(); }
                    }}>
                      <summary role="button" aria-label="打开菜单" title="菜单"><span aria-hidden="true">···</span></summary>
                      <div className="hearth-menu__panel">
                        <button type="button" onClick={() => { setRailCollapsed(false); menuRef.current?.removeAttribute('open'); }}>历史对话</button>
                        <Link to="/projects" onClick={() => menuRef.current?.removeAttribute('open')}>本地项目</Link>
                        <button type="button" onClick={() => { setMotionPaused(!motionPaused); menuRef.current?.removeAttribute('open'); }}>{motionPaused ? '开启动效' : '暂停动效'}</button>
                        <button type="button" onClick={() => { setShellMode('chat'); setWelcomeReplay(true); menuRef.current?.removeAttribute('open'); }}>重看欢迎</button>
                        <Link to="/settings" onClick={() => menuRef.current?.removeAttribute('open')}>设置</Link>
                        <div className="hearth-flame-control">
                          <label htmlFor="hearth-flame-size">火焰大小 <output>{Math.round(flameSize * 100)}%</output></label>
                          <input id="hearth-flame-size" type="range" min="0.65" max="1.4" step="0.05" value={flameSize}
                            onChange={(event) => { const value = Number(event.currentTarget.value); setFlameSize(value); saveFlameSize(value); }} />
                        </div>
                        <p className="hearth-menu__hint">火影是空间氛围，不表示进度或后台工作。</p>
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
                <div className="canvas-chrome__right" />
              </header>
            )}
            <main className="canvas-main" id="main-content">
              <Outlet />
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

function sectionLabel(pathname: string): string {
  if (pathname.startsWith('/cards')) return '建议（调试）';
  if (pathname.startsWith('/observe')) return '项目观察';
  if (pathname.startsWith('/projects')) return '本地项目';
  if (pathname.startsWith('/insights')) return '洞察';
  if (pathname.startsWith('/activity')) return '活动（调试）';
  if (pathname.startsWith('/settings')) return '设置';
  return '页面';
}
