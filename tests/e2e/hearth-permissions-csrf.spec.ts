import { expect, test, type Page } from '@playwright/test';
import { dismissWelcome } from './fixture-helpers';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../../apps/server/src/main';

// Isolate both server state and browser state: no pre-created session, shared DB,
// or fixture response can make this cold-start flow pass accidentally.
test('全新浏览器和空服务端会话可进入授权并重新读取真实火候', async ({ page, context }) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hearth-cold-start-'));
  const env = {
    HEARTH_INSIGHT_DB: path.join(dir, 'insight.sqlite'),
    HEARTH_ANALYSIS_DB: path.join(dir, 'analysis.sqlite'),
    HEARTH_OBSERVER_WATCH: '0',
    HEARTH_ANALYSIS_PROVIDER: 'mock',
    HEARTH_AUTOSEED: '0',
    HEARTH_PI_BIN: path.join(dir, 'nonexistent-live-provider'),
  };
  const original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    running = await startServer({
      port: 0, dbPath: path.join(dir, 'app.sqlite'),
      observerDbPath: path.join(dir, 'observer.sqlite'), artifactRoot: path.join(dir, 'artifacts'),
      staticDir: path.resolve('apps/web/dist'), allowedOrigins: [],
      demoMode: true, hearthPermissions: { observe: false, research: false, model: false },
    });
    const address = running.app.server.address();
    if (!address || typeof address === 'string') throw new Error('missing local test address');
    const origin = `http://127.0.0.1:${address.port}`;
    running.config.allowedOrigins.push(origin);
    expect(running.storage.getSetting('session')).toBeNull();
    expect(await context.storageState()).toEqual({ cookies: [], origins: [] });

    // Hold session creation until the first Hearth response has actually
    // arrived, while letting the other startup requests run normally.
    let releaseSession!: () => void;
    const firstHearthResponse = new Promise<void>(resolve => { releaseSession = resolve; });
    await page.route('**/api/v1/auth/session', async route => {
      await firstHearthResponse;
      await route.continue();
    });
    const calls: Array<{ method: string; path: string; status: number }> = [];
    page.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      if (['/api/v1/hearth', '/api/v1/auth/session', '/api/v1/hearth/permissions'].includes(pathname)) {
        calls.push({ method: response.request().method(), path: pathname, status: response.status() });
      }
      if (pathname === '/api/v1/hearth') releaseSession();
    });
    await page.goto(origin);
    await dismissWelcome(page);
    await expect(page.getByRole('button', { name: '去授权' })).toBeVisible();
    const firstGet = calls.find(call => call.path === '/api/v1/hearth');
    expect(firstGet).toMatchObject({ method: 'GET', status: 401 });
    const authIndex = calls.findIndex(call => call.path === '/api/v1/auth/session' && call.status === 200);
    const deniedIndex = calls.findIndex(call => call.path === '/api/v1/hearth' && call.status === 403);
    expect(authIndex).toBeGreaterThanOrEqual(0);
    expect(deniedIndex).toBeGreaterThan(authIndex);
    const written = page.waitForResponse(response => response.url().endsWith('/api/v1/hearth/permissions') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: '去授权' }).click();
    const writeResponse = await written;
    expect(writeResponse.status()).toBe(200);
    expect(writeResponse.request().headers()['x-csrf-token']).toBeTruthy();
    expect((await writeResponse.json()).permissions).toMatchObject({ observe: true, execute: false });
    const putIndex = calls.findIndex(call => call.path === '/api/v1/hearth/permissions' && call.method === 'PUT' && call.status === 200);
    await expect.poll(() => calls.slice(putIndex + 1).some(call => call.path === '/api/v1/hearth' && call.status === 200)).toBe(true);
    expect(calls.filter(call => call.path === '/api/v1/hearth/permissions' && call.method === 'PUT')).toHaveLength(1);
    await expect(page.getByRole('button', { name: '去授权' })).toHaveCount(0);
    expect(running.storage.getSetting('hearth.permissions')).toMatchObject({ observe: true });
    const countBeforeReload = calls.filter(call => call.path === '/api/v1/hearth' && call.status === 200).length;
    await page.reload();
    await expect.poll(() => calls.filter(call => call.path === '/api/v1/hearth' && call.status === 200).length).toBeGreaterThan(countBeforeReload);
    await expect(page.getByRole('button', { name: '去授权' })).toHaveCount(0);
  } finally {
    if (running) { await running.app.close(); running.storage.close(); }
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

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
