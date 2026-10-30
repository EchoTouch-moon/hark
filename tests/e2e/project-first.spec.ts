import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from './project-fixture';
const EVIDENCE = 'handoff/EVIDENCE/project-first-2026-10-30';

test('没有项目时先登记，保留旧记录只读且没有假进展', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' })));
  await page.route('**/api/v1/observer/projects', route => route.fulfill({ json: { projects: [] } }));
  await page.route('**/api/v1/threads', route => route.fulfill({ json: { threads: [{ id: 'legacy-unbound', title: '旧话题', projectId: null, updatedAt: new Date().toISOString() }] } }));
  await page.route('**/api/v1/chat/history?*', route => route.fulfill({ json: { messages: [{ id: 'legacy-message', role: 'user', content: '合成旧记录，不能删除', createdAt: new Date().toISOString() }], adapter: 'mock', live: false } }));
  await page.clock.setSystemTime('2026-10-30T14:00:00+08:00');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /先带入一个项目/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '添加本地项目', exact: true })).toBeVisible();
  await expect(page.locator('#chat-input')).toHaveCount(0);
  await expect(page.getByText(/添柴|活力|项目刚创立/)).toHaveCount(0);
  await page.getByText('查看未关联项目的旧谈话（只读）').click();
  await expect(page.getByText('合成旧记录，不能删除', { exact: false })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/01-project-required-day.png`, fullPage: true });
});

test('已登记项目进入谈话，结论按需展开，失败保留草稿且回访恢复', async ({ page, projectFixture }) => {
  await page.addInitScript(() => window.localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' })));
  await page.clock.setSystemTime('2026-10-30T14:00:00+08:00');
  let releaseHistory!: () => void;
  const historyGate = new Promise<void>(resolve => { releaseHistory = resolve; });
  let historyWaiting = false;
  await page.route('**/api/v1/analysis/runs?*', async route => {
    if (route.request().method() === 'GET' && !historyWaiting) {
      historyWaiting = true;
      await historyGate;
      await route.fulfill({ json: { runs: [] } });
    } else await route.continue();
  });
  await page.goto(`/?project=${encodeURIComponent(projectFixture.id)}`);
  await expect(page).toHaveURL(new RegExp(`/t/${projectFixture.threadId}$`));
  await expect(page.getByRole('region', { name: '当前项目与观察结论' })).toContainText('合成项目 · 炉边');
  await expect(page.getByText('已取得 Git 观察，但还没有能确认当前版本的测试证据。')).toBeVisible();
  const input = page.locator('#chat-input');
  await expect(input).toBeVisible();
  const heat = await page.locator('.canvas-shell').getAttribute('data-ember-heat');
  for (const text of ['目标是完成合成验证', '记录第二项合成问题', '第三条交流不是项目推进']) {
    await input.fill(text);
    await input.press('Enter');
    await expect(page.locator('.chat-msg--user').last()).toContainText(text);
    await expect(input).toBeEditable();
  }
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-ember-heat', heat!);
  await expect(page.getByText(/活力|代码正如火如荼|添柴/)).toHaveCount(0);
  await page.route('**/api/v1/chat', route => route.fulfill({ status: 503, json: { message: '合成发送失败' } }));
  await input.fill('失败后保留的项目草稿');
  await input.press('Enter');
  await expect(input).toHaveValue('失败后保留的项目草稿');
  await expect(page.getByRole('alert')).toContainText('发送失败');
  await page.unroute('**/api/v1/chat');
  await input.press('Enter');
  await expect(page.locator('.chat-msg--user').last()).toContainText('失败后保留的项目草稿');
  await expect(input).toHaveValue('');
  await expect(input).toBeEditable();
  await expect(page.getByRole('button', { name: '分析这个项目（先确认调用方式）', includeHidden: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '分析这个项目（先确认调用方式）' })).not.toBeVisible();
  await page.getByText('查看观察依据与分析入口', { exact: true }).click();
  await page.getByRole('button', { name: '分析这个项目（先确认调用方式）' }).click();
  const card = page.locator('.project-focus .analysis-card');
  await expect(card).toContainText('Mock 演示 · 未调用真实 AI');
  await expect(card.locator('h2')).toBeVisible();
  expect(historyWaiting).toBe(true);
  const lateHistory = page.waitForResponse(response => response.request().method() === 'GET' && response.url().includes('/api/v1/analysis/runs?'));
  releaseHistory();
  await lateHistory;
  await page.evaluate(() => new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
  await expect(card.locator('h2')).toBeVisible();
  await expect(card.locator('.analysis-findings').first()).not.toBeVisible();
  await card.getByText('展开依据与下一步', { exact: true }).click();
  await expect(card.locator('.analysis-findings').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.chat-msg--user').last()).toContainText('失败后保留的项目草稿');
  await expect(card.locator('h2')).toBeVisible();
  await expect(card.locator('.analysis-findings').first()).not.toBeVisible();
  await expect(page.locator('.chat-msg').last()).toHaveAttribute('data-msg-enter', 'ready');
  await expect(page.locator('.chat-msg').last()).toBeInViewport();
  await page.screenshot({ path: `${EVIDENCE}/02-project-conversation-day.png`, fullPage: true });
  await page.clock.setSystemTime('2026-10-30T22:00:00+08:00');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-hearth-period', 'night');
  await expect(input).toBeVisible();
  await expect(page.locator('.chat-msg').last()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: `${EVIDENCE}/03-project-conversation-night-reduced.png`, fullPage: true });
});

test('无效项目不能开始谈，切换项目不带入旧草稿', async ({ page, projectFixture }) => {
  await page.addInitScript(() => window.localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' })));
  await page.goto(`/t/${projectFixture.threadId}`);
  await page.locator('#chat-input').fill('只属于原项目的草稿');
  await page.goto('/?project=missing-project');
  await expect(page.locator('.project-start__error')).toBeVisible();
  await expect(page.locator('#chat-input')).toHaveCount(0);
  await expect(page.getByText('只属于原项目的草稿')).toHaveCount(0);
  await page.getByRole('button', { name: /合成项目 · 炉边/ }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${projectFixture.threadId}$`));
  await expect(page.locator('#chat-input')).toBeVisible();
});


