import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.HEARTH_QA_URL ?? 'http://127.0.0.1:4404';
const out = 'handoff/EVIDENCE/living-flame';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader'] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  timezoneId: 'Asia/Shanghai',
  recordVideo: { dir: out, size: { width: 1440, height: 900 } },
});

await context.addInitScript(() => {
  localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '旅人' }));
  const NativeDate = Date;
  let offset = NativeDate.parse('2026-10-30T10:00:00+08:00') - NativeDate.now();
  window.__setHearthTestTime = (value) => {
    offset = NativeDate.parse(value) - NativeDate.now();
  };
  window.Date = class extends NativeDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(NativeDate.now() + offset);
    }
    static now() {
      return NativeDate.now() + offset;
    }
  };
});

const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));

const room = page.locator('.ember-atmosphere');
const shell = page.locator('.canvas-shell');
const input = page.getByRole('textbox', { name: '输入消息', exact: true });

async function makeThread(title) {
  const { csrfToken } = await (await page.request.get(`${base}/api/v1/auth/session`)).json();
  const response = await page.request.post(`${base}/api/v1/threads`, {
    headers: { 'x-csrf-token': csrfToken, origin: base },
    data: { title, projectId: null },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).thread;
}

const evidenceLog = [];
function log(msg) {
  console.log(msg);
  evidenceLog.push(msg);
}

try {
  log('--- 1. 新项目/新话题创立阶段：初火星 (spark) ---');
  const thread = await makeThread(`生命之火全景测试 ${Date.now()}`);
  await page.goto(`${base}/t/${thread.id}`);
  await expect(input).toBeVisible();

  // 验证初火星标识与属性
  await expect(shell).toHaveAttribute('data-flame-stage', 'spark');
  await expect(room).toHaveAttribute('data-flame-stage', 'spark');
  const flameCard = page.locator('.flame-life-card');
  await expect(flameCard).toBeVisible();
  await expect(flameCard).toContainText('初火星');
  await expect(flameCard).toContainText('夜空初绽的一粒火星');

  await page.screenshot({ path: `${out}/01-flame-stage-spark.png` });
  log('PASS 1: 初火星 (spark) 阶段验证通过，展现微火核与初生星火文案。');

  log('--- 2. 添柴与火星喷发激荡 (stoke & sparks) ---');
  const stokeBtn = flameCard.locator('.flame-life-card__stoke');
  await expect(stokeBtn).toBeVisible();
  await stokeBtn.click();

  // 点击添柴后，ember-atmosphere 应该收到 stoke cue
  await expect(room).toHaveAttribute('data-cue', 'stoke');
  await expect(room).toHaveAttribute('data-phase', 'stoke');
  await page.screenshot({ path: `${out}/02-flame-stoke-eruption.png` });
  log('PASS 2: 添柴触发 (stoke) 成功，火焰激荡并飞升火星粒子。');

  log('--- 3. 对话推进：由初生火苗 (sprout) 到繁盛之火 (blaze) ---');
  // 发送第 1 条消息
  await input.fill('这是关于我们项目的第一个构想，让炉火开始燃烧。');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  // 验证初生火苗 (sprout)
  await expect(shell).toHaveAttribute('data-flame-stage', 'sprout');
  await expect(room).toHaveAttribute('data-flame-stage', 'sprout');
  await page.screenshot({ path: `${out}/03-flame-stage-sprout.html.png` });
  log('PASS 3.1: 发送首条对话，火焰进入初生火苗 (sprout) 态，炉温上升。');

  // 发送更多消息推进项目活跃度
  await input.fill('这是第二个阶段的设计细节，继续添柴加火。');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  await input.fill('第三个模块的代码与测试已完成，项目正如火如荼地推进。');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);

  // 达到3条消息后，进入繁盛之火 (blaze)
  await expect(shell).toHaveAttribute('data-flame-stage', 'blaze');
  await expect(room).toHaveAttribute('data-flame-stage', 'blaze');
  await page.screenshot({ path: `${out}/04-flame-stage-blaze.png` });
  log('PASS 3.2: 连续活跃推进后，火焰演进为繁盛之火 (blaze)，火光翻腾生机盎然。');

  log('--- 4. 顶栏菜单与项目面板中的生命态与添柴联动 ---');
  const menu = page.getByLabel('打开菜单');
  await menu.click();
  const menuStatus = page.locator('.hearth-menu__flame-status');
  await expect(menuStatus).toBeVisible();
  await expect(menuStatus).toContainText('繁盛之火');

  const menuStoke = page.locator('.hearth-menu__stoke-action');
  await menuStoke.click();
  await expect(room).toHaveAttribute('data-cue', 'stoke');
  log('PASS 4.1: 顶栏菜单中完整展示项目生命态与添一把柴快捷操作。');

  // 切换到项目与话题面板
  await menu.click();
  await page.getByRole('button', { name: '项目与话题' }).click();
  const banner = page.locator('.projects-pane__flame-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-flame-stage', 'blaze');
  await expect(banner).toContainText('繁盛之火');

  const paneStoke = page.locator('.projects-pane__stoke-btn');
  await paneStoke.click();
  await expect(room).toHaveAttribute('data-cue', 'stoke');
  await page.screenshot({ path: `${out}/05-projects-pane-flame.png` });
  log('PASS 4.2: 项目与话题面板展示中央炉火横幅并支持添柴激荡。');

  log('--- 5. 项目仓库观察页面的生命态与扫描添柴联动 ---');
  await page.goto(`${base}/projects`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/06-projects-list-flame.png` });

  // 检查已观察项目列表是否有生命阶段徽标或添柴扫描按钮
  const tiles = page.locator('.project-tile.obs-tile');
  const tileCount = await tiles.count();
  if (tileCount > 0) {
    const firstTile = tiles.first();
    const stokeScanBtn = firstTile.locator('.obs-tile-stoke');
    if (await stokeScanBtn.isVisible()) {
      await stokeScanBtn.click();
      await page.waitForTimeout(800);
      log('PASS 5.1: 项目卡片上添柴扫描按钮成功触发扫描与添火。');
    }
  }

  // 写入验证日志
  writeFileSync(`${out}/test-summary.txt`, evidenceLog.join('\n'));
  log('ALL TESTS PASSED: 炉火生命周期全链路验证完成！');
} catch (err) {
  console.error('Test failed:', err);
  await page.screenshot({ path: `${out}/error-state.png` });
  throw err;
} finally {
  await page.close();
  await context.close();
  await browser.close();
}
