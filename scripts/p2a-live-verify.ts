/** Explicit live verification; isolated Hearth databases, existing approved project only. */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, lstatSync, readlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { ProjectObserver } from '../packages/project-observer/src/observer.js';
import { redactSecrets } from '../packages/project-analysis/src/context/redact.js';

const root = path.resolve(import.meta.dirname, '..');
const project = process.env['HEARTH_PILOT_PINDOU'];
if (!project) throw new Error('Set HEARTH_PILOT_PINDOU explicitly');
if (process.env['HEARTH_ANALYSIS_PROVIDER'] !== 'pi') throw new Error('Live verification requires pi');
mkdirSync(path.join(root, 'data'), { recursive: true });
const runtime = mkdtempSync(path.join(root, 'data/p2a-live-'));
const evidence = path.join(root, 'handoff/EVIDENCE');
const git = (args: string[]) => execFileSync('git', ['--no-optional-locks', '-C', project, ...args]);
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function fingerprint() {
  const names = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean))].sort();
  const digest = createHash('sha256');
  for (const name of names) {
    const file = path.join(project!, name);
    digest.update(name + '\0');
    try {
      const stat = lstatSync(file);
      digest.update(String(stat.mode) + '\0');
      if (stat.isSymbolicLink()) digest.update(readlinkSync(file));
      else if (stat.isFile()) digest.update(readFileSync(file));
    } catch (cause) {
      if ((cause as { code?: string }).code !== 'ENOENT') throw cause;
      digest.update('MISSING');
    }
  }
  const indexPath = git(['rev-parse', '--git-path', 'index']).toString().trim();
  return {
    head: git(['rev-parse', 'HEAD']).toString().trim(),
    statusHash: hash(git(['status', '--porcelain=v2', '-z', '--untracked-files=all'])),
    indexHash: hash(readFileSync(path.resolve(project!, indexPath))),
    filesHash: digest.digest('hex'), fileCount: names.length,
  };
}
const before = fingerprint();
const observer = new ProjectObserver({ dbPath: path.join(runtime, 'observer.sqlite'), watchEnabled: false });
const registered = await observer.registerProject(project, { name: 'pindou' });
observer.close();
const port = 4338;
const base = `http://127.0.0.1:${port}`;
const server = spawn('pnpm', ['--filter', '@hearth/server', 'exec', 'tsx', 'src/main.ts'], {
  cwd: root, detached: true, stdio: 'ignore', env: {
    ...process.env, HEARTH_PORT: String(port), HEARTH_AUTOSEED: '0', HEARTH_OBSERVER_WATCH: '0',
    HEARTH_DB: path.join(runtime, 'dev.sqlite'), HEARTH_OBSERVER_DB: path.join(runtime, 'observer.sqlite'),
    HEARTH_INSIGHT_DB: path.join(runtime, 'insights.sqlite'), HEARTH_ANALYSIS_DB: path.join(runtime, 'analysis.sqlite'),
    HEARTH_STATIC: path.join(root, 'apps/web/dist'),
  },
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/v1/health`)).ok) { healthy = true; break; } } catch { /* startup */ }
    await delay(200);
  }
  if (!healthy) throw new Error('Server startup timeout');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  await page.goto(`${base}/observe/${registered.id}`);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/analysis/runs') && r.request().method() === 'POST', { timeout: 120_000 });
  await page.getByRole('button', { name: '分析当前项目' }).click();
  const res = await response;
  const body = await res.json();
  const run = body.run;
  if (!run) throw new Error('No analysis run returned');
  await page.locator('.analysis-card').getByText(/已完成|失败|没有可验证建议/).first().waitFor();
  await page.locator('.analysis-card').screenshot({ path: path.join(evidence, 'p2a-live-card.png') });
  const after = fingerprint();
  const report = {
    status: run.status, provider: run.provider, model: run.model, runId: run.id,
    errorCode: run.errorCode, errorMessage: run.errorMessage,
    before, after, repoUnchanged: JSON.stringify(before) === JSON.stringify(after),
    fingerprintScope: 'HEAD, raw index, porcelain status, all tracked and nonignored untracked file contents/modes; symlinks hashed without following; ignored files excluded',
    recommendation: run.recommendation,
    evidenceVerified: run.recommendation?.findings.every((f: { verified: boolean }) => f.verified),
    completedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(evidence, 'p2a-live-verification.json'), redactSecrets(JSON.stringify(report, null, 2)) + '\n');
  console.log(JSON.stringify({ status: report.status, provider: report.provider, model: report.model, repoUnchanged: report.repoUnchanged, evidenceVerified: report.evidenceVerified }));
  if (run.status !== 'succeeded' || run.provider !== 'pi' || !run.model || !report.repoUnchanged) process.exitCode = 1;
} finally {
  await browser?.close();
  if (server.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* exited */ } }
}
