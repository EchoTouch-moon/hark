import {
  createBrowserRouter,
  Navigate,
  useRouteError,
} from 'react-router-dom';
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
      { path: 'cards', element: <HomePage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:id', element: <ProjectDetailPage /> },
      { path: 'observe/:id', element: <ObserverDetailPage /> },
      { path: 'insights', element: <InsightsPage /> },
      { path: 'insights/:id', element: <InsightDetailPage /> },
      { path: 'activity', element: <ActivityPage /> },
      { path: 'activity/:runId', element: <ActivityPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
