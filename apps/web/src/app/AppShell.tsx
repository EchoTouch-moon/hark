import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { getThemePreference, setThemePreference, subscribeTheme, type ThemePreference } from '../features/theme';
import { RuntimeReady, useRuntimeMode } from '../features/runtime-mode';
import { ConnectionBadge } from '../components';
import './AppShell.css';

/* ------------------------------------------------------------------ */
/* Detail Drawer 插槽：向右侧详情抽屉/模态面板投放内容 */
/* ------------------------------------------------------------------ */

export interface DetailDrawerValue {
  /** 抽屉当前内容；null 时不渲染 */
  content: ReactNode | null;
  /** 页面调用以填充/清空抽屉；路由切换时 AppShell 自动清空 */
  setContent: (content: ReactNode | null) => void;
  /** 显式关闭抽屉并归还焦点 */
  closeDrawer: () => void;
  /** 快捷打开抽屉并记录当前焦点元素 */
  openDrawer: (content: ReactNode) => void;
}

const DetailDrawerContext = createContext<DetailDrawerValue | null>(null);

/** 供页面与顶栏向右侧 Detail Drawer 投放 Evidence / Trace / Workspace Details */
export function useDetailDrawer(): DetailDrawerValue {
  const value = useContext(DetailDrawerContext);
  if (value === null) {
    throw new Error('useDetailDrawer 必须在 AppShell 内部使用');
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* 导航 */
/* ------------------------------------------------------------------ */

type NavIconName = 'home' | 'chat' | 'projects' | 'insights' | 'activity' | 'settings';

interface NavItemDefinition {
  to: string;
  label: string;
  icon: NavIconName;
  /** 是否仅在精确匹配时高亮（Home 用） */
  end?: boolean;
}

/** 顺序固定：Home / Chat / Projects / Insights / Activity / Settings */
const NAV_ITEMS: readonly NavItemDefinition[] = [
  { to: '/', label: '当下', icon: 'chat', end: true },
  { to: '/projects', label: '项目', icon: 'projects' },
  { to: '/insights', label: '发现与建议', icon: 'insights' },
  { to: '/observations', label: '观察记录', icon: 'activity' },
  { to: '/settings', label: '设置', icon: 'settings' },
];

function NavIcon({ name }: { name: NavIconName }) {
  const paths: Record<NavIconName, ReactNode> = {
    home: (
      <>
        <path d="M3 7.5 8 3l5 4.5v4.8a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 12.3Z" />
        <path d="M6.5 13.5v-3h3v3" />
      </>
    ),
    chat: (
      <path d="M3.5 4.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H7.75L5 12.75V10.5h-.5a1 1 0 0 1-1-1Z" />
    ),
    projects: (
      <path d="M2.5 5.2a1.2 1.2 0 0 1 1.2-1.2h2.4l1.4 1.9h3.8a1.2 1.2 0 0 1 1.2 1.2v4.9a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2Z" />
    ),
    insights: (
      <path d="M4 3.5h8v2.2H4Zm0 3.6h8V13H8.2L4 10.6Z" />
    ),
    activity: <path d="M2 8.5h3l1.5-4.5 3 9L11 8.5h3" />,
    settings: (
      <>
        <path d="M3 5h6M12.5 5H13M3 11h2.5M9 11h4" />
        <circle cx="10.5" cy="5" r="1.6" />
        <circle cx="7" cy="11" r="1.6" />
      </>
    ),
  };
  return (
    <svg
      className="nav-item-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

function NavRail() {
  const { state } = useRuntimeMode();
  return (
    <nav className="nav-rail" aria-label="主导航">
      <div className="nav-brand" title="Hearth" aria-label="Hearth">
        <svg
          className="nav-brand-mark"
          width="18"
          height="18"
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
        <span className="nav-brand-name">Hearth</span>
      </div>
      <ul className="nav-list">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              title={item.label}
              aria-label={item.label}
              className={({ isActive }) =>
                isActive ? 'nav-item is-active' : 'nav-item'
              }
            >
              <NavIcon name={item.icon} />
              <span className="nav-item-label">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <details className="nav-secondary">
        <summary aria-label="更多入口">
          <span className="nav-secondary-full">更多入口</span>
          <span className="nav-secondary-compact" aria-hidden="true">更多</span>
        </summary>
        <NavLink className="nav-item" to="/chat" title="对话 · Mock 演示" aria-label="对话 · Mock 演示">
          <NavIcon name="chat" />
          <span className="nav-item-label">对话 · Mock 演示</span>
        </NavLink>
        <NavLink
          className="nav-item"
          to="/demo"
          title={state.status === 'ready' && state.demoMode ? 'Demo 操作台' : '演示模式说明'}
          aria-label={state.status === 'ready' && state.demoMode ? 'Demo 操作台' : '演示模式说明'}
        >
          <NavIcon name="home" />
          <span className="nav-item-label">{state.status === 'ready' && state.demoMode ? 'Demo 操作台' : '演示模式说明'}</span>
        </NavLink>
        {state.status === 'ready' && state.demoMode ? (
          <NavLink className="nav-item" to="/activity" title="Demo 执行记录" aria-label="Demo 执行记录">
            <NavIcon name="activity" />
            <span className="nav-item-label">Demo 执行记录</span>
          </NavLink>
        ) : null}
      </details>
      <div className="nav-footer">
        <p className="nav-footer-note">本地优先</p>
        <p className="nav-footer-note">模型调用需主动触发</p>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* 顶部 workspace 标识 */
/* ------------------------------------------------------------------ */

function sectionLabel(pathname: string): string {
  if (pathname.startsWith('/chat')) return '对话';
  if (pathname.startsWith('/observe')) return '项目观察';
  if (pathname.startsWith('/projects')) return '项目';
  if (pathname.startsWith('/insights')) return '洞察';
  if (pathname.startsWith('/activity')) return '执行记录';
  if (pathname.startsWith('/settings')) return '设置';
  if (pathname.startsWith('/demo')) return 'Demo 操作台';
  return '今日概览';
}

function TopBar() {
  const theme = useSyncExternalStore(subscribeTheme, getThemePreference, () => 'light');
  const location = useLocation();
  const { state } = useRuntimeMode();
  const { content, setContent, closeDrawer } = useDetailDrawer();

  const toggleWorkspaceHelp = () => {
    if (content) {
      closeDrawer();
    } else {
      setContent(
        <div className="workspace-help-detail">
          <h3 className="workspace-help-title">本地工作区说明</h3>
          <p className="workspace-help-text">
            Hearth 遵循本地优先原则，所有观察数据与状态均持久化保存在本地 SQLite 数据库中。
          </p>
          <div className="workspace-help-section">
            <p className="workspace-help-subtitle">运行环境与模式</p>
            <p className="workspace-help-text">
              当前处于 <strong>{state.status === 'ready' && state.demoMode ? 'Demo 合成数据模式' : '真实项目模式'}</strong>。
              外部模型调用需明确预览并主动授权，不自动产生后台计费。
            </p>
          </div>
          <div className="workspace-help-section">
            <p className="workspace-help-subtitle">交互与快捷键</p>
            <p className="workspace-help-text">
              按 <kbd>Esc</kbd> 键或点击右上角关闭按钮可随时退出本详情抽屉并恢复焦点。
            </p>
          </div>
        </div>,
      );
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-identity">
        <span className="topbar-workspace">本地工作区</span>
        <span className="topbar-sep" aria-hidden="true">
          /
        </span>
        <span className="topbar-section">{sectionLabel(location.pathname)}</span>
        <button
          type="button"
          className="topbar-help-btn"
          aria-label="查看工作区说明与详情"
          title="查看工作区说明与详情"
          onClick={toggleWorkspaceHelp}
        >
          说明
        </button>
      </div>
      <div className="topbar-badges">
        <label className="theme-control">
          <span className="visually-hidden">显示主题</span>
          <select aria-label="显示主题" value={theme} onChange={event => setThemePreference(event.target.value as ThemePreference)}>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
            <option value="system">跟随系统</option>
          </select>
        </label>
        <span className="badge badge-notice">{state.status === 'loading' ? '模式读取中' : state.status === 'error' ? '模式不可用' : state.demoMode ? 'Demo 合成数据模式' : '真实项目 · 本地存储'}</span>
        <ConnectionBadge mode="demo" label={location.pathname.startsWith('/chat') ? '对话：离线演示' : '分析来源见建议卡'} />
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* AppShell：NavRail + 主内容 + DetailDrawer 三栏骨架 */
/* ------------------------------------------------------------------ */

export function AppShell() {
  const location = useLocation();
  const [drawerContent, setDrawerContent] = useState<ReactNode | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const closeDrawer = useCallback(() => {
    setDrawerContent(null);
    if (openerRef.current && typeof openerRef.current.focus === 'function' && openerRef.current.isConnected) {
      openerRef.current.focus();
    }
    openerRef.current = null;
  }, []);

  const openDrawer = useCallback((content: ReactNode) => {
    if (document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    setDrawerContent(content);
  }, []);

  const setContent = useCallback(
    (content: ReactNode | null) => {
      if (content === null) {
        closeDrawer();
      } else {
        openDrawer(content);
      }
    },
    [closeDrawer, openDrawer],
  );

  // 路由切换时清空抽屉，避免上一页的证据残留
  useEffect(() => {
    setDrawerContent(null);
    openerRef.current = null;
  }, [location.pathname]);

  // Esc 键监听
  useEffect(() => {
    if (!drawerContent) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawerContent, closeDrawer]);

  // 打开抽屉时将焦点移至关闭按钮
  useEffect(() => {
    if (drawerContent) {
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [drawerContent]);

  const drawerValue = useMemo<DetailDrawerValue>(
    () => ({ content: drawerContent, setContent, closeDrawer, openDrawer }),
    [drawerContent, setContent, closeDrawer, openDrawer],
  );

  return (
    <DetailDrawerContext.Provider value={drawerValue}>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className={`app-shell${location.pathname === '/' ? ' is-focus-workspace' : ''}${drawerContent ? ' has-detail' : ''}`}>
        <NavRail />
        <div className="app-body">
          <TopBar />
          <main className="app-content" id="main-content">
            <RuntimeReady><Outlet /></RuntimeReady>
          </main>
        </div>
        {drawerContent ? (
          <>
            <div
              className="detail-drawer-backdrop"
              onClick={closeDrawer}
              aria-hidden="true"
              data-testid="detail-drawer-backdrop"
            />
            <aside
              className="detail-drawer"
              aria-label="详情面板"
              role="complementary"
            >
              <div className="detail-drawer-header">
                <span className="detail-drawer-title">详情</span>
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="detail-drawer-close"
                  onClick={closeDrawer}
                  aria-label="关闭详情面板"
                >
                  <span aria-hidden="true">✕</span> 关闭
                </button>
              </div>
              <div className="detail-drawer-body">
                {drawerContent}
              </div>
            </aside>
          </>
        ) : null}
      </div>
    </DetailDrawerContext.Provider>
  );
}
