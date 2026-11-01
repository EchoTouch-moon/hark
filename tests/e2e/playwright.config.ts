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
    // A Node launcher replaces the former `sh -c "rm -f ... && VAR=x cmd"`
    // one-liner, which cannot run on Windows. See tests/e2e/start-server.mjs.
    command: 'node tests/e2e/start-server.mjs',
    url: `${BASE}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
