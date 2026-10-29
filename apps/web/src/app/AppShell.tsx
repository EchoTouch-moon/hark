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
  useState,
  type ReactNode,
} from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  createThread,
  getActiveThreadId,
  listThreads,
  setActiveThreadId,
  type ThreadSummary,
} from '../features/threads';
import { fetchChatHistory, preferLiveApi } from '../features/chat';
import {
  applyEmberHeatCss,
  computeEmberHeat,
  latestConfirmedInteraction,
  type EmberBand,
} from '../features/emberHeat';
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
  refreshThreads: () => Promise<void>;
  selectThread: (id: string) => void;
  addThread: () => Promise<void>;
  /** ChatPage 发送后刷新炉温 */
  recomputeEmber: () => void;
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

const RAIL_COLLAPSE_KEY = 'hearth.rail.collapsed.v2';

function FlameMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="ember-mark"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 1.6c2.3 2.4 4.2 4.4 4.2 6.9a4.2 4.2 0 1 1-8.4 0C3.8 6 5.7 4 8 1.6Z"
        fill="var(--color-accent-soft)"
        stroke="var(--color-accent)"
        strokeWidth="1.3"
      />
      <path
        d="M8 7.2c.9 1 1.6 1.8 1.6 2.8a1.6 1.6 0 1 1-3.2 0c0-1 .7-1.8 1.6-2.8Z"
        fill="var(--color-accent)"
      />
    </svg>
  );
}

function ThreadRail({
  threads,
  activeThreadId,
  collapsed,
  filter,
  onToggle,
  onSelect,
  onCreate,
}: {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  collapsed: boolean;
  filter: string;
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
          <FlameMark />
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [emberTick, setEmberTick] = useState(0);
  const [railCollapsed, setRailCollapsedState] = useState(() => {
    try {
      return window.localStorage.getItem(RAIL_COLLAPSE_KEY) !== '0';
    } catch {
      return false;
    }
  });

  const setRailCollapsed = useCallback((v: boolean) => {
    setRailCollapsedState(v);
    try {
      window.localStorage.setItem(RAIL_COLLAPSE_KEY, v ? '1' : '0');
    } catch {
      // ignore
    }
  }, []);

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
      null;
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


  const [confirmedAt, setConfirmedAt] = useState<{threadId: string; at: string | null} | null>(null);
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const controller = new AbortController();
    if (activeThreadId) void fetchChatHistory(activeThreadId, controller.signal).then(history => {
      if (!controller.signal.aborted) { setConfirmedAt({threadId: activeThreadId, at: latestConfirmedInteraction(history.messages)}); setNowMs(Date.now()); }
    }).catch(() => { if (!controller.signal.aborted) setConfirmedAt(null); });
    return () => controller.abort();
  }, [activeThreadId, emberTick]);
  useEffect(() => {
    const update = () => { document.documentElement.dataset.pageHidden = String(document.hidden); if (!document.hidden) setNowMs(Date.now()); };
    update();
    document.addEventListener('visibilitychange', update);
    const timer = window.setInterval(update, 60000);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  const ember = computeEmberHeat({lastConfirmedAt: confirmedAt?.threadId === activeThreadId ? confirmedAt.at : null, nowMs});
  useEffect(() => { applyEmberHeatCss(ember.heat); }, [ember.heat]);

  const recomputeEmber = useCallback(() => {
    setEmberTick((n) => n + 1);
  }, []);

  const selectThread = useCallback(
    (id: string) => {
      setActiveId(id);
      setActiveThreadId(id);
      setShellMode('chat');
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
      refreshThreads,
      selectThread,
      addThread,
      recomputeEmber,
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
      refreshThreads,
      selectThread,
      addThread,
      recomputeEmber,
    ],
  );

  const canvas = isCanvasPath(location.pathname);

  return (
    <DetailDrawerContext.Provider value={drawerValue}>
      <ThreadContext.Provider value={threadValue}>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <div
          className={[
            'canvas-shell',
            railCollapsed ? 'canvas-shell--rail-collapsed' : '',
            canvas ? 'canvas-shell--canvas' : 'canvas-shell--page',
            `canvas-shell--ember-${ember.band}`,
          ]
            .filter(Boolean)
            .join(' ')}
          data-ember-band={ember.band}
          data-flame-state={ember.band === 'hot' ? 'lively' : ember.band === 'warm' ? 'warm' : 'dim'}
          data-ember-heat={ember.heat.toFixed(2)}
        >
          <ThreadRail
            threads={threads}
            activeThreadId={activeThreadId}
            collapsed={railCollapsed}
            filter={searchQuery}
            onToggle={() => setRailCollapsed(!railCollapsed)}
            onSelect={selectThread}
            onCreate={() => void addThread()}
          />
          <div className="canvas-body">
            {canvas ? (
              <header className="canvas-chrome">
                <div className="chrome-seg" role="tablist" aria-label="主视图">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={shellMode === 'chat'}
                    className={`chrome-seg__btn${shellMode === 'chat' ? ' is-active' : ''}`}
                    onClick={() => setShellMode('chat')}
                  >
                    聊天
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={shellMode === 'projects'}
                    className={`chrome-seg__btn${shellMode === 'projects' ? ' is-active' : ''}`}
                    onClick={() => setShellMode('projects')}
                  >
                    项目
                  </button>
                </div>

                <div className="canvas-chrome__right">
                  {threadsMock ? (
                    <span className="canvas-chrome__dot" title="线程列表为本地演示" />
                  ) : null}
                  {searchOpen ? (
                    <input
                      className="chrome-search"
                      type="search"
                      value={searchQuery}
                      placeholder="搜线程…"
                      aria-label="搜索线程"
                      autoFocus
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setSearchOpen(false);
                          setSearchQuery('');
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="chrome-icon-btn"
                      aria-label="搜索"
                      title="搜索"
                      onClick={() => {
                        setSearchOpen(true);
                        if (railCollapsed) setRailCollapsed(false);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                  <Link
                    to="/settings"
                    className="chrome-avatar"
                    aria-label="设置"
                    title="设置"
                  >
                    <span className="chrome-avatar__glyph" aria-hidden="true">
                      炉
                    </span>
                  </Link>
                </div>
              </header>
            ) : (
              <header className="canvas-chrome canvas-chrome--page">
                <Link to="/" className="canvas-chrome__back">
                  ← 对话
                </Link>
                <p className="canvas-chrome__title">{sectionLabel(location.pathname)}</p>
              </header>
            )}
            <main className="canvas-main" id="main-content">
              {canvas && shellMode === 'projects' ? (
                <ProjectsPane
                  threads={threads}
                  activeThreadId={activeThreadId}
                  filter={searchQuery}
                  onSelect={selectThread}
                  onCreate={() => void addThread()}
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
  filter,
  onSelect,
  onCreate,
}: {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  filter: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const q = filter.trim().toLowerCase();
  const visible = q
    ? threads.filter((t) => t.title.toLowerCase().includes(q))
    : threads;

  return (
    <section className="projects-pane" aria-label="项目（线程）">
      <header className="projects-pane__head">
        <h1 className="projects-pane__title">项目</h1>
        <p className="projects-pane__hint">本拍等同线程；点一项回到聊天。</p>
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          新线程
        </button>
      </header>
      <ul className="projects-pane__list">
        {visible.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className={`projects-pane__item${t.id === activeThreadId ? ' is-active' : ''}`}
              onClick={() => onSelect(t.id)}
            >
              <span className="projects-pane__item-title">{t.title}</span>
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
