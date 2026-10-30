import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

// Test only the isolated design prototype, with synthetic projects and a fresh browser.
const base = process.env.CONTINUATION_URL ?? 'http://127.0.0.1:4341';
const dir = path.resolve(process.env.CONTINUATION_EVIDENCE ?? 'handoff/EVIDENCE/conversation-home-2026-10-30');
const round = process.env.CONTINUATION_ROUND ?? 'round1';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();
const errors = [], externalRequests = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).origin !== base) externalRequests.push(request.url()); });
async function settled() { await page.waitForFunction(() => document.querySelector('#app-main')?.dataset.renderHash === location.hash); }
async function check(name, operation) { await settled(); await operation(); checks.push(name); }
async function route(hash) { await page.goto(`${base}/#${hash}`); await page.waitForSelector('#app-main h1'); await settled(); }
async function shot(name) { await settled(); await page.locator('#toast').waitFor({state:'hidden'}); await page.evaluate(() => document.fonts.ready); await page.screenshot({path:path.join(dir, `${round}-${name}.png`), fullPage:true, animations:'disabled'}); }
async function scope(value) { await page.getByLabel('讨论范围', {exact:true}).selectOption(value); await page.waitForFunction(value => document.querySelector('#conversation-scope')?.value === value, value); await settled(); }
async function send(text) { await page.locator('#conversation-input').fill(text); await page.locator('#conversation-input').press('Enter'); }
async function composerFits() {
  const header = await page.locator('.topbar').boundingBox();
  assert.ok(header.y >= 0 && header.y + header.height <= page.viewportSize().height, 'auxiliary header remains visible');
  const input = await page.locator('#conversation-input').boundingBox();
  const send = await page.getByRole('button',{name:'发送示例消息'}).boundingBox();
  const viewport = page.viewportSize();
  assert.ok(input.y >= 0 && send.y + send.height <= viewport.height, `composer bottom ${send.y + send.height} exceeds ${viewport.height}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
try {
  await route('discover');
  await check('home opens directly into a usable conversation with one project finding', async () => {
    assert.match(await page.locator('.chat-transcript').innerText(), /片段/);
    assert.equal(await page.locator('#conversation-input').isVisible(), true);
    assert.equal(await page.locator('.project-paper,.feature-story,.sidebar,.action-suggestion').count(),0);
    assert.equal(await page.locator('.topbar-projects').count(),1);
    assert.match(await page.locator('.prototype-badge').innerText(), /交互原型.*示例资料/);
    await composerFits();
  });
  await shot('home-1440');
  await page.setViewportSize({width:390,height:844});
  await check('390 home composer is ready inside the first viewport', composerFits);
  await shot('home-390');
  await page.setViewportSize({width:1280,height:800});
  await check('1280 desktop composer and send are inside first viewport', composerFits);
  await shot('home-1280');
  await page.getByRole('button',{name:'查看依据',exact:true}).click();
  await check('evidence remains available and distinguishes unconnected sources',async()=>assert.match(await page.locator('dialog').innerText(), /尚未连接外部来源/));
  await page.keyboard.press('Escape');
  await check('Escape closes evidence and restores the trigger focus',async()=>{
    assert.equal(await page.locator('dialog').isVisible(),false);
    assert.equal(await page.getByRole('button',{name:'查看依据',exact:true}).evaluate(el=>el===document.activeElement),true);
  });
  await page.getByRole('button',{name:'有哪些项目值得继续？',exact:true}).click();
  await check('suggestion prepares a message without sending it',async()=>{
    assert.equal(await page.locator('#conversation-input').inputValue(),'有哪些项目值得继续？');
    assert.equal(await page.locator('.chat-message.is-user').count(),0);
  });
  await page.locator('#conversation-input').press('Enter');
  await check('home accepts and answers directly without entering another page',async()=>{
    assert.equal(new URL(page.url()).hash,'#discover');
    assert.equal(await page.locator('.chat-message.is-user').count(),1);
    assert.match(await page.locator('.chat-message').last().innerText(),/片段.*旧途.*潮汐/s);
  });
  await page.locator('#conversation-input').fill('全局保留的草稿');
  await page.getByRole('button',{name:'聊聊「片段」',exact:true}).click();
  await check('finding continues in its own project conversation',async()=>{
    assert.equal(await page.locator('#conversation-scope').inputValue(),'fragments');
    assert.equal(await page.locator('#conversation-input').inputValue(),'');
    assert.equal(await page.locator('#app-main h1').innerText(),'片段');
  });
  await send('这个项目当时的思路是什么？');
  await page.locator('#conversation-input').fill('片段的独立草稿');
  await scope('all');
  await check('global draft and history remain separate from the project',async()=>{
    assert.equal(await page.locator('#conversation-input').inputValue(),'全局保留的草稿');
    assert.equal(await page.locator('.chat-message.is-user').count(),1);
  });
  await scope('fragments'); await page.reload(); await settled();
  await check('project history and draft survive reload',async()=>{
    assert.equal(await page.locator('#conversation-input').inputValue(),'片段的独立草稿');
    assert.equal(await page.locator('.chat-message.is-user').count(),1);
  });
  await page.setViewportSize({width:1440,height:900}); await shot('project-conversation-1440');
  await page.getByRole('button',{name:'查看项目档案',exact:true}).click(); await settled();
  await page.getByRole('button',{name:'研究与线索',exact:true}).click(); await settled();
  await check('project materials are available on demand rather than filling home',async()=>assert.match(await page.locator('.dossier-section').innerText(),/尚未连接外部来源/));
  await route('discover');
  await page.getByRole('button',{name:'稍后再看',exact:true}).click();
  await check('deferral keeps the current draft and presents another finding',async()=>{
    assert.match(await page.locator('.chat-message').first().innerText(),/旧途/);
    assert.equal(await page.locator('#conversation-input').inputValue(),'全局保留的草稿');
  });
  await page.getByRole('button',{name:'稍后再看',exact:true}).click();
  await page.getByRole('button',{name:'稍后再看',exact:true}).click();
  await check('no-findings state still supports direct conversation',async()=>{
    assert.match(await page.locator('.chat-message').first().innerText(),/暂时没有待讨论/);
    await send('我想找回以前的想法');
    assert.equal(await page.locator('.chat-message.is-user').count(),2);
  });
  await page.getByRole('button',{name:'恢复示例线索',exact:true}).click();
  await check('all deferred findings can be restored',async()=>assert.match(await page.locator('.chat-message').first().innerText(),/片段/));
  await send('<img src=x onerror=alert(1)>');
  await check('typed markup remains text and cannot load or execute',async()=>{
    assert.equal(await page.locator('.chat-transcript img').count(),0);
    assert.match(await page.locator('.chat-message.is-user').last().innerText(),/<img src=x/);
  });
  for (let i=0;i<7;i++) await send(`第${i+1}个后续问题`);
  await check('long conversations scroll independently while composer stays available',async()=>{
    assert.ok(await page.locator('.chat-transcript').evaluate(el=>el.scrollHeight>el.clientHeight));
    await composerFits();
  });
  await shot('active-conversation-1440');
  await page.setViewportSize({width:390,height:844}); await page.emulateMedia({reducedMotion:'reduce'});
  await shot('active-conversation-390');
  await check('390 narrow long conversation keeps send inside viewport and no sideways scroll',composerFits);
  await shot('active-conversation-390');
  await scope('tide');
  await check('narrow scope switch uses a separate empty conversation',async()=>assert.equal(await page.locator('.chat-message.is-user').count(),0));
  await scope('all');
  await page.getByRole('button',{name:'项目库',exact:true}).click(); await settled();
  await check('project library remains accessible from navigation',async()=>assert.equal(await page.locator('.project-row').count(),3));
  await route('setup');
  await page.getByLabel('示例目录路径',{exact:true}).fill('/Projects/synthetic-ideas');
  await page.getByLabel('我了解这是模拟添加，不会扫描文件',{exact:true}).check();
  await page.getByRole('button',{name:/添加示例目录/}).click();
  await check('directory setup still creates only a demo record',async()=>assert.match(await page.locator('.demo-directories').innerText(),/synthetic-ideas/));
  await route('settings');
  await page.getByRole('button',{name:'切换为忙碌演示',exact:true}).click();
  await check('busy state is clearly a simulation',async()=>assert.match(await page.locator('.setting-row').first().innerText(),/忙碌演示/));
  await page.getByRole('button',{name:'切换为深色',exact:true}).click();
  await route('conversation/tide');
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#toast').waitFor({state:'hidden'});
  await shot('dark-1440');
  await page.setViewportSize({width:390,height:844});
  await shot('dark-390');
  await check('prototype has no page errors or external requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);});
  await writeFile(path.join(dir,`${round}-checks.json`),JSON.stringify({status:'PASS',checks,errors,externalRequests,prototypeOnly:true},null,2));
  console.log(`PASS: ${checks.length} interaction and layout checks; prototype only.`);
} finally { await browser.close(); }
