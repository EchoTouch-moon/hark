import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { RuntimeModeProvider } from './features/runtime-mode';
import { HearthViewModelProvider } from './features/hearthViewModel';
import { initializeTheme } from './features/theme';
import { router } from './app/routes';
import './styles/tokens.css';
import './styles/global.css';

initializeTheme();

const container = document.getElementById('root');
if (container === null) {
  throw new Error('找不到 #root 挂载点');
}

createRoot(container).render(
  <StrictMode>
    <HearthViewModelProvider><RuntimeModeProvider><RouterProvider router={router} /></RuntimeModeProvider></HearthViewModelProvider>
  </StrictMode>,
);
