import { expect, test, type Page } from '@playwright/test';
import { dismissWelcome } from './fixture-helpers';

async function prepareDeniedState(page: Page): Promise<void> {
  const session = await page.request.get('/api/v1/auth/session');
  expect(session.ok()).toBeTruthy();
  const { csrfToken } = await session.json() as { csrfToken: string };
  const origin = new URL(session.url()).origin;
  const revoke = await page.request.put('/api/v1/hearth/permissions', {
    headers: { origin, 'x-csrf-token': csrfToken }, data: { observe: false },
  });
  expect(revoke.ok()).toBeTruthy();
  await page.goto('/');
  await dismissWelcome(page);
  await expect(page.getByRole('button', { name: '去授权' })).toBeVisible();
}

test('首次授权取得 CSRF 会话，写入成功后重新读取真实火候', async ({ page }) => {
  await prepareDeniedState(page);
  expect(await page.evaluate(() => globalThis.localStorage.getItem('hearth.csrfToken'))).toBeNull();
  const calls: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/auth/session' || pathname === '/api/v1/hearth/permissions' || pathname === '/api/v1/hearth') {
      calls.push(`${request.method()} ${pathname}`);
    }
  });
  const written = page.waitForResponse((response) => response.url().endsWith('/api/v1/hearth/permissions') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: '去授权' }).click();
  const writeResponse = await written;
  expect(writeResponse.status()).toBe(200);
  expect(writeResponse.request().headers()['x-csrf-token']).toBeTruthy();
  expect((await writeResponse.json()).permissions).toMatchObject({ observe: true, execute: false });
  await expect(page.getByRole('button', { name: '去授权' })).toHaveCount(0);
  await expect.poll(() => calls).toContain('GET /api/v1/hearth');
  expect(calls.indexOf('GET /api/v1/auth/session')).toBeGreaterThanOrEqual(0);
  expect(calls.indexOf('GET /api/v1/auth/session')).toBeLessThan(calls.indexOf('PUT /api/v1/hearth/permissions'));
  expect(calls.indexOf('PUT /api/v1/hearth/permissions')).toBeLessThan(calls.indexOf('GET /api/v1/hearth'));
});

test('业务拒绝会显示错误，且不会自动重复写入', async ({ page }) => {
  await prepareDeniedState(page);
  let writes = 0;
  await page.route('**/api/v1/hearth/permissions', async (route) => {
    writes += 1;
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ORIGIN_DENIED', message: '来源被拒绝' } }) });
  });
  await page.getByRole('button', { name: '去授权' }).click();
  await expect(page.getByRole('alert')).toContainText('未授权读取');
  await expect(page.locator('#xp-auth-error-detail')).toHaveText('来源被拒绝');
  expect(writes).toBe(1);
  await expect(page.getByRole('button', { name: '去授权' })).toBeVisible();
});
