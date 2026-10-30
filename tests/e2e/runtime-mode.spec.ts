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

  // 3. Direct access to /cards in real mode also strictly fails closed
  await page.goto('/cards');
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /重新扫描/ })).toHaveCount(0);

  // 4. Conversation-first root: direct access displays conversation and clear offline indicator
  await page.goto('/');
  await expect(page.getByText(/当前对话为 Mock|离线演示|不连接真实模型/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);

  // 5. Projects page: Observer projects displayed, legacy Demo projects never mounted in real mode
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
  await expect(page.getByLabel('任务项目', { exact: true })).toHaveCount(0);

  // 6. Non-conversation pages do NOT display misleading global offline badge
  await expect(page.locator('.canvas-chrome--page .hearth-mode-label')).toHaveCount(0);

  // 7. Back navigation to conversation is visible and accessible
  await expect(page.getByRole('link', { name: /对话/ })).toBeVisible();

  // 8. Menu navigation and keyboard Esc handling
  const menuBtn = page.getByRole('button', { name: '打开菜单' });
  if (await menuBtn.isVisible()) {
    await menuBtn.click();
    await expect(page.getByRole('button', { name: '历史对话' })).toBeVisible();
    await page.keyboard.press('Escape');
  }

  // 9. Verify zero forbidden mutations or legacy project leaks
  expect(seedCalls).toBe(0);
  expect(legacyProjectReads).toBe(0);
});

test('invalid mode fails closed across /demo and /cards, and a deliberate retry can recover', async ({ page }) => {
  let valid = false;
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({
      json: valid ? { demoMode: false, legacyDemoAvailable: false } : { demoMode: 'false' },
    }),
  );

  // Direct /demo with invalid health
  await page.goto('/demo');
  await expect(page.getByText('无法确认服务端运行模式，请重试。')).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);
  await page.screenshot({ path: `${SHOT_DIR}/07-invalid-mode-error-recovery.png`, fullPage: true });

  // Direct /cards with invalid health
  await page.goto('/cards');
  await expect(page.getByText('无法确认服务端运行模式，请重试。')).toBeVisible();
  await expect(page.getByRole('button', { name: /初始化.*Demo/ })).toHaveCount(0);

  valid = true;
  await page.getByRole('button', { name: /重试/ }).click();
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();
});

test('real mode or missing legacyDemoAvailable fails closed across /demo and /cards', async ({ page }) => {
  // Case A: demoMode is true, but legacyDemoAvailable is false
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({ json: { demoMode: true, legacyDemoAvailable: false } }),
  );
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();
  await page.goto('/cards');
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();

  // Case B: demoMode is false, but legacyDemoAvailable is true (glitch/mismatch) -> MUST fail closed!
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({ json: { demoMode: false, legacyDemoAvailable: true } }),
  );
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();
  await page.goto('/cards');
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();

  // Case C: legacyDemoAvailable is completely omitted from health
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({ json: { demoMode: true } }),
  );
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();
  await page.goto('/cards');
  await expect(page.getByRole('heading', { name: '演示模式未启用' })).toBeVisible();
});

