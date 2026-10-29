/**
 * P1 close-out: register known pilots through Hearth /projects, then
 * read-only scan + insight consume. Paths come from env, never hardcoded.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Page } from '@playwright/test';
import { InsightConsumer } from '../packages/project-insight/src/consume.js';
import { processProjectRules } from '../packages/project-insight/src/insights/processor.js';
import { listInsights, summarizeInsights } from '../packages/project-insight/src/insights/query.js';
import { InProcessObserverReadPort } from '../packages/project-insight/src/observer-read-port.js';
import { InsightStore } from '../packages/project-insight/src/store/store.js';
import { ProjectObserver } from '../packages/project-observer/src/observer.js';
import { repoReadOnlyFingerprint } from '../packages/project-observer/src/testkit/git-fixture.js';

const REPO = path.resolve(import.meta.dirname, '..');
const OUTPUT_ROOT = process.env['P1_CLOSEOUT_ROOT'] ?? REPO;
const EVIDENCE = path.join(OUTPUT_ROOT, 'handoff/EVIDENCE');
const REPORT = path.join(OUTPUT_ROOT, 'docs/verification/data/insight-p1-pilots-closeout.json');
const PORT = Number(process.env['HEARTH_PORT'] ?? 4318);
const BASE = `http://127.0.0.1:${PORT}`;

const PILOTS = [
  { name: 'pindou', env: 'HEARTH_PILOT_PINDOU' },
  { name: 'prototype-skill-lab', env: 'HEARTH_PILOT_SKILL_LAB' },
  { name: 'agent-internet-lab', env: 'HEARTH_PILOT_AGENT_INTERNET' },
] as const;

function observerDb(): string {
  return process.env['HEARTH_OBSERVER_DB'] ?? path.join(REPO, 'data/observer.sqlite');
}
function insightDb(): string {
  return process.env['HEARTH_INSIGHT_DB'] ?? path.join(REPO, 'data/insights.sqlite');
}
function appDb(): string {
  return process.env['HEARTH_DB'] ?? path.join(REPO, 'data/dev.sqlite');
}

async function waitHealth(timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/api/v1/health`)).ok) return;
    } catch {
      // retry
    }
    await delay(300);
  }
  throw new Error(`health timeout ${BASE}`);
}

function startServer(): ChildProcess {
  const child = spawn('pnpm', ['--filter', '@hearth/server', 'exec', 'tsx', 'src/main.ts'], {
    cwd: REPO,
    env: {
      ...process.env,
      HEARTH_PORT: String(PORT),
      HEARTH_HOST: '127.0.0.1',
      HEARTH_DB: appDb(),
      HEARTH_OBSERVER_DB: observerDb(),
      HEARTH_INSIGHT_DB: insightDb(),
      HEARTH_AUTOSEED: '0',
      HEARTH_OBSERVER_WATCH: '0',
      HEARTH_STATIC: process.env['HEARTH_STATIC'] ?? path.join(REPO, 'apps/web/dist'),
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
  await Promise.race([new Promise<void>((resolve) => child.once('exit', () => resolve())), delay(5000)]);
}

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const session = await page.request.get(`${BASE}/api/v1/auth/session`);
  const body = (await session.json()) as { csrfToken: string };
  return { 'x-csrf-token': body.csrfToken, origin: BASE };
}

async function registerViaUi(page: Page, name: string, localPath: string): Promise<void> {
  await page.goto(`${BASE}/projects`);
  await page.getByRole('heading', { name: '项目' }).waitFor();
  if ((await page.getByText(name, { exact: true }).count()) > 0) return;
  await page.getByLabel('本地 Git 路径').fill(localPath);
  await page.getByLabel('显示名称（可选）').fill(name);
  await page.getByRole('checkbox', { name: /我确认将该本地路径加入只读观察/ }).check();
  await page.getByRole('button', { name: /注册观察/ }).click();
  await page.getByText(name, { exact: true }).first().waitFor({ timeout: 20_000 });
}

async function main(): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  mkdirSync(path.dirname(REPORT), { recursive: true });

  const resolved = PILOTS.map((pilot) => {
    const localPath = process.env[pilot.env];
    if (localPath === undefined || localPath.trim() === '') {
      return { ...pilot, result: 'NOT_RUN_ENV_UNSET' as const, localPath: null };
    }
    if (!existsSync(localPath)) {
      return { ...pilot, result: 'BLOCKED_PATH_UNAVAILABLE' as const, localPath };
    }
    return { ...pilot, result: 'READY' as const, localPath };
  });
  const ready = resolved.filter((item) => item.result === 'READY' && item.localPath !== null);
  if (ready.length < 2) {
    throw new Error(`need two READY pilots, got ${JSON.stringify(resolved)}`);
  }

  const before = [];
  for (const pilot of ready) {
    before.push({ name: pilot.name, fp: await repoReadOnlyFingerprint(pilot.localPath!) });
  }

  const build = spawn('pnpm', ['--filter', '@hearth/web', 'build'], { cwd: REPO, stdio: 'inherit' });
  const buildCode = await new Promise<number>((resolve) => build.on('exit', (code) => resolve(code ?? 1)));
  if (buildCode !== 0) throw new Error('web build failed');

  let server = startServer();
  await waitHealth(60_000);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  page.setDefaultTimeout(20_000);

  await page.goto(`${BASE}/projects`);
  await page.getByRole('heading', { name: '项目' }).waitFor();
  await page.screenshot({ path: path.join(EVIDENCE, 'p1-projects-before-register.png'), fullPage: true });

  for (const pilot of ready) {
    await registerViaUi(page, pilot.name, pilot.localPath!);
  }
  await page.goto(`${BASE}/projects`);
  await page.getByText('pindou').first().waitFor();
  await page.getByText('prototype-skill-lab').first().waitFor();
  await page.screenshot({ path: path.join(EVIDENCE, 'p1-projects-registered.png'), fullPage: true });

  const listed = (await (await page.request.get(`${BASE}/api/v1/observer/projects`)).json()) as {
    projects: Array<{ id: string; name: string }>;
  };
  const headers = await csrfHeaders(page);
  for (const project of listed.projects) {
    const first = await page.request.post(`${BASE}/api/v1/observer/projects/${project.id}/scan`, { headers, data: {} });
    if (!first.ok()) throw new Error(`scan 1 failed ${project.name} ${first.status()}`);
    const second = await page.request.post(`${BASE}/api/v1/observer/projects/${project.id}/scan`, { headers, data: {} });
    if (!second.ok()) throw new Error(`scan 2 failed ${project.name} ${second.status()}`);
  }
  await browser.close();
  await stopServer(server);
  await delay(500);

  const observer = new ProjectObserver({ dbPath: observerDb(), watchEnabled: false });
  const store = new InsightStore(insightDb());
  const consumeResults: unknown[] = [];
  try {
    const port = new InProcessObserverReadPort(observer);
    const consumer = new InsightConsumer(store);
    for (const project of observer.listProjects()) {
      const consume = await consumer.consumeProjectBatch(port, { projectId: project.id, limit: 200 });
      const rules = processProjectRules(store, {
        projectId: project.id,
        streamEpoch: consume.checkpoint.streamEpoch || 1,
        baseline: 'none',
        limit: 200,
      });
      consumeResults.push({
        name: project.name,
        id: project.id,
        consume: consume.outcome,
        eventsProcessed: consume.eventsProcessed,
        episodesOpened: rules.episodesOpened,
        ruleOutcome: rules.outcome,
      });
    }
  } finally {
    await observer.stop();
    observer.close();
    store.close();
  }

  const after = [];
  for (const pilot of ready) {
    const fp = await repoReadOnlyFingerprint(pilot.localPath!);
    const prev = before.find((item) => item.name === pilot.name)?.fp;
    after.push({
      name: pilot.name,
      repoUnchanged: JSON.stringify(prev) === JSON.stringify(fp),
      head: fp.head.slice(0, 12),
    });
  }

  server = startServer();
  await waitHealth(60_000);
  const page2 = await (await chromium.launch({ headless: true })).newPage({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  await page2.goto(`${BASE}/projects`);
  await page2.getByText('pindou').first().waitFor();
  await page2.screenshot({ path: path.join(EVIDENCE, 'p1-projects-after-insight.png'), fullPage: true });
  await page2.goto(`${BASE}/insights`);
  await page2.getByRole('heading', { name: '洞察' }).waitFor();
  await page2.screenshot({ path: path.join(EVIDENCE, 'p1-insights-after-pilots.png'), fullPage: true });
  await page2.context().browser()?.close();
  await stopServer(server);

  const summaryStore = new InsightStore(insightDb(), { skipWriterLock: true });
  let summary;
  let feed;
  try {
    summary = summarizeInsights(summaryStore);
    feed = listInsights(summaryStore, { limit: 50 });
  } finally {
    summaryStore.close();
  }

  const report = {
    runtimeDbs: {
      defaultObserver: path.join(REPO, 'data/observer.sqlite'),
      usedObserver: observerDb(),
      usedInsight: insightDb(),
      usedApp: appDb(),
      priorUiObserver: '/tmp/hearth-obs-ui/observer.sqlite',
      mismatchNote:
        'S3.5 queried default data/observer.sqlite (0 projects). A previous UI process used /tmp/hearth-obs-ui/observer.sqlite which already had pindou and prototype-skill-lab.',
    },
    pilots: resolved.map((item) => ({
      name: item.name,
      env: item.env,
      result: item.result,
      pathSet: item.localPath !== null,
    })),
    consume: consumeResults,
    repoUnchanged: after,
    insightSummary: summary,
    feedCount: feed.items.length,
    screenshots: [
      'p1-projects-before-register.png',
      'p1-projects-registered.png',
      'p1-projects-after-insight.png',
      'p1-insights-after-pilots.png',
    ],
  };
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
