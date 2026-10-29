import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.HEARTH_QA_URL ?? 'http://127.0.0.1:4404';
const out = 'handoff/EVIDENCE/living-fire';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Shanghai', recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
await context.addInitScript(() => {
  localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' }));
  const NativeDate = Date;
  let offset = NativeDate.parse('2026-10-30T10:00:00+08:00') - NativeDate.now();
  window.__setHearthTestTime = value => { offset = NativeDate.parse(value) - NativeDate.now(); };
  window.Date = class extends NativeDate {
    constructor(...args) { if (args.length) super(...args); else super(NativeDate.now() + offset); }
    static now() { return NativeDate.now() + offset; }
  };
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const video = page.video();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const input = page.getByRole('textbox', { name: '输入消息', exact: true });
const room = page.locator('.ember-atmosphere');
const shell = page.locator('.canvas-shell');
const menu = () => page.getByLabel('打开菜单');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fireClip = { x: 490, y: 145, width: 460, height: 150 };
async function capture(name) { await page.screenshot({ path: `${out}/${name}.png` }); }
async function makeThread(title) {
  const { csrfToken } = await (await page.request.get(`${base}/api/v1/auth/session`)).json();
  const response = await page.request.post(`${base}/api/v1/threads`, { headers: { 'x-csrf-token': csrfToken, origin: base }, data: { title, projectId: null } });
  expect(response.status()).toBe(201);
  return (await response.json()).thread;
}
try {
  const thread = await makeThread(`玻璃火影合成话题 ${Date.now()}`);
  await page.goto(`${base}/t/${thread.id}`);
  await expect(input).toBeVisible();
  await expect(room).toHaveAttribute('data-renderer', 'webgl');
  await expect(room).toHaveAttribute('data-texture', 'ready');
  await expect(shell).toHaveAttribute('data-hearth-period', 'day');
  await expect(shell).toHaveCSS('background-color', 'rgb(248, 245, 239)');
  await expect(room.locator('.ember-atmosphere__glass')).toHaveCSS('backdrop-filter', /blur\(38px\)/);
  await expect(room).toHaveAttribute('data-heat', '0.12');
  await page.waitForTimeout(1000); await capture('01-day-glass');
  const firstPixels = await page.screenshot({ clip: fireClip });
  await page.waitForTimeout(1100);
  const secondPixels = await page.screenshot({ clip: fireClip });
  writeFileSync(`${out}/fire-motion-a.png`, firstPixels);
  writeFileSync(`${out}/fire-motion-b.png`, secondPixels);
  expect(hash(secondPixels)).not.toBe(hash(firstPixels));
  console.log('PASS actual pixels behind frosted glass change over time on warm-white desktop');

  await menu().click(); await page.getByRole('button', { name: '暂停动效' }).click();
  await expect(room).toHaveAttribute('data-still', 'true');
  await page.waitForTimeout(200);
  const pausedFrame = await room.getAttribute('data-frame');
  const pausedPixels = await page.screenshot({ clip: fireClip });
  await page.waitForTimeout(700);
  expect(await room.getAttribute('data-frame')).toBe(pausedFrame);
  expect(hash(await page.screenshot({ clip: fireClip }))).toBe(hash(pausedPixels));
  await menu().click();
  const slider = page.getByRole('slider', { name: /火焰大小/ });
  await slider.focus(); await page.keyboard.press('Home');
  await expect(room).toHaveAttribute('data-size', '0.65');
  await expect(page.locator('.hearth-flame-control output')).toHaveText('65%');
  await expect(room).toHaveAttribute('data-heat', '0.12');
  await capture('02-size-small');
  const smallPixels = await page.screenshot({ clip: fireClip });
  await page.keyboard.press('End');
  await expect(room).toHaveAttribute('data-size', '1.40');
  await expect(page.locator('.hearth-flame-control output')).toHaveText('140%');
  await expect(room).toHaveAttribute('data-heat', '0.12');
  await capture('03-size-large');
  expect(hash(await page.screenshot({ clip: fireClip }))).not.toBe(hash(smallPixels));
  await page.keyboard.press('Escape');
  await page.reload(); await expect(input).toBeVisible();
  await expect(room).toHaveAttribute('data-size', '1.40');
  await menu().click(); await page.getByRole('slider', { name: /火焰大小/ }).focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft');
  await expect(room).toHaveAttribute('data-size', '1.00');
  await page.keyboard.press('Escape');
  console.log('PASS pause freezes actual pixels; keyboard size control changes the fire without changing heat and persists locally');

  await input.fill('昼夜切换保留的合成草稿'); await input.focus();
  await page.evaluate(() => { window.__setHearthTestTime('2026-10-30T21:00:00+08:00'); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(shell).toHaveAttribute('data-hearth-period', 'night');
  await expect(shell).toHaveCSS('background-color', 'rgb(0, 0, 0)', { timeout: 10000 });
  await expect(input).toHaveValue('昼夜切换保留的合成草稿'); await expect(input).toBeFocused();
  await page.waitForTimeout(1000); await capture('04-night-glass');
  await menu().click(); await page.getByRole('button', { name: '重看欢迎' }).click();
  const welcome = page.getByTestId('hearth-welcome'); await expect(welcome).toBeVisible();
  await page.waitForTimeout(900); await capture('05-night-welcome');
  await welcome.getByRole('button', { name: '跳过欢迎' }).click(); await expect(welcome).toHaveCount(0);
  await expect(input).toHaveValue('昼夜切换保留的合成草稿');
  console.log('PASS black night room and welcome use the same moving fire; day/night keeps draft and focus');

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/v1/chat', async route => { await gate; await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(room).toHaveAttribute('data-phase', 'waiting');
  await expect(page.getByRole('status')).toContainText('正在等待本机演示回复');
  await expect(room).toHaveAttribute('data-heat', '0.12');
  await expect.poll(async () => Number(await room.getAttribute('data-response')), { timeout: 10000 }).toBeGreaterThan(.02);
  await capture('06-night-waiting');
  release(); await expect(room).toHaveAttribute('data-heat', '0.42', { timeout: 15000 });
  await page.unroute('**/api/v1/chat');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.locator('.chat-msg--assistant').first()).toHaveCSS('opacity', '1');
  await capture('07-night-conversation');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(room).toHaveAttribute('data-still', 'true');
  await page.waitForTimeout(150); const reducedFrame = await room.getAttribute('data-frame');
  await page.waitForTimeout(450); expect(await room.getAttribute('data-frame')).toBe(reducedFrame);
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture('08-reduced-1280');
  console.log('PASS waiting is separate from confirmed warmth; reduced motion is still at 1280 desktop');

  const canLose = await page.evaluate(() => {
    const gl = document.querySelector('.ember-atmosphere__canvas')?.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    window.__hearthTestLostContext = extension;
    extension.loseContext();
    return true;
  });
  if (canLose) {
    await expect(room).toHaveAttribute('data-renderer', 'fallback');
    await page.evaluate(() => window.__hearthTestLostContext.restoreContext());
    await expect(room).toHaveAttribute('data-renderer', 'webgl');
    await expect(room).toHaveAttribute('data-texture', 'ready');
    console.log('PASS lost WebGL context falls back and restores its texture');
  } else console.log('SKIP WebGL context restoration: extension unavailable');

  const fallback = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await fallback.addInitScript(() => {
    localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' }));
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (kind === 'webgl') throw new Error('Synthetic unavailable graphics');
      return original.call(this, kind, ...args);
    };
  });
  const fallbackPage = await fallback.newPage(); await fallbackPage.goto(`${base}/t/${thread.id}`);
  await expect(fallbackPage.locator('.ember-atmosphere')).toHaveAttribute('data-renderer', 'fallback');
  await expect(fallbackPage.locator('.ember-atmosphere__fallback img')).toBeVisible();
  await expect(fallbackPage.getByRole('textbox', { name: '输入消息', exact: true })).toBeVisible();
  await fallbackPage.screenshot({ path: `${out}/09-no-webgl-fallback.png` });
  await fallback.close();
  console.log('PASS missing WebGL retains a readable, still fire behind glass');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS no browser page errors');
} finally {
  await context.close();
  if (video) { await video.saveAs(`${out}/fire-behind-glass.webm`); await video.delete(); }
  await browser.close();
}
