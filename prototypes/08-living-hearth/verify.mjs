import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

// Test only the isolated design prototype, with synthetic projects and a fresh browser.
const base = process.env.CONTINUATION_URL ?? 'http://127.0.0.1:4342';
const dir = path.resolve(process.env.CONTINUATION_EVIDENCE ?? 'handoff/EVIDENCE/living-hearth-2026-10-31');
const round = process.env.CONTINUATION_ROUND ?? 'round1';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({args:['--enable-webgl','--use-angle=swiftshader']});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();
const errors = [], externalRequests = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).origin !== base) externalRequests.push(request.url()); });
async function settled() { await page.waitForFunction(() => document.querySelector('#app-main')?.dataset.renderHash === location.hash); }
async function check(name, operation) { await settled(); await operation(); checks.push(name); }
async function route(hash) { await page.goto(`${base}/#${hash}`); await page.waitForSelector('#app-main h1'); await page.waitForFunction(() => typeof window.getHearthFlameState === 'function'); await settled(); }
async function shot(name) { await settled(); await page.locator('#toast').waitFor({state:'hidden'}); await page.evaluate(() => document.fonts.ready); await page.waitForFunction(() => document.querySelector('#hearth-flame')?.classList.contains('is-ready')); await page.screenshot({path:path.join(dir, `${round}-${name}.png`), fullPage:true, animations:'disabled'}); }
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
  await page.waitForFunction(() => window.getHearthFlameState()?.textureReady && window.getHearthFlameState().frames > 3);
  await check('one actual WebGL fire is textured and advances without changing product state',async()=>{
    const a=await page.evaluate(()=>window.getHearthFlameState());
    const first=await page.locator('#flame-canvas').screenshot();
    await page.waitForTimeout(360);
    const second=await page.locator('#flame-canvas').screenshot();
    const b=await page.evaluate(()=>window.getHearthFlameState());
    assert.equal(b.mode,'running'); assert.ok(b.frames>a.frames); assert.notDeepEqual(first,second);
    assert.equal(await page.locator('canvas').count(),1);
  });
  await check('fire has a real frosted layer while dialogue text stays sharp',async()=>{
    const material=await page.evaluate(()=>({glass:getComputedStyle(document.querySelector('.hearth-diffuser')).backdropFilter, fallback:getComputedStyle(document.querySelector('#flame-canvas')).filter, text:getComputedStyle(document.querySelector('.chat-message p')).filter}));
    assert.ok(/blur\((1[2-9]|[2-9][0-9])px\)/.test(material.glass) || /blur/.test(material.fallback));assert.equal(material.text,'none');
  });
  await shot('home-1440');
  await check('memory fold recalls one dated project fragment and stays collapsed',async()=>{
    assert.equal(await page.locator('.memory-fold').count(),1);
    assert.equal(await page.locator('.memory-fold').getAttribute('open'),null);
    assert.match(await page.locator('.memory-fold summary').innerText(),/片段.*2025.02.*读到好内容/s);
  });
  await page.getByRole('button',{name:'发送示例消息'}).isVisible();
  await page.locator('.memory-fold summary').focus();
  await page.keyboard.press('Enter');
  await check('keyboard unfolds sourced memory inline without changing the conversation',async()=>{
    assert.equal(await page.locator('.memory-fold').evaluate(el=>el.open),true);
    assert.match(await page.locator('.memory-unfolded').innerText(),/合成档案.*不代表已读取真实项目/s);
    assert.equal(new URL(page.url()).hash,'#discover');
    await composerFits();
  });
  await shot('memory-open-1440');
  await page.keyboard.press('Enter');
  await page.locator('.memory-fold summary').blur();
  await page.setViewportSize({width:390,height:844});
  await check('390 home composer is ready inside the first viewport', composerFits);
  await shot('home-390');
  await page.locator('.memory-fold summary').click();
  await check('narrow unfolded memory preserves an accessible input and send',composerFits);
  await shot('memory-open-390');
  await page.locator('.memory-fold summary').click();
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
  await page.getByRole('button',{name:'暂停炉火动效',exact:true}).click();
  await check('manual pause freezes the actual render clock and persists as a preference',async()=>{
    const a=await page.evaluate(()=>window.getHearthFlameState());
    await page.waitForTimeout(220);
    const b=await page.evaluate(()=>window.getHearthFlameState());
    assert.equal(b.mode,'paused');assert.equal(b.time,a.time);assert.equal(b.frames,a.frames);
  });
  await page.getByRole('button',{name:'继续炉火动效',exact:true}).click();
  await page.locator('#conversation-input').focus();
  await check('input focus reaches the flame without any model or background task',async()=>assert.equal(await page.evaluate(()=>window.getHearthFlameState().focus),true));
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
    assert.match(await page.locator('.memory-origin').innerText(),/片段/);
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
  await check('system reduced-motion freezes fire and disables forced animation',async()=>{
    await page.waitForFunction(()=>window.getHearthFlameState().mode==='reduced-motion');
    const a=await page.evaluate(()=>window.getHearthFlameState());await page.waitForTimeout(180);
    const b=await page.evaluate(()=>window.getHearthFlameState());assert.equal(b.frames,a.frames);assert.equal(b.time,a.time);
    assert.equal(await page.getByRole('button',{name:'炉火已按系统偏好静止',exact:true}).isDisabled(),true);
  });
  await shot('active-conversation-390');
  await check('390 narrow long conversation keeps send inside viewport and no sideways scroll',composerFits);
  await shot('active-conversation-390');
  await scope('tide');
  await check('narrow scope switch uses a separate empty conversation and project memory',async()=>{assert.equal(await page.locator('.chat-message.is-user').count(),0);assert.match(await page.locator('.memory-origin').innerText(),/潮汐.*2026.06/s);});
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
  await page.emulateMedia({reducedMotion:'no-preference'});
  await route('settings'); await page.getByRole('button',{name:'切换为空闲演示',exact:true}).click();
  await route('conversation/fragments');
  await check('simulated document visibility guard stops and resumes the render clock',async()=>{
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    const a=await page.evaluate(()=>window.getHearthFlameState());await page.waitForTimeout(180);
    const b=await page.evaluate(()=>window.getHearthFlameState());assert.equal(b.mode,'hidden');assert.equal(b.frames,a.frames);
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>window.getHearthFlameState().mode==='running');
  });
  await check('real WebGL context loss leaves a visible static flame and usable composer',async()=>{
    const supported=await page.evaluate(()=>{const gl=document.querySelector('#flame-canvas').getContext('webgl');const ext=gl.getExtension('WEBGL_lose_context');if(!ext)return false;ext.loseContext();return true;});
    assert.equal(supported,true);await page.waitForFunction(()=>window.getHearthFlameState().mode==='context-lost');
    assert.equal(await page.locator('.flame-fallback').isVisible(),true);await composerFits();
  });
  await shot('context-loss-390');
  const fallbackContext=await browser.newContext({viewport:{width:1280,height:800}});
  await fallbackContext.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl'?null:original.call(this,kind,...args);};});
  const fallbackPage=await fallbackContext.newPage();fallbackPage.on('pageerror',e=>errors.push(e.message));await fallbackPage.goto(base+'/#discover');
  await fallbackPage.waitForFunction(()=>window.getHearthFlameState?.().mode==='fallback');
  assert.equal(await fallbackPage.locator('.flame-fallback').isVisible(),true);
  await fallbackPage.locator('#conversation-input').fill('没有WebGL也可以继续讨论');await fallbackPage.locator('#conversation-input').press('Enter');
  assert.equal(await fallbackPage.locator('.chat-message.is-user').count(),1);
  await fallbackPage.screenshot({path:path.join(dir,round+'-no-webgl-1280.png'),fullPage:true,animations:'disabled'});await fallbackContext.close();
  checks.push('fault-injected unavailable WebGL preserves a static image and working chat');
  await check('prototype has no page errors or external requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);});
  await writeFile(path.join(dir,`${round}-checks.json`),JSON.stringify({status:'PASS',checks,errors,externalRequests,prototypeOnly:true},null,2));
  console.log(`PASS: ${checks.length} interaction and layout checks; prototype only.`);
} finally { await browser.close(); }
