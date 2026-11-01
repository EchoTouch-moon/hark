import { expect, test, type Page } from '@playwright/test';
import { openFixture } from './fixture-helpers';

/**
 * Hearth E2E（docs/06 用例主表）
 * 覆盖 E2E-01/02/03/04/06/07/08/11 的浏览器路径；
 * E2E-05（过期卡）/E2E-09（L2 无审批）/E2E-10（伪造 verifier）在
 * apps/server/src/http/app.test.ts 与 packages/core 测试中已有服务端断言，
 * 浏览器层不重复构造非法状态。E2E-12（server 不可用）由 UI ErrorState 单元
 * 路径 + API 断连重试逻辑覆盖，见 tests 说明。
 */

const SHOT_DIR = 'handoff/EVIDENCE';

/** 稳定的卡片定位：按标题 heading 定位（不随按钮文案/状态变化） */
function cardByTitle(page: Page, title: string) {
  return page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .first();
}

async function seedViaUi(page: Page): Promise<void> {
  await page.goto('/cards');
  await page.getByRole('button', { name: /初始化|Demo 数据/ }).first().click();
  await expect(page.getByRole('button', { name: '查看证据' }).first()).toBeVisible({ timeout: 20_000 });
}

test.describe.configure({ mode: 'serial' });

test('E2E-11: 首次运行是真实空态，不制造假任务', async ({ page }) => {
  await page.goto('/cards');
  await expect(page.getByText(/没有值得打扰你的事情/)).toBeVisible({ timeout: 15_000 });
});

test('E2E-01: 初始化 Demo → 3 张卡片含 whyNow/来源/风险', async ({ page }) => {
  await seedViaUi(page);
  const cards = page.locator('[data-card], article:has(button:has-text("查看证据"))');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(3);
  await expect(page.getByText('项目构建未通过').first()).toBeVisible();
  await expect(page.getByText('两场会议需要协调').first()).toBeVisible();
  await expect(page.getByText(/L1/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/ui-home.png`, fullPage: true });
});

test('E2E-02: 查看证据 → 执行被拒绝 → 不伪造 completed/artifact', async ({ page }) => {
  await page.goto('/cards');
  const ciCard = cardByTitle(page, '项目构建未通过');
  await ciCard.getByRole('button', { name: /查看证据/ }).click();
  await expect(page.getByText(/fixture:\/\//).first()).toBeVisible();
  await ciCard.getByRole('button', { name: /开始处理|开始诊断/ }).click();
  // 执行被拒绝：卡上出现拒绝说明，且不出现已完成
  await expect(ciCard.getByText(/旧演示操作当前不可用/).first()).toBeVisible({ timeout: 15_000 });
  await expect(ciCard.getByText(/已完成|completed/i)).toHaveCount(0);
  // 服务端核实：无 completed run、无伪造 artifact
  const runs = await page.request.get('/api/v1/runs');
  const { runs: runList } = (await runs.json()) as { runs: Array<{ id: string; state: string }> };
  expect(runList.filter((r) => r.state === 'completed')).toHaveLength(0);
  expect(runList).toHaveLength(0);
});

test('E2E-03: 刷新后执行拒绝状态不消失、不伪造完成', async ({ page }) => {
  await page.goto('/cards');
  const ciCard = cardByTitle(page, '项目构建未通过');
  await expect(ciCard.getByText(/已完成|completed/i)).toHaveCount(0);
  await expect(ciCard.getByRole('button', { name: /开始处理|开始诊断/ }).first()).toBeVisible();
  await page.reload();
  const ciCard2 = cardByTitle(page, '项目构建未通过');
  await expect(ciCard2.getByText(/已完成|completed/i)).toHaveCount(0);
  await expect(ciCard2.getByRole('button', { name: /开始处理|开始诊断/ }).first()).toBeVisible();
});

test('E2E-04: 快速双击执行被拒且不产生任何 run', async ({ page }) => {
  await page.goto('/cards');
  const card = cardByTitle(page, '可以继续上次的研究');
  const btn = card.getByRole('button', { name: /开始处理/ }).first();
  await btn.click({ clickCount: 2, delay: 30 });
  await expect(card.getByText(/旧演示操作当前不可用/).first()).toBeVisible({ timeout: 15_000 });
  const { runs: all } = (await (await page.request.get('/api/v1/runs')).json()) as { runs: Array<{ id: string; state: string }> };
  expect(all).toHaveLength(0);
});

test('E2E-06: 忽略后卡片不再出现在主动建议（刷新也不重现）', async ({ page }) => {
  await page.goto('/cards');
  const card = cardByTitle(page, '两场会议需要协调');
  await card.getByRole('button', { name: /忽略/ }).click();
  // ConfirmDialog 确认
  const confirm = page.getByRole('button', { name: /确认|确定|忽略/ }).last();
  await confirm.click();
  await expect(page.locator('[data-card], article:has(button:has-text("查看证据"))').filter({ hasText: '两场会议需要协调' }).first()).not.toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator('[data-card], article:has(button:has-text("查看证据"))').filter({ hasText: '两场会议需要协调' }).first()).not.toBeVisible({ timeout: 10_000 });
});

test('E2E-07: 项目隔离由服务端保证', async ({ page }) => {
  await page.goto('/projects/project-atlas');
  await expect(page.getByText('Project Atlas').first()).toBeVisible();
  const atlasSection = page.locator('main');
  await expect(atlasSection.getByText(/project-beacon/i)).toHaveCount(0);
  await page.screenshot({ path: `${SHOT_DIR}/ui-projects.png`, fullPage: true });
  await page.goto('/projects/project-beacon');
  await expect(page.getByText('Project Beacon').first()).toBeVisible();
});

test('E2E-08: composer on mocked hearth — input, send gating, Demo badge', async ({ page }) => {
  await openFixture(page, 'ok');
  await expect(page.locator('.hearth-demo-badge')).toHaveText('演示数据');
  const input = page.locator('#canvas-input');
  const send = page.locator('.composer__send');
  await expect(input).toBeVisible();
  await expect(send).toHaveAttribute('aria-disabled', 'true');
  await input.fill('CI 失败了怎么办');
  await expect(input).toHaveValue('CI 失败了怎么办');
  await expect(send).not.toHaveAttribute('aria-disabled', 'true');
  await input.fill('   ');
  await expect(send).toHaveAttribute('aria-disabled', 'true');
});

test('Settings 保存可持久化', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByText(/Demo|演示/).first()).toBeVisible();
  const budget = page.locator('input[type="number"]').first();
  await budget.fill('2');
  await page.getByRole('button', { name: /保存/ }).click();
  await expect(page.getByText(/已保存|保存成功/).first()).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator('input[type="number"]').first()).toHaveValue('2');
  await page.screenshot({ path: `${SHOT_DIR}/ui-settings.png`, fullPage: true });
});

test('视口 1280×800 无水平滚动', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Activity 页无伪造 run 时间线（执行被拒后为空态）', async ({ page }) => {
  await page.goto('/activity');
  await expect(page.getByText(/还没有执行记录/).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOT_DIR}/ui-activity.png`, fullPage: true });
});