test('offline indicator is actually visible across welcome flow, true night theme, and desktop viewports', async ({ page }) => {
  // 1. Day mode, 1440x900 viewport (set clock to 14:00)
  await page.clock.setSystemTime('2026-10-30T14:00:00+08:00');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');

  const welcome = page.getByTestId('hearth-welcome');
  await expect(welcome).toBeVisible({ timeout: 10_000 });
  await expect(welcome).toHaveAttribute('data-period', 'day');
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-hearth-period', 'day');

  const welcomeBadge = welcome.getByRole('status', { name: /当前对话为 Mock|离线演示/ });
  await expect(welcomeBadge).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/01-welcome-mock-badge-day.png`, fullPage: true });
  await page.screenshot({ path: `${SHOT_DIR}/05-desktop-1440x900.png`, fullPage: true });

  // 2. Night mode, 1280x800 viewport (set clock to 22:00 / 10pm)
  await page.clock.setSystemTime('2026-10-30T22:00:00+08:00');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  const welcomeNight = page.getByTestId('hearth-welcome');
  await expect(welcomeNight).toBeVisible({ timeout: 10_000 });
  await expect(welcomeNight).toHaveAttribute('data-period', 'night');
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-hearth-period', 'night');

  const nightBadge = welcomeNight.getByRole('status', { name: /当前对话为 Mock|离线演示/ });
  await expect(nightBadge).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/02-welcome-mock-badge-night.png`, fullPage: true });

  // 3. 1280x800 viewport has no horizontal scroll
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // 4. Skip welcome and enter conversation
  const skip = page.getByRole('button', { name: /跳过欢迎/ });
  await skip.click();
  await expect(welcomeNight).toHaveCount(0, { timeout: 10_000 });

  // 5. Offline badge in conversation header is visible and explicitly scoped
  const chatBadge = page.getByRole('status', { name: /当前对话为 Mock|离线演示/ });
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

  // Enable demo mode in health so legacy action button is mounted for testing
  await page.route('**/api/v1/health', async (route) => {
    await route.fulfill({ json: { demoMode: true, legacyDemoAvailable: true } });
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

  // Track the actual POST execute request made by the frontend
  let executeCallMethod = '';
  let executeCallUrl = '';
  let executeCallStatus = 0;

  await page.route(/\/api\/v1\/threads\/.*\/actions\/.*\/execute/, async (route) => {
    executeCallMethod = route.request().method();
    executeCallUrl = route.request().url();
    executeCallStatus = 403;
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
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

  // Assert execute endpoint was called with POST to the exact actions endpoint and responded 403
  expect(executeCallMethod).toBe('POST');
  expect(executeCallUrl).toMatch(/\/api\/v1\/threads\/.*\/actions\/act-legacy-1\/execute/);
  expect(executeCallStatus).toBe(403);

  // Expect error alert shown
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/旧演示执行接口已在此版本中禁用|旧模拟操作当前不可用|出了点问题/).first()).toBeVisible();

  // Assert NO fake progress ("确认范围", "running") or fake completion was fabricated
  expect(await page.getByText(/确认范围|已完成|completed/i).count()).toBe(0);

  // Assert user draft is strictly preserved
  expect(await input.inputValue()).toBe('草稿内容必须保留');

  await page.screenshot({ path: `${SHOT_DIR}/08-action-rejection-draft-preserved.png`, fullPage: true });
});

test('backend proactive null returns clean state without fake injected cards', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' }));
  });

  // Empty conversation history to test clean empty greeting state
  await page.route(/\/api\/v1\/chat\/history/, async (route) => {
    await route.fulfill({ json: { messages: [], adapter: 'mock', live: false } });
  });

  // Proactive endpoint returns null
  await page.route(/\/api\/v1\/threads\/.*\/proactive/, async (route) => {
    await route.fulfill({ json: { suggestion: null } });
  });

  await page.goto('/');

  // Ensure loading is finished and surface is fully settled
  await expect(page.getByText('正在加载…')).toHaveCount(0, { timeout: 10_000 });
  const input = page.locator('#chat-input');
  await expect(input).toBeVisible();
  await expect(input).toBeEnabled();

  // Wait for greeting to settle
  await expect(page.getByRole('heading', { name: /想聊些什么|想从哪里开始/ })).toBeVisible();

  // Verify no fake proactive cards or badges injected
  await expect(page.locator('.proactive-card, [data-proactive]')).toHaveCount(0);
  await expect(page.getByText(/建议：/)).toHaveCount(0);

  await page.screenshot({ path: `${SHOT_DIR}/09-proactive-null-clean-state.png`, fullPage: true });
});

test('thread service failure renders error state with retry in history rail', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' }));
  });

  let shouldFail = true;
  await page.route('**/api/v1/threads', async (route) => {
    if (route.request().method() === 'GET' && shouldFail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        json: { message: 'Service Unavailable' },
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/');

  // Open the history rail
  const expandBtn = page.getByRole('button', { name: '展开线程列表' });
  if (await expandBtn.isVisible()) {
    await expandBtn.click();
  } else {
    const menuBtn = page.locator('.hearth-menu summary');
    await menuBtn.click();
    const historyBtn = page.getByRole('button', { name: '历史对话' });
    await expect(historyBtn).toBeVisible();
    await historyBtn.click();
  }

  // Thread rail should display error message and retry button, not false "无匹配线程"
  const threadError = page.locator('.thread-list__error');
  await expect(threadError).toBeVisible({ timeout: 10_000 });
  await expect(threadError.getByText(/加载线程失败|503/)).toBeVisible();
  await expect(page.locator('.thread-list__empty')).toHaveCount(0);

  // Clicking retry when service recovers should successfully clear the error
  shouldFail = false;
  const retryBtn = threadError.getByRole('button', { name: '重试' });
  await retryBtn.click();
  await expect(threadError).toHaveCount(0, { timeout: 10_000 });
});
