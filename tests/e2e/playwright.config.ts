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
      `rm -f "${REPO}/data/e2e.sqlite" "${REPO}/data/e2e.sqlite-wal" "${REPO}/data/e2e.sqlite-shm" tests/e2e/.server.log;`,
      'pnpm --filter @hearth/web build || exit 1;',
      `HEARTH_PORT=${PORT}`,
      `HEARTH_DB="${REPO}/data/e2e.sqlite"`,
      'HEARTH_AUTOSEED=0',
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
