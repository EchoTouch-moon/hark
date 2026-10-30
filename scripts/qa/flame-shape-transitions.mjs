import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.env.HEARTH_QA_URL ?? 'http://127.0.0.1:4404';
const out = 'handoff/EVIDENCE/flame-shapes-refined';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
await context.addInitScript(() => {
  localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' }));
  localStorage.setItem('hearth.flame.size', '1');
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const video = page.video();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const room = page.locator('.ember-atmosphere');
const input = page.getByRole('textbox', { name: '输入消息', exact: true });
const menu = () => page.getByLabel('打开菜单');
try {
  const { csrfToken } = await (await page.request.get(`${base}/api/v1/auth/session`)).json();
  const response = await page.request.post(`${base}/api/v1/threads`, { headers: { 'x-csrf-token': csrfToken, origin: base }, data: { title: `火影过渡合成 ${Date.now()}`, projectId: null } });
  expect(response.status()).toBe(201);
  const thread = (await response.json()).thread;
  await page.goto(`${base}/t/${thread.id}`);
  await expect(input).toBeVisible();
  await expect(room).toHaveAttribute('data-renderer', 'webgl');
  await expect(room).toHaveAttribute('data-texture', 'ready');
  await expect(room).toHaveAttribute('data-flame-stage', 'spark');
  await expect(room).toHaveAttribute('data-shape-width', '0.260');
  await page.evaluate(() => {
    const node = document.querySelector('.ember-atmosphere');
    window.__flameWidthTrace = [];
    new MutationObserver(() => { window.__flameWidthTrace.push(Number(node.dataset.shapeWidth)); }).observe(node, { attributes: true, attributeFilter: ['data-shape-width'] });
  });
  await input.fill('合成交流一'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(room).toHaveAttribute('data-flame-stage', 'sprout');
  await expect(room).toHaveAttribute('data-shape-width', '0.540');
  const trace = await page.evaluate(() => window.__flameWidthTrace);
  expect(trace.some(value => value > 0.27 && value < 0.53)).toBe(true);
  console.log('PASS confirmed message transitions spark to sprout through intermediate GSAP frames');

  await menu().click(); const slider = page.getByRole('slider', { name: /火焰大小/ });
  await slider.focus(); await page.keyboard.press('End');
  await expect(room).toHaveAttribute('data-size', '1.40');
  await expect(room).toHaveAttribute('data-shape-width', '0.540');
  await page.keyboard.press('Escape');
  console.log('PASS user size adjustment preserves the stage proportions');

  await menu().click(); await page.getByRole('button', { name: '暂停动效' }).click();
  await expect(room).toHaveAttribute('data-still', 'true');
  for (const text of ['合成交流二', '合成交流三']) {
    await input.fill(text); await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(input).toHaveValue('');
  }
  await expect(room).toHaveAttribute('data-flame-stage', 'blaze');
  await expect(room).toHaveAttribute('data-shape-width', '1.000');
  await page.waitForTimeout(200); const stillFrame = await room.getAttribute('data-frame');
  await page.waitForTimeout(400); expect(await room.getAttribute('data-frame')).toBe(stillFrame);
  await menu().click(); await page.getByRole('button', { name: '开启动效' }).click();
  await expect(room).toHaveAttribute('data-still', 'false');
  await page.waitForTimeout(700); expect(await room.getAttribute('data-frame')).not.toBe(stillFrame);
  await expect(room).toHaveAttribute('data-shape-width', '1.000');
  console.log('PASS paused state updates to blaze without motion and resumes without losing its shape');
  expect(errors).toEqual([]); console.log('PASS no browser page errors');

  const fallbackResponse = await page.request.post(`${base}/api/v1/threads`, { headers: { 'x-csrf-token': csrfToken, origin: base }, data: { title: `火影降级合成 ${Date.now()}`, projectId: null } });
  expect(fallbackResponse.status()).toBe(201);
  const fallbackThread = (await fallbackResponse.json()).thread;
  const fallbackContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    await fallbackContext.addInitScript(() => {
      localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' }));
      localStorage.setItem('hearth.flame.size', '1');
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl' || type === 'experimental-webgl') return null;
        return original.call(this, type, ...args);
      };
    });
    const fallbackPage = await fallbackContext.newPage();
    await fallbackPage.goto(`${base}/t/${fallbackThread.id}`);
    const fallbackRoom = fallbackPage.locator('.ember-atmosphere');
    await expect(fallbackRoom).toHaveAttribute('data-renderer', 'fallback');
    await expect(fallbackRoom).toHaveAttribute('data-shape-width', '0.260');
    await expect(fallbackRoom.locator('.ember-atmosphere__fallback')).toHaveCSS('scale', '0.26 0.23');
    console.log('PASS reduced-motion fallback keeps the spark proportions without WebGL');
  } finally { await fallbackContext.close(); }
} finally {
  await context.close();
  if (video) { await video.saveAs(`${out}/stage-transition.webm`); await video.delete(); }
  await browser.close();
}
