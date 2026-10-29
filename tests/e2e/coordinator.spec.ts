import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

/** Runtime acceptance: only register + write a report, never manually scan/consume/analyze. */
test('R1: watched JUnit automatically becomes one Insight without a model run', async ({ page, baseURL }) => {
  const repo = mkdtempSync(path.join(tmpdir(), 'hearth-r1-browser-'));
  let projectId: string | undefined;
  const browserWrites: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/') && request.method() !== 'GET') browserWrites.push(request.url());
  });
  const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
  let headers: Record<string, string> = {};
  try {
    mkdirSync(path.join(repo, 'reports'));
    writeFileSync(path.join(repo, 'README.md'), '# Synthetic R1 browser project\n');
    writeFileSync(path.join(repo, '.gitignore'), 'reports/\n');
    git(['init', '-q']);
    git(['add', 'README.md', '.gitignore']);
    git(['-c', 'user.name=Hearth Fixture', '-c', 'user.email=fixture@invalid.test', 'commit', '-qm', 'synthetic baseline']);
    const session = await (await page.request.get('/api/v1/auth/session')).json() as { csrfToken: string };
    headers = { 'x-csrf-token': session.csrfToken, origin: baseURL! };
    const health = await (await page.request.get('/api/v1/health')).json() as {
      demoMode: boolean; analysisProvider: { provider: string }; insightCoordinator: { running: boolean };
    };
    expect(health.demoMode).toBe(true);
    expect(health.analysisProvider.provider).toBe('mock');
    expect(health.insightCoordinator.running).toBe(true);
    const registration = await page.request.post('/api/v1/observer/projects', {
      headers,
      data: { localPath: repo, name: 'R1 synthetic report project', confirm: true,
        reports: [{ format: 'junit-xml', relativePath: 'reports/junit.xml' }] },
    });
    expect(registration.status()).toBe(201);
    const registered = await registration.json() as { project: { id: string }; health: { watchStatus: string } };
    projectId = registered.project.id;
    expect(registered.health.watchStatus).toBe('watching');
    await page.goto(`/insights?projectId=${encodeURIComponent(projectId)}`);
    await expect(page.getByRole('heading', { name: '洞察', exact: true })).toBeVisible();
    await expect(page.locator('.insight-card').filter({ hasText: /R-TEST-/ })).toHaveCount(0);
    const report = '<testsuite tests="1" failures="1" errors="0" skipped="0"><testcase name="synthetic_failure"><failure message="synthetic"/></testcase></testsuite>';
    // This file write is the only stimulus after registration. The filesystem
    // watcher and server-owned coordinator must perform the rest themselves.
    writeFileSync(path.join(repo, 'reports/junit.xml'), report);
    const cards = page.locator('.insight-card').filter({ hasText: /R-TEST-/ });
    await expect(cards).toHaveCount(1, { timeout: 25_000 });
    await expect(cards.first()).toContainText('reports/junit.xml');
    const listUrl = `/api/v1/insights?projectId=${encodeURIComponent(projectId)}&limit=50`;
    const list = await (await page.request.get(listUrl)).json() as {
      items: Array<{ id: string; primaryRuleId: string; evidenceCount: number; evidenceAvailability: string }>;
    };
    const testItems = list.items.filter((item) => item.primaryRuleId.startsWith('R-TEST-'));
    expect(testItems).toHaveLength(1);
    expect(testItems[0]!.evidenceCount).toBeGreaterThan(0);
    expect(testItems[0]!.evidenceAvailability).toBe('AVAILABLE');
    const insightId = testItems[0]!.id;
    // Repeated filesystem notifications + two UI polling cycles must not create
    // another episode, and a passive feed never starts even a Mock analysis.
    writeFileSync(path.join(repo, 'reports/junit.xml'), report);
    await page.waitForTimeout(6500);
    await expect(cards).toHaveCount(1);
    const repeated = await (await page.request.get(listUrl)).json() as { items: Array<{ id: string; primaryRuleId: string }> };
    expect(repeated.items.filter((item) => item.primaryRuleId.startsWith('R-TEST-')).map((item) => item.id)).toEqual([insightId]);
    const runs = await (await page.request.get(`/api/v1/analysis/runs?projectId=${encodeURIComponent(projectId)}`)).json() as { runs: unknown[] };
    expect(runs.runs).toEqual([]);
    expect(browserWrites).toEqual([]);
    console.log('R1_BROWSER_PASS: watched report -> one evidence-backed Insight; repeated notification deduped; zero manual scan/consume and zero analysis runs.');
  } finally {
    if (projectId) await page.request.delete(`/api/v1/observer/projects/${encodeURIComponent(projectId)}`, { headers });
    rmSync(repo, { recursive: true, force: true });
  }
});
