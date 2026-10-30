import {
  createBrowserRouter,
  Navigate,
  Link,
  Outlet,
  useRouteError,
} from 'react-router-dom';
import { useRuntimeMode } from '../features/runtime-mode';
import { AppShell } from './AppShell';
import { ErrorState } from '../components';
import { HomePage } from '../pages/HomePage';
import { DemoHomePage } from '../pages/DemoHomePage';
import { ChatPage } from '../pages/ChatPage';
import { ProjectsPage } from '../pages/ProjectsPage';
import { ProjectDetailPage } from '../pages/ProjectDetailPage';
import { ObserverDetailPage } from '../pages/ObserverDetailPage';
import { ActivityPage } from '../pages/ActivityPage';
import { SettingsPage } from '../pages/SettingsPage';
import { InsightsPage } from '../pages/InsightsPage';
import { InsightDetailPage } from '../pages/InsightDetailPage';
import { ObservationsPage } from '../pages/ObservationsPage';

/** Defense for direct URLs as well as navigation: never mount Demo actions outside server Demo mode. */
function DemoGate() {
  const { state, retry } = useRuntimeMode();
  if (state.status === 'loading') {
    return (
      <section className="page" aria-busy="true">
        <p role="status">正在确认运行模式…</p>
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <section className="page">
        <ErrorState message={state.message} onRetry={retry} />
      </section>
    );
  }
  // Both demoMode AND legacyDemoAvailable must be true to mount legacy demo routes
  if (state.status !== 'ready' || !state.demoMode || !state.legacyDemoAvailable) {
    return (
      <section className="page">
        <h1>演示模式未启用</h1>
        <p>当前使用真实项目模式。演示数据初始化仅在服务端显式开启 Demo 模式后可用。</p>
        <Link to="/">返回对话</Link>
      </section>
    );
  }
  return <Outlet />;
}

/** 路由级错误兜底 */
function RouteError() {
  const error = useRouteError();
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '页面加载出现未知错误';
  return (
    <section className="page">
      <ErrorState message={message} onRetry={() => window.location.reload()} />
    </section>
  );
}

/**
 * Style Bible v2：
 * / = 沉浸画布；/t/:threadId 切线程；/cards · insights · activity · projects 仅调试 URL，无日常 Nav。
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: 't/:threadId', element: <ChatPage /> },
      { path: 'chat', element: <Navigate to="/" replace /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'observe/:id', element: <ObserverDetailPage /> },
      { path: 'insights', element: <InsightsPage /> },
      { path: 'insights/:id', element: <InsightDetailPage /> },
      { path: 'observations', element: <ObservationsPage /> },
      { element: <DemoGate/>, children: [
        { path: 'cards', element: <HomePage /> },
        { path: 'demo', element: <DemoHomePage/> },
        { path: 'projects/:id', element: <ProjectDetailPage/> },
        { path: 'activity', element: <ActivityPage/> },
        { path: 'activity/:runId', element: <ActivityPage/> },
      ] },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
