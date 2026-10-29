import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
/* Detail Drawer 插槽：后续任务（Evidence/TaskTrace）向右侧抽屉投放内容 */
/* ------------------------------------------------------------------ */

export interface DetailDrawerValue {
  /** 抽屉当前内容；null 时显示占位说明 */
  content: ReactNode | null;
  /** 页面调用以填充/清空抽屉；路由切换时 AppShell 自动清空 */
  setContent: (content: ReactNode | null) => void;
}

const DetailDrawerContext = createContext<DetailDrawerValue | null>(null);

/** 供页面（M1-T05..T08）向右侧 Detail Drawer 投放 Evidence / Task Trace */
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
  { to: '/', label: '今日概览', icon: 'home', end: true },
  { to: '/projects', label: '项目', icon: 'projects' },
  { to: '/insights', label: '发现与建议', icon: 'insights' },
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
  const {state}=useRuntimeMode();
  return (
    <nav className="nav-rail" aria-label="主导航">
      <div className="nav-brand">
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
        <summary>更多入口</summary>
        <NavLink className="nav-item" to="/chat">对话 · Mock 演示</NavLink>
        <NavLink className="nav-item" to="/demo">{state.status === 'ready' && state.demoMode ? 'Demo 操作台' : '演示模式说明'}</NavLink>
        {state.status === 'ready' && state.demoMode ? <NavLink className="nav-item" to="/activity">Demo 执行记录</NavLink> : null}
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
  const {state}=useRuntimeMode();
  return (
    <header className="topbar">
      <div className="topbar-identity">
        <span className="topbar-workspace">本地工作区</span>
        <span className="topbar-sep" aria-hidden="true">
          /
        </span>
        <span className="topbar-section">{sectionLabel(location.pathname)}</span>
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
/* Detail Drawer（桌面宽屏 280px；窄屏隐藏，后续任务以弹层呈现） */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* AppShell：NavRail + 主内容 + DetailDrawer 三栏骨架 */
/* ------------------------------------------------------------------ */

export function AppShell() {
  const location = useLocation();
  const [drawerContent, setDrawerContent] = useState<ReactNode | null>(null);

  // 路由切换时清空抽屉，避免上一页的证据残留
  useEffect(() => {
    setDrawerContent(null);
  }, [location.pathname]);

  const drawerValue = useMemo<DetailDrawerValue>(
    () => ({ content: drawerContent, setContent: setDrawerContent }),
    [drawerContent],
  );

  return (
    <DetailDrawerContext.Provider value={drawerValue}>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className={`app-shell${drawerContent ? ' has-detail' : ''}`}>
        <NavRail />
        <div className="app-body">
          <TopBar />
          <main className="app-content" id="main-content">
            <RuntimeReady><Outlet /></RuntimeReady>
          </main>
        </div>
        {drawerContent ? <aside className="detail-drawer" aria-label="详情面板">{drawerContent}</aside> : null}
      </div>
    </DetailDrawerContext.Provider>
  );
}
