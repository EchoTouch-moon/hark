import { expect, type Page } from '@playwright/test';

/** Open the E1 shell on a local ?fixture= mode, count /api requests, and pass the welcome screen if shown. */
export async function openFixture(page: Page, fixture: string): Promise<{ apiRequests: string[] }> {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.goto(`/?fixture=${fixture}`);
  const skip = page.getByRole('button', { name: /跳过欢迎/ });
  try {
    await skip.waitFor({ state: 'visible', timeout: 5_000 });
    await skip.click();
  } catch {
    /* welcome already dismissed */
  }
  await expect(page.locator('.ember-seed')).toBeVisible({ timeout: 15_000 });
  return { apiRequests };
}
