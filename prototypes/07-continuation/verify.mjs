import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

// Isolated browser tests for the design prototype; no app DB or real project input.
const base = process.env.CONTINUATION_URL ?? 'http://127.0.0.1:4341';
const dir = path.resolve('handoff/EVIDENCE/continuation-design-2026-10-30');
const round = process.env.CONTINUATION_ROUND ?? 'round1';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage();
const errors = [];
const externalRequests = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).origin !== base) externalRequests.push(request.url()); });
async function check(name, operation) { await page.waitForFunction(() => document.querySelector('#app-main')?.dataset.renderHash === location.hash); await operation(); checks.push(name); }
async function shot(name) {
  await page.waitForFunction(() => document.querySelector('#app-main')?.dataset.renderHash === location.hash);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(dir, `${round}-${name}.png`), fullPage: true, animations: 'disabled' });
}
async function route(hash) { await page.goto(`${base}/#${hash}`); await page.waitForSelector('#app-main h1'); }
try {
  await route('discover');
  await check('all prototype claims visibly disclosed', async () => assert.match(await page.locator('.prototype-badge').innerText(), /交互原型.*示例资料/));
  await shot('discover-1440');
  await page.setViewportSize({ width: 1280, height: 800 });
  await shot('discover-1280');
  await check('desktop has no horizontal overflow', async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false));
  const primaryRect = await page.getByRole('button', { name: '接着聊这个项目', exact: true }).boundingBox();
  checks.push(`primary action bottom at 1280x800: ${Math.round(primaryRect.y + primaryRect.height)}px`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: /看看这条判断的依据/ }).click();
  await check('evidence distinguishes fixture and missing external research', async () => {
    assert.equal(await page.locator('dialog').isVisible(), true);
    assert.match(await page.locator('dialog').innerText(), /尚未连接外部来源/);
  });
  await shot('evidence-1440');
  await page.keyboard.press('Escape');
  await check('Escape closes evidence and restores focus', async () => {
    assert.equal(await page.locator('dialog').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: /看看这条判断的依据/ }).evaluate(el => el === document.activeElement), true);
  });
  await page.getByRole('button', { name: '接着聊这个项目', exact: true }).click();
  await check('discovery opens scoped conversation', async () => {
    await page.waitForURL('**/#conversation/fragments');
    assert.match(await page.locator('.composer-label').innerText(), /片段/);
  });
  await shot('conversation-1440');
  await page.locator('#conversation-input').fill('这个项目当时的思路是什么？');
  await page.locator('#conversation-input').press('Enter');
  await check('local conversation has labelled example response', async () => {
    assert.equal(await page.locator('.chat-message.is-user').count(), 1);
    assert.match(await page.locator('.chat-message').last().innerText(), /示例答复/);
  });
  await page.locator('#conversation-input').fill('只属于片段的草稿');
  await page.getByRole('button', { name: '回到全部项目', exact: false }).click();
  await page.waitForURL('**/#conversation');
  await page.waitForFunction(() => document.querySelector('.composer-label')?.textContent.includes('全部项目'));
  await check('global conversation does not inherit project draft', async () => assert.equal(await page.locator('#conversation-input').inputValue(), ''));
  await page.getByRole('button', { name: /有哪些想法，值得重新拾起/ }).click();
  await page.getByRole('button', { name: '发送示例消息', exact: true }).click();
  await check('global conversation covers fixture projects', async () => assert.match(await page.locator('.chat-message').last().innerText(), /片段.*旧途.*潮汐/s));
  await shot('global-conversation-1440');
  await route('conversation/fragments');
  await check('project draft and messages survive reload', async () => {
    assert.equal(await page.locator('#conversation-input').inputValue(), '只属于片段的草稿');
    assert.equal(await page.locator('.chat-message.is-user').count(), 1);
  });
  await route('projects');
  await check('project index has three synthetic records', async () => assert.equal(await page.locator('.project-row').count(), 3));
  await shot('projects-1440');
  await page.locator('.project-row[data-project="fragments"]').click();
  await page.waitForURL('**/#project/fragments/overview');
  await shot('dossier-1440');
  await page.getByRole('button', { name: '研究与线索', exact: true }).click();
  await check('research tab does not invent real citations', async () => { await page.waitForURL('**/research'); assert.match(await page.locator('.dossier-section').innerText(), /尚未连接外部来源/); });
  await page.getByRole('button', { name: '你的选择', exact: true }).click();
  await page.getByRole('button', { name: '记下这个方向（演示）', exact: true }).click();
  await page.reload();
  await check('chosen direction persists as prototype-only record', async () => assert.match(await page.locator('.dossier-section').innerText(), /已在本原型中记下.*不代表已执行/s));
  await route('discover');
  await page.getByRole('button', { name: '先放一放', exact: true }).click();
  await check('deferred finding leaves focus and can be restored', async () => {
    assert.match(await page.locator('.feature-story h2').innerText(), /旧途/);
    await page.getByRole('button', { name: '恢复这些线索', exact: true }).click();
    assert.match(await page.locator('.feature-story h2').innerText(), /片段/);
  });
  await route('setup');
  await shot('setup-1440');
  await page.getByLabel('示例目录路径', { exact: true }).fill('/Projects/synthetic-ideas');
  await page.getByLabel('我了解这是模拟添加，不会扫描文件', { exact: true }).check();
  await page.getByRole('button', { name: /添加示例目录/ }).click();
  await check('directory input creates only disclosed local demo state', async () => assert.match(await page.locator('.demo-directories').innerText(), /synthetic-ideas/));
  await route('settings');
  await page.getByRole('button', { name: '切换为忙碌演示', exact: true }).click();
  await check('busy mode explicitly says simulated', async () => assert.match(await page.locator('#busy-toggle').innerText(), /忙碌演示/));
  await shot('settings-1440');
  await page.getByRole('button', { name: '切换为深色', exact: true }).click();
  await route('discover');
  await shot('discover-dark-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await shot('discover-390-reduced');
  await check('narrow reduced-motion version keeps content without horizontal overflow', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.getByRole('button', { name: '接着聊这个项目', exact: true }).isVisible(), true);
  });
  await check('no page errors and no external requests', async () => { assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []); });
  await writeFile(path.join(dir, `${round}-checks.json`), JSON.stringify({ status: 'PASS', checks, errors, externalRequests, prototypeOnly: true }, null, 2));
  console.log(`PASS: ${checks.length} checks; 6 views; local-only fixtures; screenshot matrix saved.`);
} finally { await browser.close(); }
