/**
 * P2-A first analysis loop on a registered observer project.
 * Default provider is mock. Live Pi is attempted only when HEARTH_ANALYSIS_PROVIDER=pi.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { repoReadOnlyFingerprint } from '../packages/project-observer/src/testkit/git-fixture.js';

const REPO = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env['HEARTH_PORT'] ?? 4319);
const BASE = `http://127.0.0.1:${PORT}`;
const EVIDENCE = path.join(REPO, 'handoff/EVIDENCE');
const REPORT = path.join(REPO, 'docs/verification/data/hearth-p2a-first-analysis.json');

async function waitHealth(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    try {
      if ((await fetch(`${BASE}/api/v1/health`)).ok) return;
    } catch {
      // retry
    }
    await delay(300);
  }
  throw new Error('health timeout');
}

function startServer(): ChildProcess {
  const child = spawn('pnpm', ['--filter', '@hearth/server', 'exec', 'tsx', 'src/main.ts'], {
    cwd: REPO,
    env: {
      ...process.env,
      HEARTH_PORT: String(PORT),
      HEARTH_HOST: '127.0.0.1',
      HEARTH_AUTOSEED: '0',
      HEARTH_OBSERVER_WATCH: '0',
      HEARTH_STATIC: process.env['HEARTH_STATIC'] ?? path.join(REPO, 'apps/web/dist'),
      HEARTH_ANALYSIS_PROVIDER: process.env['HEARTH_ANALYSIS_PROVIDER'] ?? 'mock',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.pid) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      // gone
    }
  }
  await Promise.race([new Promise<void>((resolve) => child.once('exit', () => resolve())), delay(4000)]);
}

async function main(): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  mkdirSync(path.dirname(REPORT), { recursive: true });
  const projectPath = process.env['HEARTH_PILOT_PINDOU'];
  if (!projectPath) throw new Error('set HEARTH_PILOT_PINDOU');
  const before = await repoReadOnlyFingerprint(projectPath);
  const build = spawn('pnpm', ['--filter', '@hearth/web', 'build'], { cwd: REPO, stdio: 'inherit' });
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? 1)));
  if (code !== 0) throw new Error('web build failed');

  const server = startServer();
  await waitHealth();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  page.setDefaultTimeout(30_000);
  await page.goto(`${BASE}/projects`);
  await page.getByText('pindou').first().waitFor();
  await page.locator('a.obs-tile-link').filter({ hasText: 'pindou' }).click();
  await page.getByRole('button', { name: '分析当前项目' }).waitFor();
  await page.getByRole('button', { name: '分析当前项目' }).click();
  await page.getByText(/已完成|没有可验证建议|失败/).first().waitFor({ timeout: 40_000 });
  await page.locator('.analysis-card').screenshot({ path: path.join(EVIDENCE, 'p2a-first-analysis-card.png') });
  await page.screenshot({ path: path.join(EVIDENCE, 'p2a-first-analysis-page.png'), fullPage: true });
  const cardText = await page.locator('.analysis-card').innerText();
  await browser.close();
  await stopServer(server);
  const after = await repoReadOnlyFingerprint(projectPath);
  const report = {
    provider: process.env['HEARTH_ANALYSIS_PROVIDER'] ?? 'mock',
    live: (process.env['HEARTH_ANALYSIS_PROVIDER'] ?? 'mock') === 'pi' ? 'ATTEMPTED' : 'NOT_REQUESTED',
    repoUnchanged: JSON.stringify(before) === JSON.stringify(after),
    head: after.head.slice(0, 12),
    cardExcerpt: cardText.slice(0, 500),
    mockLabeled: cardText.includes('Mock Provider'),
  };
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
