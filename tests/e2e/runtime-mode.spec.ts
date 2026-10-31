import { expect, test } from '@playwright/test';
import { openHearth } from './fixture-helpers';

test('mocked ok paints demo badge from ViewModel mode and skips Demo init on canvas', async ({ page }) => {
  await openHearth(page, 'ok');
  await expect(page.locator('.hearth-demo-badge')).toHaveText('演示数据');
  await expect(page.getByRole('button', { name: /初始化.*Demo|初始化演示/ })).toHaveCount(0);
  await expect(page.getByText('正在确认运行模式…')).toHaveCount(0);
});

test('mocked error fails closed: 火候未知 + 重新读取 only', async ({ page }) => {
  await openHearth(page, 'error');
  await expect(page.locator('.hearth-flame-pill__label')).toHaveText('火候未知');
  await expect(page.getByRole('button', { name: '重新读取' })).toHaveCount(1);
  await expect(page.locator('.xp-error__message')).toHaveText('火候未知');
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);
});
