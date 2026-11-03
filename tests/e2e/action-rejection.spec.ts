import { expect, test, type Page, type Route } from '@playwright/test';
import { dismissWelcome } from './fixture-helpers';

/**
 * 行动执行的浏览器回归（PR #34 复审 P1 的第二批）。
 *
 * 合同：
 * - 服务端明确拒绝（如 403 LEGACY_ACTIONS_DISABLED）不产生本地进度/完成结果，
 *   占位“正在处理”必须撤掉，原始 Action 与错误原因仍然可见；
 * - 本地消息写入只发生在“行动成功”且确实是离线演示时，不在渲染状态更新里；
 * - 真实 API 会话里的拒绝不写 localStorage；
 * - 501 / 网络失败仍保留明确的离线演示；
 * - 切换线程后到达的迟到响应不得污染新线程。
 */

const LIST = (threads: Array<{ id: string; title: string; preview: string }>) =>
  JSON.stringify({
    threads: threads.map((thread) => ({ ...thread, projectId: null, updatedAt: '2026-11-03T00:00:00.000Z' })),
  });

const actionMessage = (threadId: string, id: string) => ({
  id,
  role: 'assistant',
  content: '合成建议：有一条值得看一眼的本地检查。',
  createdAt: '2026-11-03T00:00:00.000Z',
  adapter: 'mock',
  threadId,
  parts: [
    { type: 'text', text: '合成建议：有一条值得看一眼的本地检查。' },
    {
      type: 'actions',
      actions: [
        { id: 'act-diagnose', label: '诊断', needsConfirm: false, riskNote: '只读演示，不改任何东西' },
      ],
    },
  ],
});

const history = (threadId: string, messages: unknown[]) =>
  JSON.stringify({ messages, confirmedUserMessages: [], adapter: 'mock', live: false });

const localMessages = (page: Page) =>
  page.evaluate(() => {
    const raw = globalThis.localStorage.getItem('hearth.chat.localMsgs.v2');
    return raw ? (JSON.parse(raw) as Record<string, Array<{ id: string; parts?: Array<{ type: string }> }>>) : null;
  });

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** 旧版演示边界：线程列表不可用、历史可读、proactive 不可用 → 本地演示建议。 */
async function openOfflineDemo(page: Page, execute: (route: Route) => Promise<void>): Promise<void> {
  await page.route('**/api/v1/threads', (route) => route.abort('failed'));
  await page.route('**/api/v1/chat/history**', (route) =>
    fulfillJson(route, 200, JSON.parse(history('thread-offline', []))),
  );
  await page.route('**/api/v1/threads/*/proactive', (route) => route.abort('failed'));
  await page.route('**/api/v1/threads/*/actions/*/execute', execute);
  await page.goto('/');
  await dismissWelcome(page);
}


test('离线演示收到 403：不生成假进度、不提前持久化、保留 Action 与错误', async ({ page }) => {
  await openOfflineDemo(page, (route) =>
    fulfillJson(route, 403, { error: { code: 'LEGACY_ACTIONS_DISABLED', message: '旧模拟操作当前不可用。' } }),
  );

  const diagnose = page.getByRole('button', { name: '诊断', exact: true });
  await expect(diagnose).toBeVisible();

  await diagnose.click();

  // 服务端原因必须能被用户看见。
  await expect(page.getByText('旧模拟操作当前不可用。')).toBeVisible();
  // 失败后不得留下“正在处理”占位。
  await expect(page.getByText(/正在处理「诊断」/)).toHaveCount(0);
  // 原始建议内容仍然可见，未被执行的内容不消失。
  await expect(page.getByText(/有一件事值得看一眼/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '诊断', exact: true })).toBeVisible();
  // 不得写出任何“已完成”结果。
  await expect(page.getByText(/演示跑通了/)).toHaveCount(0);
  // 等待中的占位从不落盘。
  const partsBag = await page.evaluate(() => {
    const raw = globalThis.localStorage.getItem('hearth.chat.parts.v2');
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  });
  expect(Object.keys(partsBag).some((key) => key.startsWith('progress-pending-'))).toBe(false);

  // 本地记录必须保持原始 Action，而不是被提前改成“已消费”。
  const bag = await localMessages(page);
  const stored = Object.values(bag ?? {}).flat();
  const suggestion = stored.find((message) => message.id.startsWith('mock-proactive-'));
  expect(suggestion, '演示建议应仍留在本地记录中').toBeTruthy();
  expect(suggestion?.parts?.some((part) => part.type === 'actions')).toBe(true);
});

