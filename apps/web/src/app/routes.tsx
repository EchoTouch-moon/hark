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
import { ChatPage } from '../pages/ChatPage';
import { ProjectsPage } from '../pages/ProjectsPage';
import { ProjectDetailPage } from '../pages/ProjectDetailPage';
import { ObserverDetailPage } from '../pages/ObserverDetailPage';
import { ActivityPage } from '../pages/ActivityPage';
import { SettingsPage } from '../pages/SettingsPage';
import { InsightsPage } from '../pages/InsightsPage';
import { InsightDetailPage } from '../pages/InsightDetailPage';

/** Defense for direct URLs as well as navigation: never mount Demo actions outside server Demo mode. */
function DemoGate() {
  const {state}=useRuntimeMode();
  if(state.status !== 'ready' || !state.demoMode)return <section className="page"><h1>演示模式未启用</h1><p>当前使用真实项目模式。演示数据初始化仅在服务端显式开启 Demo 模式后可用。</p><Link to="/">返回发现</Link></section>;
  return <Outlet/>;
}

/** 路由级错误兜底：如实展示错误并提供重载入口 */
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
 * 路由表（docs/02-UX）：
 * / , /chat , /projects , /projects/:id , /activity/:runId , /settings
 * /activity 是缺少 runId 时的列表落点；未知路径回到 Home。
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <InsightsPage /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'observe/:id', element: <ObserverDetailPage /> },
      { path: 'insights', element: <InsightsPage /> },
      { path: 'insights/:id', element: <InsightDetailPage /> },
      { element: <DemoGate/>, children: [
        { path: 'demo', element: <HomePage/> },
        { path: 'projects/:id', element: <ProjectDetailPage/> },
        { path: 'activity', element: <ActivityPage/> },
        { path: 'activity/:runId', element: <ActivityPage/> },
      ] },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
