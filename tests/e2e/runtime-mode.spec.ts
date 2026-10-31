import { expect, test } from '@playwright/test';
import { openFixture } from './fixture-helpers';

test('fixture mode never mounts Demo/init actions and makes no /api requests', async ({ page }) => {
  const { apiRequests } = await openFixture(page, 'ok');
  await expect(page.locator('.hearth-demo-badge')).toHaveText('演示数据');
  await expect(page.getByRole('button', { name: /初始化.*Demo|初始化演示/ })).toHaveCount(0);
  await expect(page.getByText('正在确认运行模式…')).toHaveCount(0);
  await page.waitForTimeout(1_000);
  expect(apiRequests).toEqual([]);
});

test('?fixture=error fails closed: only 重新读取, 火候未知, no reload button', async ({ page }) => {
  const { apiRequests } = await openFixture(page, 'error');
  await expect(page.locator('.hearth-flame-pill__label')).toHaveText('火候未知');
  await expect(page.getByRole('button', { name: '重新读取' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^重试$|刷新|重新加载/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});
