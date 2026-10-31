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
import { preferLiveApi } from '../features/chat';
import type { FlameLevel } from '@hearth/hearth-contract';
import { EMBER_EASE, EMBER_EASE_CSS, flameTransitionSeconds, shellFlame, type FlameVisual } from '../features/flameVisual';
import { useViewModelSource } from '../features/hearthViewModel';
import { EmberAtmosphere } from '../components/EmberAtmosphere';
import type { HearthPeriod } from '../features/hearthPeriod';
import { readFlameSize, saveFlameSize } from '../features/flameSize';
import { emitEmberCue, isEmberMotionPaused } from '../features/ember-cues';
import { useHearthTimeline, HEARTH_EASE } from '../motion';
import { gsap } from 'gsap';
import './AppShell.css';

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
  emberBand: FlameVisual['band'];
  flameHeat: number;
  flameLife: FlameVisual;
  hearthPeriod: HearthPeriod;
  refreshThreads: () => Promise<void>;
  selectThread: (id: string) => void;
  addThread: () => Promise<void>;
  /** ChatPage 发送后刷新炉温 */
  recomputeEmber: () => void;
  motionPaused: boolean;
  setMotionPaused: (paused: boolean) => void;
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
      null;
    if (preferred) {
      setActiveId(preferred);
      setActiveThreadId(preferred);
    }
  }, [location.pathname, searchParams]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  const [nowMs, setNowMs] = useState(Date.now);
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

  // v7 has a single paper ground per flame level (§1 tone); no night variant. The
  // night period darkened the paper to grey and turned the hero title white.
  const hearthPeriod: HearthPeriod = 'day';
  const vmSource = useViewModelSource();
  const vm = vmSource.kind === 'ready' ? vmSource.vm : null;
  // v7 §1/§6: flame reads ONLY narrative.flame; error / invalid freezes it.
  const flameLife = useMemo<FlameVisual>(() => {
    if (vmSource.kind === 'loading') {
      return { ...shellFlame(null), label: '静火', reason: '正在读取火候…', desaturated: false, instant: true, golden: 0 };
    }
    return shellFlame(vm);
  }, [vm, vmSource.kind]);
  const prevLevel = useRef<FlameLevel>(flameLife.level);
  const flameTransition = flameLife.instant ? 0 : flameTransitionSeconds(prevLevel.current, flameLife.level);
  useEffect(() => { prevLevel.current = flameLife.level; }, [flameLife.level]);
  const ember = { band: flameLife.band, heat: flameLife.heat };
  const milestoneGold = flameLife.golden > 0;
  const [goldSweepKey, setGoldSweepKey] = useState(0);
  const prevMilestoneGold = useRef(false);
  useEffect(() => {
    if (milestoneGold && !prevMilestoneGold.current && !reducedMotion) {
      setGoldSweepKey((k) => k + 1);
    }
    prevMilestoneGold.current = milestoneGold;
  }, [milestoneGold, reducedMotion]);

  useEffect(() => {
    const s = document.documentElement.style;
    s.setProperty('--ember-heat', String(flameLife.heat));
    s.setProperty('--flame-tone', flameLife.tone);
    s.setProperty('--duration-ember', `${Math.round(flameTransition * 1000)}ms`);
    s.setProperty('--ease-ember', EMBER_EASE_CSS);
  }, [flameLife.heat, flameLife.tone, flameTransition]);

  const shellRef = useRef<HTMLDivElement>(null);

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
      flameHeat: ember.heat,
      flameLife,
      hearthPeriod,
      refreshThreads,
      selectThread,
      addThread,
      recomputeEmber,
      motionPaused: isPaused,
      setMotionPaused,
      welcomeReplay,
      setWelcomeReplay,
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
      welcomeReplay,
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
          data-flame-desaturated={flameLife.desaturated || undefined}
          data-motion-paused={isPaused}
          data-ember-band={ember.band}
          data-flame-stage={flameLife.stage}
          data-golden={flameLife.golden.toFixed(2)}
          data-dormant={flameLife.dormant.toFixed(2)}
          data-flame-level={flameLife.level}
          data-milestone-gold={milestoneGold ? 'true' : 'false'}
          data-flame-frozen={!vm || vm.status === 'error' ? 'true' : undefined}
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
            transition={flameTransition}
            ease={EMBER_EASE}
          />
          {goldSweepKey > 0 && milestoneGold ? <div key={goldSweepKey} className="hearth-gold-sweep" aria-hidden="true" /> : null}
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
              <header className="canvas-chrome">
                <button type="button" className="hearth-wordmark" onClick={() => { setShellMode('chat'); setRailCollapsed(true); }} aria-label="Hearth 返回对话">Hearth<span aria-hidden="true">.</span></button>
                <div className="hearth-header-actions">
                  <span className="hearth-flame-pill" data-flame-level={flameLife.level} data-desaturated={flameLife.desaturated || undefined} tabIndex={0} title={flameLife.reason} aria-label={`炉火：${flameLife.label}。${flameLife.reason}`}>
                    <span className="hearth-flame-pill__mark" aria-hidden="true" />
                    <span className="hearth-flame-pill__label">{flameLife.label}</span>
                    {vm && vm.observationFreshness !== 'fresh' && vm.status !== 'error' ? (
                      <span className="hearth-stale-dot" data-freshness={vm.observationFreshness} role="img" title={vm.observationFreshness === 'stale' ? '观察已过期，火势按最近一次观察显示' : `观察状态：${vm.observationFreshness}`} aria-label={vm.observationFreshness === 'stale' ? '观察已过期' : `观察状态：${vm.observationFreshness}`} />
                    ) : null}
                  </span>
                  {vm?.mode === 'demo' ? <span className="hearth-demo-badge">演示数据</span> : null}
                  <details className="hearth-menu" ref={menuRef} onKeyDown={(event) => {
                    if (event.key === 'Escape') { menuRef.current?.removeAttribute('open'); menuRef.current?.querySelector('summary')?.focus(); }
                  }}>
                    <summary aria-label="打开菜单" title="菜单"><span aria-hidden="true">···</span></summary>
                    <div className="hearth-menu__panel">
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
                      <p className="hearth-menu__hint">火光只随项目叙事变化，不计数。</p>
                    </div>
                  </details>
                </div>
              </header>
            ) : (
              <header className="canvas-chrome canvas-chrome--page">
                <Link to="/" className="canvas-chrome__back" onClick={() => setShellMode('chat')}>
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
        </div>
    </ThreadContext.Provider>
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
        <h1 className="projects-pane__title">项目与话题</h1>
        <p className="projects-pane__hint">选择一段谈话继续，或把新的本地项目带到炉边。</p>
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          新线程
        </button>
      </header>


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
