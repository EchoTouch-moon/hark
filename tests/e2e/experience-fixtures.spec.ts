import { expect, test } from '@playwright/test';
import { openFixture } from './fixture-helpers';

for (const width of [1024, 1440, 1920]) {
  test(`?fixture=ok has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFixture(page, 'ok');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('timeline nodes render from the ok fixture story', async ({ page }) => {
  await openFixture(page, 'ok');
  const beats = page.locator('.xp-story__beat');
  await expect(beats).toHaveCount(2);
  await expect(page.locator('.xp-story__mark')).toHaveCount(2);
  const marks = await page.locator('.xp-story__mark').evaluateAll((els) => els.map((e) => e.getAttribute('data-mark')));
  for (const m of marks) expect(['filled', 'hollow']).toContain(m);
  await expect(beats.nth(0)).toContainText('项目建立，写下第一版叙事。');
  await expect(beats.nth(1)).toContainText('G0 合同冻结，双轨开工。');
});

test('?fixture=permission-denied: 重新扫描 aria-disabled, 去授权 → /settings, 0 /api', async ({ page }) => {
  const { apiRequests } = await openFixture(page, 'permission-denied');
  await expect(page.getByRole('button', { name: '重新扫描' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('link', { name: '去授权' })).toHaveAttribute('href', '/settings');
  await page.waitForTimeout(1_000);
  expect(apiRequests).toEqual([]);
});
