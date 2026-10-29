/**
 * S3.5 isolated Insight UI verification. Fixture DBs only. No real-repo writes.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { EXTRACTOR_VERSION, type Signal } from '../packages/project-insight/src/contracts.js';
import { makeSignal, testChangedSignal, testFailSignal, triggerRef } from '../packages/project-insight/src/insights/fixtures.js';
import { processProjectRules } from '../packages/project-insight/src/insights/processor.js';
import { getInsight, listInsights } from '../packages/project-insight/src/insights/query.js';
import { InsightStore } from '../packages/project-insight/src/store/store.js';

const REPO = path.resolve(import.meta.dirname, '..');
const MAIN_EVIDENCE = '/Users/v/new-idea/hark/handoff/EVIDENCE';
const REPORT_JSON = '/Users/v/new-idea/hark/docs/verification/data/insight-s35-ui-verify.json';
const DIR = '/tmp/hark-s35-ui';
const PORT = 4325;
const BASE = `http://127.0.0.1:${PORT}`;
const LIVE = 'prj_aaaaaaaaaaaaaaaa';
const CYCLE = 'prj_bbbbbbbbbbbbbbbb';

function seedBatch(store: InsightStore, projectId: string, signals: Signal[], revision: number): void {
  const afterSeq = Math.max(...signals.map((item) => item.appendSeq ?? 0), 0);
  store.commitSignalBatch({
    projectId,
    streamEpoch: 1,
    expectedRevision: revision,
    batch: {
      signals,
      proposedCursor: { afterSeq, streamEpoch: 1 },
      highWatermark: afterSeq,
      outcome: 'OK',
      hasMore: false,
      legacyOrderReconstructed: false,
      extractorVersion: EXTRACTOR_VERSION,
      eventsRead: signals.length,
    },
  });
}

function failSignal(projectId: string, relativePath: string, eventId: string, signalKey: string, appendSeq: number): Signal {
  return makeSignal({
    ...testFailSignal(relativePath),
    projectId,
    signalKey,
    appendSeq,
    sourceEventIds: [eventId],
    evidenceRefs: [triggerRef(projectId, eventId)],
  });
}

function seedInsights(dbPath: string): { liveId: string; cycleOpenId: string; cycleResolvedId: string } {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const store = new InsightStore(dbPath, { skipWriterLock: true });
  try {
    seedBatch(store, LIVE, [failSignal(LIVE, 'reports/live.xml', 'evt_aaaaaaaaaaaaaaaa', 'b'.repeat(64), 2)], 0);
    processProjectRules(store, { projectId: LIVE, streamEpoch: 1, baseline: 'none' });

    seedBatch(store, CYCLE, [failSignal(CYCLE, 'reports/cycle.xml', 'evt_bbbbbbbbbbbbbbbb', '1'.repeat(64), 2)], 0);
    processProjectRules(store, { projectId: CYCLE, streamEpoch: 1, baseline: 'none' });
    const recoveredSignal = {
      ...testChangedSignal({
        relativePath: 'reports/cycle.xml',
        previousFailed: 2,
        currentFailed: 0,
        appendSeq: 5,
        signalKey: 'r'.repeat(64),
      }),
      projectId: CYCLE,
      sourceEventIds: ['evt_cycle_recover'],
      evidenceRefs: [triggerRef(CYCLE, 'evt_cycle_recover')],
    };
    seedBatch(store, CYCLE, [recoveredSignal], 1);
    const recovered = processProjectRules(store, { projectId: CYCLE, streamEpoch: 1, baseline: 'none' });
    if (recovered.episodesResolved !== 1) {
      throw new Error(`expected 1 resolved episode, got ${recovered.episodesResolved}`);
    }
    seedBatch(
      store,
      CYCLE,
      [failSignal(CYCLE, 'reports/cycle.xml', 'evt_nnnnnnnnnnnnnnnn', 'n'.repeat(64), 6)],
      2,
    );
    const again = processProjectRules(store, { projectId: CYCLE, streamEpoch: 1, baseline: 'none' });
    if (again.episodesOpened !== 1) {
      throw new Error(`expected new cycle episode, got ${again.episodesOpened}`);
    }

    const live = listInsights(store, { projectId: LIVE, statuses: ['OPEN'] });
    const cycleOpen = listInsights(store, { projectId: CYCLE, statuses: ['OPEN'] });
    const cycleResolved = listInsights(store, { projectId: CYCLE, statuses: ['RESOLVED'] });
    const liveId = live.items[0]?.id;
    const cycleOpenId = cycleOpen.items[0]?.id;
    const cycleResolvedId = cycleResolved.items[0]?.id;
    if (!liveId || !cycleOpenId || !cycleResolvedId) {
      throw new Error('seed did not persist live OPEN, cycle OPEN, and cycle RESOLVED');
    }
    if (cycleOpenId === cycleResolvedId) {
      throw new Error('new episode reused resolved insight id');
    }
    const liveDetail = getInsight(store, liveId);
    if (liveDetail?.primaryRuleId !== 'R-TEST-FAILURE') {
      throw new Error(`unexpected live rule ${liveDetail?.primaryRuleId}`);
    }
    return { liveId, cycleOpenId, cycleResolvedId };
  } finally {
    store.close();
  }
}

function waitPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve());
    });
  });
}

async function waitHealth(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await delay(300);
  }
  throw new Error(`health check timed out for ${url}`);
}

function startServer(insightDb: string): ChildProcess {
  const child = spawn('pnpm', ['--filter', '@hearth/server', 'exec', 'tsx', 'src/main.ts'], {
    cwd: REPO,
    env: {
      ...process.env,
      HEARTH_PORT: String(PORT),
      HEARTH_HOST: '127.0.0.1',
      HEARTH_DB: path.join(DIR, 'app.sqlite'),
      HEARTH_INSIGHT_DB: insightDb,
      HEARTH_OBSERVER_DB: path.join(DIR, 'observer.sqlite'),
      HEARTH_AUTOSEED: '0',
      HEARTH_OBSERVER_WATCH: '0',
      HEARTH_ARTIFACTS: path.join(DIR, 'artifacts'),
      HEARTH_STATIC: path.join(REPO, 'apps/web/dist'),
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
      // already gone
    }
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    delay(5000),
  ]);
}

async function main(): Promise<void> {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  mkdirSync(MAIN_EVIDENCE, { recursive: true });
  mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  const insightDb = path.join(DIR, 'insights.sqlite');
  const ids = seedInsights(insightDb);

  const build = spawn('pnpm', ['--filter', '@hearth/web', 'build'], { cwd: REPO, stdio: 'inherit' });
  const buildCode = await new Promise<number>((resolve) => build.on('exit', (code) => resolve(code ?? 1)));
  if (buildCode !== 0) throw new Error('web build failed');

  await waitPortFree(PORT);
  let server = startServer(insightDb);
  await waitHealth(`${BASE}/api/v1/health`, 60_000);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  page.setDefaultTimeout(15_000);

  await page.goto(`${BASE}/insights`);
  await page.getByRole('heading', { name: '洞察' }).waitFor();
  await page.locator('a.insight-card').first().waitFor();
  const openCards = page.locator('a.insight-card');
  if ((await openCards.count()) !== 2) {
    throw new Error(`expected 2 open cards, got ${await openCards.count()}`);
  }
  if ((await page.getByText('reports/live.xml').count()) < 1) throw new Error('live fixture card missing');
  if ((await page.getByText('reports/cycle.xml').count()) < 1) throw new Error('cycle fixture card missing');
  await page.screenshot({ path: path.join(MAIN_EVIDENCE, 'insight-s35-feed-open.png'), fullPage: true });

  await page.locator('a.insight-card').filter({ hasText: 'live.xml' }).click();
  await page.getByText('为什么出现').waitFor();
  await page.getByText('R-TEST-FAILURE v1', { exact: true }).waitFor();
  await page.getByText('junit_failures_gt_0', { exact: true }).waitFor();
  await page.getByText('observer_event').first().waitFor();
  await page.getByText('HEAD 绑定', { exact: true }).waitFor();
  await page.getByRole('link', { name: '查看观察证据' }).waitFor();
  await page.screenshot({ path: path.join(MAIN_EVIDENCE, 'insight-s35-detail.png'), fullPage: true });

  await page.getByRole('button', { name: '确认已看' }).click();
  await page.getByText('已查看', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(MAIN_EVIDENCE, 'insight-s35-acknowledged.png'), fullPage: true });

  await page.getByRole('button', { name: '有用', exact: true }).click();
  await page.locator('dd', { hasText: '有用' }).waitFor();
  await page.getByRole('button', { name: '没用', exact: true }).click();
  await page.locator('dd', { hasText: '没用' }).waitFor();
  await page.screenshot({ path: path.join(MAIN_EVIDENCE, 'insight-s35-feedback.png'), fullPage: true });

  await page.getByRole('button', { name: '不再关注这条' }).click();
  await page.getByText('不再关注', { exact: true }).waitFor();
  await page.getByRole('link', { name: '返回列表' }).click();
  await page.getByRole('heading', { name: '洞察' }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: '洞察' }).waitFor();
  if ((await page.locator('a.insight-card').filter({ hasText: 'live.xml' }).count()) !== 0) {
    throw new Error('dismissed live episode reappeared after refresh');
  }
  if ((await page.locator('a.insight-card').filter({ hasText: 'cycle.xml' }).count()) !== 1) {
    throw new Error('expected one open cycle card after dismiss');
  }
  await page.screenshot({ path: path.join(MAIN_EVIDENCE, 'insight-s35-dismissed-hidden.png'), fullPage: true });

  await page.getByRole('button', { name: '含已处理' }).click();
  await page.locator('a.insight-card').filter({ hasText: 'live.xml' }).waitFor();
  const processed = page.locator('a.insight-card');
  const processedCount = await processed.count();
  if (processedCount < 3) throw new Error(`expected dismissed+resolved+open, got ${processedCount}`);
  await page.getByText('已恢复', { exact: true }).waitFor();
  await page.getByText('不再关注', { exact: true }).waitFor();
  await page.getByText('待处理', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(MAIN_EVIDENCE, 'insight-s35-resolved-and-new.png'), fullPage: true });

  await browser.close();
  await stopServer(server);
  await delay(500);
  await waitPortFree(PORT);

  server = startServer(insightDb);
  await waitHealth(`${BASE}/api/v1/health`, 60_000);
  const page2 = await (await chromium.launch({ headless: true })).newPage({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  page2.setDefaultTimeout(15_000);
  await page2.goto(`${BASE}/insights`);
  await page2.getByRole('heading', { name: '洞察' }).waitFor();
  if ((await page2.locator('a.insight-card').filter({ hasText: 'live.xml' }).count()) !== 0) {
    throw new Error('dismissed live episode reappeared after restart');
  }
  await page2.getByRole('button', { name: '含已处理' }).click();
  await page2.locator('a.insight-card').filter({ hasText: 'live.xml' }).click();
  await page2.locator('dd', { hasText: '没用' }).waitFor();
  await page2.getByText('不再关注', { exact: true }).waitFor();
  await page2.screenshot({ path: path.join(MAIN_EVIDENCE, 'insight-s35-after-restart.png'), fullPage: true });
  await page2.context().browser()?.close();
  await stopServer(server);

  const report = {
    result: 'PASS',
    port: PORT,
    isolatedDbs: DIR,
    insightDb,
    ids,
    screenshots: [
      'insight-s35-feed-open.png',
      'insight-s35-detail.png',
      'insight-s35-acknowledged.png',
      'insight-s35-feedback.png',
      'insight-s35-dismissed-hidden.png',
      'insight-s35-resolved-and-new.png',
      'insight-s35-after-restart.png',
    ],
  };
  writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
