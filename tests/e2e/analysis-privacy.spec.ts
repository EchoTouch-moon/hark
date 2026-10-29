import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

/** UI-only Pi disclosure simulation; actual server/provider remain Mock throughout. */
test('R2: explicit privacy confirmation, exclusions and persisted feedback', async ({ page, baseURL }) => {
  const repo = mkdtempSync(path.join(tmpdir(), 'hearth-r2-privacy-'));
  let projectId: string | undefined;
  let headers: Record<string, string> = {};
  const runPosts: Array<{ projectId: string; consentFingerprint?: string }> = [];
  let latestFingerprint = '';
  let previews = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/analysis/runs') {
      runPosts.push(request.postDataJSON() as { projectId: string; consentFingerprint?: string });
    }
  });
  try {
    mkdirSync(path.join(repo, 'docs'));
    writeFileSync(path.join(repo, 'README.md'), '# Synthetic privacy project\nPublic project summary.\n');
    writeFileSync(path.join(repo, 'docs/context-notes.md'), '# Synthetic optional context\nThis file will be excluded by the user.\n');
    const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
    git(['init', '-q']);
    git(['add', 'README.md', 'docs/context-notes.md']);
    git(['-c', 'user.name=Hearth Fixture', '-c', 'user.email=fixture@invalid.test', 'commit', '-qm', 'synthetic privacy baseline']);
    const session = await (await page.request.get('/api/v1/auth/session')).json() as { csrfToken: string };
    headers = { 'x-csrf-token': session.csrfToken, origin: baseURL! };
    const health = await (await page.request.get('/api/v1/health')).json() as { analysisProvider: { provider: string } };
    expect(health.analysisProvider.provider).toBe('mock');
    const registration = await page.request.post('/api/v1/observer/projects', {
      headers, data: { localPath: repo, name: 'R2 synthetic privacy project', confirm: true },
    });
    expect(registration.status()).toBe(201);
    projectId = ((await registration.json()) as { project: { id: string } }).project.id;

    // Only presentation identity is changed. Context and fingerprint are the
    // actual server preview; runs/feedback use the real isolated Mock backend.
    await page.route('**/api/v1/analysis/preview', async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const body = await response.json() as { context: { contextFingerprint: string }; provider: string; model: string };
      latestFingerprint = body.context.contextFingerprint;
      previews++;
      await route.fulfill({ response, json: { ...body, provider: 'pi', model: 'pi/synthetic-ui-only' } });
    });
    await page.goto(`/observe/${encodeURIComponent(projectId)}`);
    const launch = page.getByRole('button', { name: '分析当前项目', exact: true });
    const dialog = page.getByRole('dialog', { name: '确认向外部模型发送分析上下文' });
    const confirm = dialog.getByRole('button', { name: '确认发送并分析' });
    await launch.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('pi/synthetic-ui-only');
    await expect(dialog).toContainText('这不是项目代码审计');
    await expect(dialog).toContainText('可能产生费用');
    await dialog.getByText('查看完整发送上下文', { exact: true }).click();
    await expect(dialog.locator('pre')).toContainText('contextFingerprint');
    await expect(dialog.locator('.analysis-preview-files')).toContainText('docs/context-notes.md');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(runPosts).toHaveLength(0);
    await launch.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(runPosts).toHaveLength(0);
    const empty = await (await page.request.get(`/api/v1/analysis/runs?projectId=${encodeURIComponent(projectId)}`)).json() as { runs: unknown[] };
    expect(empty.runs).toEqual([]);

    await launch.click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('该项目的排除路径').fill('docs/context-notes.md');
    await expect(confirm).toBeDisabled();
    const priorPreviews = previews;
    const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/api/v1/analysis/privacy'));
    await dialog.getByRole('button', { name: '保存排除路径并刷新预览' }).click();
    expect((await saved).ok()).toBe(true);
    await expect(confirm).toBeEnabled();
    expect(previews).toBeGreaterThan(priorPreviews);
    await expect(dialog.locator('.analysis-preview-files')).not.toContainText('docs/context-notes.md');
    await dialog.getByText('查看完整发送上下文', { exact: true }).click();
    await expect(dialog.locator('pre')).toContainText(latestFingerprint);
    await page.locator('dialog').screenshot({ path: 'handoff/EVIDENCE/r2-privacy.png' });
    const consentFingerprint = latestFingerprint;
    const result = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/v1/analysis/runs'));
    await confirm.click();
    expect((await result).status()).toBe(201);
    await expect(dialog).toHaveCount(0);
    expect(runPosts).toEqual([{ projectId, trigger: 'observe', consentFingerprint }]);
    const card = page.locator('.analysis-card');
    await expect(card).toContainText('Mock 演示 · 未调用真实 AI');
    await expect(card).toContainText('已完成');
    await expect(card).toContainText('来源引用已匹配，结论仍需判断');
    await card.getByRole('button', { name: '有用', exact: true }).click();
    await expect(card).toContainText('已记录：有用');
    await expect(card.getByRole('button', { name: '有用', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(card).toContainText('已记录：有用');
    await expect(card.getByRole('button', { name: '有用', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.route('**/api/v1/analysis/runs/*/feedback', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SYNTHETIC_FAILURE', message: '合成反馈保存失败' } }),
    }));
    await card.getByRole('button', { name: '没用', exact: true }).click();
    await expect(card.getByRole('alert')).toContainText('合成反馈保存失败');
    await expect(card).toContainText('已记录：有用');
    expect(runPosts).toHaveLength(1);
    console.log('R2_BROWSER_PASS: Pi UI identity simulated only; cancel+ESC zero runs; exclusions persisted and re-previewed; exact consent fingerprint sent once; actual Mock result; feedback persists and failure is visible. No real model was called.');
  } finally {
    if (projectId) await page.request.delete(`/api/v1/observer/projects/${encodeURIComponent(projectId)}`, { headers });
    rmSync(repo, { recursive: true, force: true });
  }
});
