import { expect, test } from '@playwright/test';

test('insights empty feed is not a fake-success wall', async ({ page }) => {
  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: '洞察' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/尚未评估洞察|当前没有需要关注的洞察/)).toBeVisible();
  await expect(page.getByRole('button', { name: '待关注' })).toBeVisible();
  await expect(page.locator('.insight-card')).toHaveCount(0);
  await page.screenshot({ path: 'handoff/EVIDENCE/insight-feed-empty.png', fullPage: true });
});

test('insight detail missing id is an error, not a fake card', async ({ page }) => {
  await page.goto('/insights/ins_missingmissing1');
  await expect(page.getByText(/这条洞察不存在或已被清除|加载失败/)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'handoff/EVIDENCE/insight-detail-missing.png', fullPage: true });
});