test('界面添加第二个项目后隔离谈话，并恢复原项目草稿', async ({ page, baseURL, projectFixture }) => {
  const repo = mkdtempSync(path.join(tmpdir(), 'hearth-project-entry-ui-'));
  let secondId: string | undefined;
  let releaseRefresh = () => {};
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const headers = { 'x-csrf-token': session.csrfToken, origin: baseURL! };
  try {
    writeFileSync(path.join(repo, 'README.md'), '# Another synthetic project\nUI registration only.\n');
    execFileSync('git', ['-C', repo, 'init', '-q']);
    await page.addInitScript(() => window.localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' })));
    await page.clock.setSystemTime('2026-10-30T14:00:00+08:00');
    await page.goto(`/t/${projectFixture.threadId}`);
    await page.locator('#chat-input').fill('原项目独有的未发送草稿');
    await page.getByRole('link', { name: '选择项目', exact: true }).click();
    await page.getByLabel('本地 Git 仓库路径', { exact: true }).fill(repo);
    await page.getByLabel('显示名称（可选）', { exact: true }).fill('另一个合成项目');
    await page.getByLabel('我确认将该本地路径加入只读观察', { exact: true }).check();
    const added = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/v1/observer/projects'));
    await page.getByRole('button', { name: '添加项目', exact: true }).click();
    const response = await added;
    expect(response.status()).toBe(201);
    secondId = (await response.json()).project.id as string;
    await page.screenshot({ path: `${EVIDENCE}/04-project-added-day.png`, fullPage: true });
    await page.getByRole('link', { name: '进入这个项目的谈话', exact: true }).click();
    await expect(page.getByRole('region', { name: '当前项目与观察结论' })).toContainText('另一个合成项目');
    await expect(page.locator('#chat-input')).toHaveValue('');
    let delayRefresh = true;
    let markRefresh!: () => void;
    const refreshStarted = new Promise<void>(resolve => { markRefresh = resolve; });
    const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
    await page.route('**/api/v1/threads', async route => {
      if (route.request().method() === 'GET' && delayRefresh) {
        delayRefresh = false;
        const response = await route.fetch();
        markRefresh();
        await refreshGate;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await page.locator('#chat-input').fill('只属于第二个项目的消息');
    await page.locator('#chat-input').press('Enter');
    await expect(page.locator('.chat-msg--user')).toContainText('只属于第二个项目的消息');
    await expect(page.locator('#chat-input')).toBeEditable();
    await refreshStarted;
    await page.getByRole('button', { name: '打开菜单', exact: true }).click();
    await page.getByRole('button', { name: '历史对话', exact: true }).click();
    await page.locator('.thread-item').filter({ has: page.getByText(projectFixture.title, { exact: true }) }).click();
    await expect(page.locator('#chat-input')).toHaveValue('原项目独有的未发送草稿');
    await expect(page.locator('.chat-msg')).toHaveCount(0);
    await expect(page.getByRole('region', { name: '当前项目与观察结论' })).toContainText('合成项目 · 炉边');
    const lateRefresh = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/v1/threads');
    releaseRefresh();
    await lateRefresh;
    await page.evaluate(() => new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
    await expect(page.locator('#chat-input')).toHaveValue('原项目独有的未发送草稿');
    await expect(page.getByRole('region', { name: '当前项目与观察结论' })).toContainText('合成项目 · 炉边');
    await page.getByRole('button', { name: '打开菜单', exact: true }).click();
    await page.getByRole('button', { name: '历史对话', exact: true }).click();
    await page.locator('.thread-item').filter({ has: page.getByText('另一个合成项目 · 讨论', { exact: true }) }).click();
    await expect(page.locator('#chat-input')).toHaveValue('');
    await expect(page.locator('.chat-msg--user')).toContainText('只属于第二个项目的消息');
    const scoped = await (await page.request.get(`/api/v1/threads?projectId=${secondId}`)).json();
    expect(scoped.threads).toHaveLength(1);
    await page.reload();
    await expect(page.locator('.chat-msg--user')).toContainText('只属于第二个项目的消息');
    expect((await (await page.request.get(`/api/v1/threads?projectId=${secondId}`)).json()).threads).toHaveLength(1);
  } finally {
    releaseRefresh();
    if (secondId) await page.request.delete(`/api/v1/observer/projects/${secondId}`, { headers });
    rmSync(repo, { recursive: true, force: true });
  }
});
