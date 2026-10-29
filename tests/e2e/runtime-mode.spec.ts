import { expect, test } from '@playwright/test';

test('unknown and real mode never mount Demo actions, including direct URLs', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let seedCalls = 0, legacyProjectReads = 0;
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/demo/seed')) seedCalls++;
    if (path === '/api/v1/projects') legacyProjectReads++;
  });
  await page.route('**/api/v1/health', async route => {
    await gate;
    await route.fulfill({ json: { demoMode: false } });
  });
  await page.goto('/demo', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('正在确认运行模式…')).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '洞察', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
  await expect(page.getByLabel('任务项目', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '对话 · Mock 演示' })).not.toBeVisible();
  await page.getByText('更多入口', { exact: true }).click();
  await expect(page.getByRole('link', { name: '对话 · Mock 演示' })).toBeVisible();
  expect(seedCalls).toBe(0);
  expect(legacyProjectReads).toBe(0);
});

test('invalid mode fails closed and a deliberate retry can recover', async ({ page }) => {
  let valid = false;
  await page.route('**/api/v1/health', route => route.fulfill({ json: valid ? { demoMode: false } : { demoMode: 'false' } }));
  await page.goto('/demo');
  await expect(page.getByText('无法确认服务端运行模式，请重试。')).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);
  valid = true;
  await page.getByRole('button', { name: /重试/ }).click();
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();
});