test('真实 API 会话里的 403：不写本地记录，撤掉占位并保留错误', async ({ page }) => {
  await page.route('**/api/v1/threads', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: LIST([{ id: 'thread-live', title: '真实线程', preview: '' }]) });
  });
  await page.route('**/api/v1/chat/history**', (route) => {
    const threadId = new URL(route.request().url()).searchParams.get('threadId') ?? 'thread-live';
    return fulfillJson(route, 200, JSON.parse(history(threadId, [
      { id: 'user-1', role: 'user', content: '看看本地检查', createdAt: '2026-11-03T00:00:00.000Z', adapter: 'mock', threadId },
      actionMessage(threadId, 'server-action-1'),
      { id: 'server-other-1', role: 'assistant', content: '另一条正常历史', createdAt: '2026-11-03T00:00:01.000Z', adapter: 'mock', threadId },
    ])));
  });
  await page.route('**/api/v1/threads/*/proactive', (route) => fulfillJson(route, 200, { suggestion: null }));
  await page.route('**/api/v1/threads/*/actions/*/execute', (route) =>
    fulfillJson(route, 403, { error: { code: 'LEGACY_ACTIONS_DISABLED', message: '旧模拟操作当前不可用。' } }),
  );

  await page.goto('/t/thread-live');
  await dismissWelcome(page);

  await expect(page.getByRole('button', { name: '诊断', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '诊断', exact: true }).click();

  await expect(page.getByText('旧模拟操作当前不可用。')).toBeVisible();
  await expect(page.getByText(/正在处理「诊断」/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '诊断', exact: true })).toBeVisible();
  // 同线程的其他正常历史不能被一起清掉。
  await expect(page.getByText('另一条正常历史')).toBeVisible();
  expect(await localMessages(page)).toBeNull();
});

test('501 仍保留明确标注的离线演示', async ({ page }) => {
  await openOfflineDemo(page, (route) =>
    fulfillJson(route, 501, { error: { code: 'NOT_IMPLEMENTED', message: '接口尚未实现' } }),
  );

  await page.getByRole('button', { name: '诊断', exact: true }).click();

  await expect(page.getByText(/演示跑通了/).first()).toBeVisible();
  await expect(page.getByText(/这不是真实洞察或真实构建/).first()).toBeVisible();

  const bag = await localMessages(page);
  const stored = Object.values(bag ?? {}).flat();
  expect(stored.some((message) => message.id.startsWith('mock-progress-'))).toBe(true);
});

test('网络失败仍保留明确标注的离线演示', async ({ page }) => {
  await openOfflineDemo(page, (route) => route.abort('failed'));

  await page.getByRole('button', { name: '诊断', exact: true }).click();

  await expect(page.getByText(/演示跑通了/).first()).toBeVisible();
  await expect(page.getByText('旧模拟操作当前不可用。')).toHaveCount(0);

  const bag = await localMessages(page);
  const stored = Object.values(bag ?? {}).flat();
  expect(stored.some((message) => message.id.startsWith('mock-progress-'))).toBe(true);
});

test('切换线程后到达的迟到拒绝不得污染新线程', async ({ page }) => {
  await page.route('**/api/v1/threads', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: LIST([
        { id: 'thread-late-a', title: 'A 线程', preview: '' },
        { id: 'thread-late-b', title: 'B 线程', preview: '' },
      ]),
    });
  });
  await page.route('**/api/v1/chat/history**', (route) => {
    const threadId = new URL(route.request().url()).searchParams.get('threadId') ?? '';
    const messages = threadId === 'thread-late-a'
      ? [actionMessage(threadId, 'server-action-late')]
      : [{ id: 'b-message', role: 'assistant', content: 'B 线程的旧消息', createdAt: '2026-11-02T00:00:00.000Z', adapter: 'mock', threadId }];
    return fulfillJson(route, 200, JSON.parse(history(threadId, messages)));
  });
  await page.route('**/api/v1/threads/*/proactive', (route) => fulfillJson(route, 200, { suggestion: null }));
  await page.route('**/api/v1/threads/thread-late-a/actions/*/execute', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await fulfillJson(route, 403, { error: { code: 'LEGACY_ACTIONS_DISABLED', message: '旧模拟操作当前不可用。' } });
  });

  await page.goto('/t/thread-late-a');
  await dismissWelcome(page);
  await expect(page.getByRole('button', { name: '诊断', exact: true })).toBeVisible();

  const lateResponse = page.waitForResponse((response) => response.url().includes('/actions/') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '诊断', exact: true }).click();

  await page.locator('.hearth-menu > summary').click();
  await page.getByText('历史对话', { exact: true }).click();
  await expect(page.locator('.thread-rail')).toBeVisible();
  await page.getByRole('button', { name: /B 线程/ }).click();
  await expect(page.getByText('B 线程的旧消息').first()).toBeVisible();

  const status = (await lateResponse).status();
  expect(status).toBe(403);
  await page.waitForTimeout(300);

  await expect(page.getByText('旧模拟操作当前不可用。')).toHaveCount(0);
  await expect(page.getByText(/正在处理「诊断」/)).toHaveCount(0);
  await expect(page.getByText(/演示跑通了/)).toHaveCount(0);
  await expect(page.getByText('B 线程的旧消息').first()).toBeVisible();
});
