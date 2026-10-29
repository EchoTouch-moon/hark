import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env['E2E_PORT'] ?? 4321);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: '.',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './.artifacts',
  use: {
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  webServer: {
    cwd: REPO,
    command: [
      'sh -c "',
      `rm -f "${REPO}/data/e2e.sqlite" "${REPO}/data/e2e.sqlite-wal" "${REPO}/data/e2e.sqlite-shm" "${REPO}/data/e2e-insights.sqlite" "${REPO}/data/e2e-insights.sqlite-wal" "${REPO}/data/e2e-insights.sqlite-shm" "${REPO}/data/e2e-observer.sqlite" "${REPO}/data/e2e-observer.sqlite-wal" "${REPO}/data/e2e-observer.sqlite-shm" "${REPO}/data/e2e-observer.sqlite.writer.lock" "${REPO}/data/e2e-analysis.sqlite" "${REPO}/data/e2e-analysis.sqlite-wal" "${REPO}/data/e2e-analysis.sqlite-shm" tests/e2e/.server.log;`,
      'pnpm --filter @hearth/web build || exit 1;',
      `HEARTH_PORT=${PORT}`,
      `HEARTH_DB="${REPO}/data/e2e.sqlite"`,
      `HEARTH_INSIGHT_DB="${REPO}/data/e2e-insights.sqlite"`,
      `HEARTH_OBSERVER_DB="${REPO}/data/e2e-observer.sqlite"`,
      `HEARTH_ANALYSIS_DB="${REPO}/data/e2e-analysis.sqlite"`,
      'HEARTH_DEMO=1',
      'HEARTH_ANALYSIS_PROVIDER=mock',
      'HEARTH_AUTOSEED=0',
      'HEARTH_OBSERVER_WATCH=1',
      `HEARTH_ARTIFACTS="${REPO}/.hearth-demo-artifacts"`,
      `HEARTH_STATIC="${REPO}/apps/web/dist"`,
      'pnpm --filter @hearth/server dev 2>tests/e2e/.server.log',
      '"',
    ].join(' '),
    url: `${BASE}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
