import { expect, test } from '@playwright/test';
import { dismissWelcome, mockHearth } from './fixture-helpers';

test('空服务器列表不会重新选中旧项目线程的缓存 ID', async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('hearth.threads.v2', JSON.stringify([
      { id: 'withheld-old-thread', title: 'SYNTHETIC OLD PROJECT', preview: 'SYNTHETIC PROJECT PREVIEW', projectId: null, updatedAt: '2026-11-02' },
    ]));
    globalThis.localStorage.setItem('hearth.activeThread.v2', 'withheld-old-thread');
  });
  await mockHearth(page, 'ok');
  await page.route('**/api/v1/threads', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ threads: [] }),
  }));
  const historyIds: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/chat/history') historyIds.push(url.searchParams.get('threadId') ?? '');
  });
  await page.goto('/t/withheld-old-thread');
  await dismissWelcome(page);
  await expect.poll(() => historyIds.length).toBeGreaterThan(0);
  expect(historyIds).not.toContain('withheld-old-thread');
  expect(historyIds.every(id => id.startsWith('thread-global-'))).toBe(true);
  await expect(page.getByText('SYNTHETIC OLD PROJECT')).toHaveCount(0);
  await expect(page.getByText('SYNTHETIC PROJECT PREVIEW')).toHaveCount(0);
  const preserved = await page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('hearth.threads.v2') ?? '[]'));
  expect(preserved).toMatchObject([{ id: 'withheld-old-thread', preview: 'SYNTHETIC PROJECT PREVIEW' }]);
  const reply = page.waitForResponse(response => response.url().endsWith('/api/v1/chat') && response.request().method() === 'POST');
  await page.getByRole('textbox', { name: '输入消息' }).fill('SYNTHETIC GLOBAL MESSAGE');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  expect((await reply).status()).toBe(200);
  await expect(page.getByText('SYNTHETIC GLOBAL MESSAGE', { exact: true })).toBeVisible();
});

test('列表上限外的全局线程须经服务端确认后才能打开', async ({ page }) => {
  const listed = Array.from({ length: 100 }, (_, i) => ({
    id: `global-${i}`, title: `Global ${i}`, projectId: null, updatedAt: '2026-11-02',
  }));
  await mockHearth(page, 'ok');
  await page.route('**/api/v1/threads', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ threads: listed }),
  }));
  let detailCalls = 0;
  await page.route('**/api/v1/threads/global-out-of-list', route => {
    detailCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      thread: { id: 'global-out-of-list', title: 'Older global', projectId: null, updatedAt: '2026-11-01' },
    }) });
  });
  const historyIds: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/chat/history') historyIds.push(url.searchParams.get('threadId') ?? '');
  });
  await page.goto('/t/global-out-of-list');
  await dismissWelcome(page);
  await expect.poll(() => historyIds).toContain('global-out-of-list');
  expect(detailCalls).toBeGreaterThan(0);
});

test('服务端拒绝旧项目线程时显示错误且不读取其历史', async ({ page }) => {
  await mockHearth(page, 'ok');
  await page.route('**/api/v1/threads', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      threads: [{ id: 'global-safe', title: 'Global', projectId: null, updatedAt: '2026-11-02' }],
    }),
  }));
  await page.route('**/api/v1/threads/old-project-thread', route => route.fulfill({
    status: 403, contentType: 'application/json', body: JSON.stringify({
      error: { code: 'PROJECT_CHAT_UNAVAILABLE', message: '项目内聊天暂不可用' },
    }),
  }));
  const historyIds: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/chat/history') historyIds.push(url.searchParams.get('threadId') ?? '');
  });
  await page.goto('/t/old-project-thread');
  await dismissWelcome(page);
  await expect(page.getByRole('alert')).toContainText('项目内聊天暂不可用');
  await expect.poll(() => historyIds).toContain('global-safe');
  expect(historyIds).not.toContain('old-project-thread');
});

test('切换线程后旧的详情响应不会覆盖当前全局线程', async ({ page }) => {
  await mockHearth(page, 'ok');
  await page.route('**/api/v1/threads', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      threads: [{ id: 'global-current', title: 'Current', projectId: null, updatedAt: '2026-11-02' }],
    }),
  }));
  let releaseOld!: () => void;
  const oldMayComplete = new Promise<void>(resolve => { releaseOld = resolve; });
  let finishOld!: () => void;
  const oldFinished = new Promise<void>(resolve => { finishOld = resolve; });
  let oldStarted = false;
  await page.route('**/api/v1/threads/global-slow', async route => {
    oldStarted = true;
    await oldMayComplete;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      thread: { id: 'global-slow', title: 'Old slow', projectId: null, updatedAt: '2026-11-02' },
    }) }).catch(() => {});
    finishOld();
  });
  const historyIds: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/chat/history') historyIds.push(url.searchParams.get('threadId') ?? '');
  });
  try {
    await page.goto('/t/global-slow');
    await expect.poll(() => oldStarted).toBe(true);
    await page.evaluate(() => {
      globalThis.history.pushState(null, '', '/t/global-current');
      window.dispatchEvent(new globalThis.PopStateEvent('popstate'));
    });
    await expect.poll(() => historyIds).toContain('global-current');
    releaseOld();
    await oldFinished;
    await dismissWelcome(page);
    await expect(page.getByRole('textbox', { name: '输入消息' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.localStorage.getItem('hearth.activeThread.v2'))).toBe('global-current');
    expect(historyIds).not.toContain('global-slow');
  } finally {
    releaseOld();
  }
});
