import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.env.HEARTH_QA_URL ?? 'http://127.0.0.1:4404';
const out = process.env.HEARTH_QA_EVIDENCE_DIR ?? 'handoff/EVIDENCE/day-night-hearth';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Shanghai', recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
await context.addInitScript(() => {
  localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' }));
  const NativeDate = Date;
  let offset = NativeDate.parse('2026-10-30T10:00:00+08:00') - NativeDate.now();
  window.__setHearthTestTime = time => { offset = NativeDate.parse(time) - NativeDate.now(); };
  window.Date = class extends NativeDate {
    constructor(...args) { if (args.length) super(...args); else super(NativeDate.now() + offset); }
    static now() { return NativeDate.now() + offset; }
  };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const input = page.getByRole('textbox', { name: '输入消息', exact: true });
const room = page.locator('.ember-atmosphere');
const shell = page.locator('.canvas-shell');
const menu = () => page.getByLabel('打开菜单');
async function makeThread(title) {
  const { csrfToken } = await (await page.request.get(`${base}/api/v1/auth/session`)).json();
  const response = await page.request.post(`${base}/api/v1/threads`, { headers: { 'x-csrf-token': csrfToken, origin: base }, data: { title, projectId: null } });
  expect(response.status()).toBe(201);
  return (await response.json()).thread;
}
async function shot(name) { await page.screenshot({ path: `${out}/${name}.png` }); }
async function showThread(title) {
  await menu().click(); await page.getByRole('button', { name: '历史对话' }).click();
  await page.getByRole('searchbox', { name: '搜索对话' }).fill(title);
  await page.getByRole('button', { name: new RegExp(title) }).click();
}
try {
  const stamp = String(Date.now());
  const titleA = `昼夜合成话题 A ${stamp}`;
  const titleB = `昼夜合成话题 B ${stamp}`;
  const first = await makeThread(titleA);
  await makeThread(titleB);
  await page.goto(`${base}/t/${first.id}`);
  await expect(input).toBeVisible();
  await expect(shell).toHaveAttribute('data-hearth-period', 'day');
  await expect(page.getByRole('heading', { name: '今天，想聊些什么？' })).toBeVisible();
  await expect(room).toHaveAttribute('data-heat', '0.12');
  const oldFrame = await room.getAttribute('data-frame');
  await page.waitForTimeout(450);
  expect(await room.getAttribute('data-frame')).not.toBe(oldFrame);
  await shot('01-day-empty');
  await menu().click(); await page.getByRole('button', { name: '重看欢迎' }).click();
  await expect(page.getByTestId('hearth-welcome')).toBeVisible();
  await page.waitForTimeout(1100); await shot('00-day-welcome');
  await page.getByTestId('hearth-welcome').getByRole('button', { name: '跳过欢迎' }).click();
  await expect(page.getByTestId('hearth-welcome')).toHaveCount(0);
  console.log('PASS daytime welcome and empty room, continuously rendered fire');

  await input.fill('一条用于检查等待的合成消息');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/v1/chat', async route => { await gate; await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('正在等待本机演示回复');
  await expect(room).toHaveAttribute('data-phase', 'waiting');
  await expect(room).toHaveAttribute('data-heat', '0.12');
  // An unrelated UI action failing must not end the chat request's wait.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hearth:ember-cue', { detail: { kind: 'failed' } })));
  await expect(room).toHaveAttribute('data-phase', 'waiting');
  await expect.poll(async () => Number(await room.getAttribute('data-response'))).toBeGreaterThan(.02);
  await shot('02-day-waiting');
  await page.evaluate(() => { window.__setHearthTestTime('2026-10-30T21:00:00+08:00'); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(room).toHaveAttribute('data-period', 'night');
  await expect(room).toHaveAttribute('data-phase', 'waiting');
  await expect.poll(async () => Number(await room.getAttribute('data-response'))).toBeGreaterThan(.02);
  await expect(room).toHaveAttribute('data-heat', '0.12');
  await page.evaluate(() => { window.__setHearthTestTime('2026-10-30T10:00:00+08:00'); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(room).toHaveAttribute('data-period', 'day');
  await expect(room).toHaveAttribute('data-phase', 'waiting');
  await menu().click(); await page.getByRole('button', { name: '暂停动效' }).click();
  await expect(room).toHaveAttribute('data-still', 'true');
  const waitingOpacity = await room.getAttribute('data-response');
  await page.waitForTimeout(300);
  expect(await room.getAttribute('data-response')).toBe(waitingOpacity);
  release();
  await expect(room).toHaveAttribute('data-heat', '0.42');
  await expect(page.getByRole('status')).toHaveCount(0);
  await menu().click(); await page.getByRole('button', { name: '开启动效' }).click();
  await expect(room).toHaveAttribute('data-still', 'false');
  await expect(room).toHaveAttribute('data-waiting-response', '0.000');
  await page.unroute('**/api/v1/chat');
  console.log('PASS real pending request, paused waiting, confirmed message and no stale waiting on resume');

  await page.route('**/api/v1/chat', route => route.fulfill({ status: 500, json: { message: 'Synthetic failure' } }));
  await input.fill('合成失败，保留的草稿');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('发送失败');
  await expect(input).toHaveValue('合成失败，保留的草稿');
  await expect(room).toHaveAttribute('data-heat', '0.42');
  await page.unroute('**/api/v1/chat');
  console.log('PASS failed request preserves its draft and does not warm the room');

  await input.fill('跨昼夜保留的合成草稿');
  await input.focus();
  await page.evaluate(() => { window.__setHearthTestTime('2026-10-30T21:00:00+08:00'); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(shell).toHaveAttribute('data-hearth-period', 'night');
  await expect(room).toHaveAttribute('data-period', 'night');
  await expect(input).toHaveValue('跨昼夜保留的合成草稿');
  await expect(input).toBeFocused();
  await expect(room).toHaveAttribute('data-heat', '0.42');
  await page.waitForTimeout(800); await shot('03-night-conversation');
  await menu().click(); await shot('04-night-menu');
  await page.getByRole('button', { name: '重看欢迎' }).click();
  const welcome = page.getByTestId('hearth-welcome');
  await expect(welcome).toBeVisible(); await page.waitForTimeout(1100); await shot('05-night-welcome');
  await welcome.getByRole('button', { name: '开始认识 Hearth' }).click();
  await welcome.getByLabel('希望我怎么称呼你').fill('同行者');
  await page.waitForTimeout(500); await shot('06-night-welcome-name');
  await welcome.getByLabel('希望我怎么称呼你').fill('');
  await welcome.getByRole('button', { name: '跳过欢迎' }).click(); await expect(welcome).toHaveCount(0);
  await expect(input).toHaveValue('跨昼夜保留的合成草稿');
  console.log('PASS day-to-night preserves conversation, draft, focus and warmth; night welcome is operable');

  await input.fill('切换期间保留的合成内容');
  let releaseSwitch;
  const switchGate = new Promise(resolve => { releaseSwitch = resolve; });
  await page.route('**/api/v1/chat', async route => { await switchGate; await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(room).toHaveAttribute('data-phase', 'waiting');
  await showThread(titleB);
  await expect(room).not.toHaveAttribute('data-phase', 'waiting');
  await expect(input).not.toHaveValue('切换期间保留的合成内容');
  await expect(room).toHaveAttribute('data-heat', '0.12');
  await expect(page.getByRole('heading', { name: '今晚，想聊些什么？' })).toBeVisible();
  await shot('07-night-empty');
  releaseSwitch(); await page.unroute('**/api/v1/chat');
  await showThread(titleA);
  await expect(input).toHaveValue('切换期间保留的合成内容');
  await expect(page.getByRole('alert')).toContainText('消息可能已经送达');
  console.log('PASS switching rooms ends pending feedback and restores interrupted draft with delivery uncertainty');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(room).toHaveAttribute('data-still', 'true');
  const reducedFrame = await room.getAttribute('data-frame');
  await page.waitForTimeout(350);
  expect(await room.getAttribute('data-frame')).toBe(reducedFrame);
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot('08-night-reduced-1280');
  await menu().click(); await page.getByRole('button', { name: '项目与话题' }).click();
  await page.getByRole('link', { name: /管理本地项目与观察范围/ }).click();
  await expect(page).toHaveURL(/\/projects/);
  await page.waitForTimeout(400); await shot('09-night-projects');
  await page.getByRole('link', { name: '← 对话' }).click();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('切换期间保留的合成内容');
  console.log('PASS reduced motion is still, 1280 desktop fits, project return preserves the draft');
  await menu().click(); await page.getByRole('link', { name: '设置' }).click();
  await expect(page).toHaveURL(/\/settings/);
  const source = page.locator('.set-source-label').first();
  await expect(source).toBeVisible();
  const style = await source.evaluate(node => ({ color: getComputedStyle(node).color, surface: getComputedStyle(node.closest('.card')).backgroundColor, room: getComputedStyle(node.closest('.canvas-shell')).backgroundColor }));
  const rgb = value => (value.match(/[\d.]+/g) ?? []).map(Number);
  const [fr,fg,fb] = rgb(style.color); const [br,bg,bb,alpha = 1] = rgb(style.surface); const [rr,rg,rb] = rgb(style.room);
  const luminance = channels => channels.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum,v,i) => sum + v * [.2126,.7152,.0722][i], 0);
  const background = [br*alpha+rr*(1-alpha), bg*alpha+rg*(1-alpha), bb*alpha+rb*(1-alpha)];
  const l1 = luminance([fr,fg,fb]); const l2 = luminance(background);
  expect((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)).toBeGreaterThanOrEqual(4.5);
  await shot('10-night-settings');
  console.log('PASS night settings labels contrast against their card (>= 4.5:1)');
  if (errors.length) throw Error(errors.join('\n'));
  console.log('PASS no browser page errors');
} finally {
  await context.close();
  await browser.close();
}
