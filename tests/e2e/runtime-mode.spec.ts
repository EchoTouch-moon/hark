import { expect, test } from '@playwright/test';

const SHOT_DIR = 'handoff/EVIDENCE/g1a-frontend';

test('unknown and real mode never mount Demo actions, including direct URLs', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seedCalls = 0;
  let legacyProjectReads = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/demo/seed')) seedCalls++;
    if (path === '/api/v1/projects') legacyProjectReads++;
  });

  await page.route('**/api/v1/health', async (route) => {
    await gate;
    await route.fulfill({ json: { demoMode: false, legacyDemoAvailable: false } });
  });

  // 1. Loading / unknown mode: direct access to /demo fails closed
  await page.goto('/demo', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('正在确认运行模式…')).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);

  // 2. Health response fulfills with real mode (demoMode: false)
  release();
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);
  await page.screenshot({ path: `${SHOT_DIR}/06-real-mode-demo-gate-failclosed.png`, fullPage: true });

  // 3. Conversation-first root: direct access displays conversation and clear offline indicator
  await page.goto('/');
  await expect(page.getByText(/离线演示|不连接真实模型|不连接模型/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);

  // 4. Projects page: Observer projects displayed, legacy Demo projects never mounted in real mode
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
  await expect(page.getByLabel('任务项目', { exact: true })).toHaveCount(0);

  // 5. Back navigation to conversation is visible and accessible
  await expect(page.getByRole('link', { name: /对话/ })).toBeVisible();

  // 6. Menu navigation and keyboard Esc handling
  const menuBtn = page.getByRole('button', { name: '打开菜单' });
  if (await menuBtn.isVisible()) {
    await menuBtn.click();
    await expect(page.getByRole('button', { name: '历史对话' })).toBeVisible();
    await page.keyboard.press('Escape');
  }

  // 7. Verify zero forbidden mutations or legacy project leaks
  expect(seedCalls).toBe(0);
  expect(legacyProjectReads).toBe(0);
});

test('invalid mode fails closed and a deliberate retry can recover', async ({ page }) => {
  let valid = false;
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({
      json: valid ? { demoMode: false, legacyDemoAvailable: false } : { demoMode: 'false' },
    }),
  );
  await page.goto('/demo');
  await expect(page.getByText('无法确认服务端运行模式，请重试。')).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);
  await page.screenshot({ path: `${SHOT_DIR}/07-invalid-mode-error-recovery.png`, fullPage: true });

  valid = true;
  await page.getByRole('button', { name: /重试/ }).click();
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();
});

test('missing or false legacyDemoAvailable fails closed even if demoMode is true', async ({ page }) => {
  // Backend has demoMode: true, but legacyDemoAvailable is false
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({ json: { demoMode: true, legacyDemoAvailable: false } }),
  );
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);

  // When legacyDemoAvailable is completely omitted from health
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({ json: { demoMode: true } }),
  );
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);
});

test('offline indicator is actually visible across welcome flow, day/night themes, and desktop viewports', async ({ page }) => {
  // 1. Day mode, 1440x900 viewport
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');

  const welcome = page.getByTestId('hearth-welcome');
  await expect(welcome).toBeVisible({ timeout: 10_000 });
  const welcomeBadge = welcome.getByRole('status', { name: '离线演示 · 不连接真实模型' });
  await expect(welcomeBadge).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/01-welcome-mock-badge-day.png`, fullPage: true });
  await page.screenshot({ path: `${SHOT_DIR}/05-desktop-1440x900.png`, fullPage: true });

  // 2. Night mode, 1280x800 viewport
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(welcomeBadge).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/02-welcome-mock-badge-night.png`, fullPage: true });

  // 3. 1280x800 viewport has no horizontal scroll
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // 4. Skip welcome and enter conversation
  const skip = page.getByRole('button', { name: /跳过欢迎/ });
  await skip.click();
  await expect(welcome).toHaveCount(0);

  // 5. Offline badge in conversation header is visible
  const chatBadge = page.getByRole('status', { name: '离线演示 · 不连接真实模型' });
  await expect(chatBadge).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/04-desktop-1280x800.png`, fullPage: true });

  // 6. Send message and assert mock response
  const input = page.locator('#chat-input');
  await expect(input).toBeVisible();
  await input.fill('测试离线回复与标识');
  await input.press('Enter');

  await expect(page.getByText('Hearth · Mock').first()).toBeVisible({ timeout: 15_000 });
  await expect(chatBadge).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/03-chat-mock-conversation.png`, fullPage: true });
});

test('backend action rejection preserves user draft and never fabricates progress or fake completion', async ({ page }) => {
  // Pre-seed completed welcome to go straight to chat
  await page.addInitScript(() => {
    window.localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' }));
  });

  // Supply thread history that includes an action button
  await page.route(/\/api\/v1\/chat\/history/, async (route) => {
    await route.fulfill({
      json: {
        messages: [
          {
            id: 'msg-user-action',
            role: 'user',
            content: '测试动作',
            createdAt: '2026-10-30T07:00:00.000Z',
          },
          {
            id: 'msg-assistant-action',
            role: 'assistant',
            content: '需要执行受限操作',
            createdAt: '2026-10-30T07:00:01.000Z',
            adapter: 'mock',
            parts: [
              {
                type: 'actions',
                actions: [
                  {
                    id: 'act-legacy-1',
                    label: '执行受限动作',
                    runId: 'run-legacy-1',
                    needsConfirm: false,
                  },
                ],
              },
            ],
          },
        ],
        adapter: 'mock',
        live: false,
      },
    });
  });

  // Route execute endpoint to return 403 LEGACY_ACTIONS_DISABLED
  await page.route(/\/api\/v1\/runs\/.*\/execute/, async (route) => {
    await route.fulfill({
      status: 403,
      json: {
        error: {
          code: 'LEGACY_ACTIONS_DISABLED',
          message: '旧演示执行接口已在此版本中禁用',
        },
      },
    });
  });

  await page.goto('/');

  // Wait for the action button to be rendered
  const actionBtn = page.getByRole('button', { name: '执行受限动作' });
  await expect(actionBtn).toBeVisible({ timeout: 10_000 });

  // User types a draft while looking at the action
  const input = page.locator('#chat-input');
  await expect(input).toBeVisible();
  await input.fill('草稿内容必须保留');

  // Trigger the action
  await actionBtn.click();

  // Expect error alert shown
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/旧模拟操作当前不可用|旧演示操作当前不可用|出了点问题/).first()).toBeVisible();

  // Assert NO fake "已完成" or fake completion states fabricated
  expect(await page.getByText(/已完成|completed/i).count()).toBe(0);

  // Assert user draft is strictly preserved
  expect(await input.inputValue()).toBe('草稿内容必须保留');

  await page.screenshot({ path: `${SHOT_DIR}/08-action-rejection-draft-preserved.png`, fullPage: true });
});

test('backend proactive null returns clean state without fake injected cards', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' }));
  });

  // Proactive endpoint returns null
  await page.route(/\/api\/v1\/threads\/.*\/proactive/, async (route) => {
    await route.fulfill({ json: { suggestion: null } });
  });

  await page.goto('/');
  await expect(page.locator('#chat-input')).toBeVisible();

  // Verify no fake proactive cards or badges injected
  await expect(page.locator('.proactive-card, [data-proactive]')).toHaveCount(0);
  await expect(page.getByText(/建议：/)).toHaveCount(0);

  await page.screenshot({ path: `${SHOT_DIR}/09-proactive-null-clean-state.png`, fullPage: true });
});
