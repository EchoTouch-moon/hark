import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.HEARTH_QA_URL ?? 'http://127.0.0.1:4403';
const out = 'handoff/EVIDENCE/conversation-hearth';
mkdirSync(out, {recursive:true});
const browser = await chromium.launch();
const context = await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}});
await context.addInitScript(() => localStorage.setItem('hearth.welcome.v1', JSON.stringify({version:1,completed:true,name:''})));
const page = await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
const menu=()=>page.getByLabel('打开菜单');
async function makeThread(title) {
  const {csrfToken} = await (await page.request.get(`${base}/api/v1/auth/session`)).json();
  const res=await page.request.post(`${base}/api/v1/threads`,{headers:{'x-csrf-token':csrfToken,origin:base},data:{title,projectId:null}});
  expect(res.status()).toBe(201);return (await res.json()).thread;
}
async function screenshot(name) { await page.waitForTimeout(1200); await page.screenshot({path:`${out}/${name}.png`,animations:'disabled'}); }
try {
  const stamp=String(Date.now());const titleA=`合成话题 A ${stamp}`, titleB=`合成话题 B ${stamp}`;
  const first=await makeThread(titleA); const second=await makeThread(titleB);
  await page.goto(`${base}/t/${first.id}`);
  const input=page.getByRole('textbox',{name:'输入消息',exact:true});await expect(input).toBeVisible();
  const shell=page.locator('.canvas-shell'), room=page.locator('.ember-atmosphere');
  await expect(room).toHaveAttribute('data-heat','0.12');
  await expect(page.locator('.ember-presence, .ember-mark')).toHaveCount(0);
  await expect(page.getByRole('tablist',{name:'主视图'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'今天，想聊些什么？'})).toBeVisible();
  const current=page.locator('.ember-atmosphere__current').first(); const before=await current.getAttribute('d');await page.waitForTimeout(350);expect(await current.getAttribute('d')).not.toBe(before);
  await screenshot('01-empty');
  const initialLight=Number(await room.evaluate(node=>getComputedStyle(node).getPropertyValue('--hearth-intensity')));
  await page.getByRole('button',{name:'介绍我的项目'}).click();
  await expect(input).toHaveValue('我想介绍一下我的项目：');await expect(input).toBeFocused();
  await expect(room).toHaveAttribute('data-heat','0.12');
  console.log('PASS conversation-first empty surface, no standalone icon or tab bar, animated central light');
  await input.fill('合成消息 1');
  await page.route('**/api/v1/chat',r=>r.fulfill({status:500,json:{message:'Synthetic failure'}}));
  await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
  await expect(input).toHaveValue('合成消息 1');await expect(room).toHaveAttribute('data-heat','0.12');
  await page.unroute('**/api/v1/chat');
  for(const [index,heat] of [[1,'0.42'],[2,'0.53'],[3,'0.64'],[4,'0.75'],[5,'0.75']]){
    if(index>1)await input.fill(`合成消息 ${index}`);
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(room).toHaveAttribute('data-heat',heat,{timeout:10000});
    await expect(input).toHaveValue('');
    if(index===1)await screenshot('02-one-message');
    if(index===4) {
      await screenshot('03-four-messages');
      const grownLight=Number(await room.evaluate(node=>getComputedStyle(node).getPropertyValue('--hearth-intensity')));
      expect(grownLight).toBeGreaterThan(initialLight);
    }
  }
  console.log('PASS failures preserve draft; 1/2/3/4 messages warm gradually; fifth is capped');
  await menu().click();await page.keyboard.press('Escape');
  await expect(page.locator('.hearth-menu')).not.toHaveAttribute('open','');await expect(menu()).toBeFocused();
  await menu().click();await page.getByRole('button',{name:'历史对话'}).click();await expect(page.getByRole('complementary',{name:'线程'})).toBeVisible();
  await page.getByRole('searchbox',{name:'搜索对话'}).fill(titleB);
  await page.getByRole('button',{name:new RegExp(titleB)}).click();await expect(room).toHaveAttribute('data-heat','0.12');
  await expect(shell).toHaveClass(/rail-collapsed/);
  await menu().click();await page.getByRole('button',{name:'历史对话'}).click();await page.getByRole('searchbox',{name:'搜索对话'}).fill(titleA);await page.getByRole('button',{name:new RegExp(titleA)}).click();
  await expect(room).toHaveAttribute('data-heat','0.75');await page.reload();await expect(room).toHaveAttribute('data-heat','0.75');
  console.log('PASS history is on demand and warmth is scoped to each thread and survives reload');
  await menu().click();await page.getByRole('button',{name:'暂停动效'}).click();await expect(room).toHaveAttribute('data-still','true');
  await page.waitForTimeout(100);const paused=await current.getAttribute('d');await page.waitForTimeout(300);expect(await current.getAttribute('d')).toBe(paused);
  await menu().click();await page.getByRole('button',{name:'开启动效'}).click();await expect(room).toHaveAttribute('data-still','false');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(room).toHaveAttribute('data-still','true');await page.waitForTimeout(60);const hiddenPath=await current.getAttribute('d');await page.waitForTimeout(250);expect(await current.getAttribute('d')).toBe(hiddenPath);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await expect(room).toHaveAttribute('data-still','false');
  console.log('PASS simulated background visibility pauses and resumes motion');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(room).toHaveAttribute('data-still','true');
  await page.setViewportSize({width:1280,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await screenshot('04-desktop-reduced');
  console.log('PASS pause/resume, reduced motion and 1280 desktop layout');
  await menu().click();await page.getByRole('button',{name:'重看欢迎'}).click();const welcome=page.getByTestId('hearth-welcome');await expect(welcome).toBeVisible();await expect(welcome.locator('.ember-presence')).toHaveCount(0);
  await screenshot('05-welcome');await welcome.getByRole('button',{name:'跳过欢迎'}).click();await expect(welcome).toHaveCount(0);await expect(input).toBeFocused();
  console.log('PASS welcome uses the same light field, can replay and skip without an icon');
  await menu().click();await page.getByRole('button',{name:'项目与话题'}).click();
  await menu().click();await page.getByRole('button',{name:'重看欢迎'}).click();await expect(welcome).toBeVisible();
  await welcome.getByRole('button',{name:'跳过欢迎'}).click();await expect(welcome).toHaveCount(0);await expect(input).toBeVisible();
  await menu().click();await page.getByRole('button',{name:'项目与话题'}).click();await page.getByRole('link',{name:/管理本地项目与观察范围/}).click();await expect(page).toHaveURL(/\/projects/);
  await page.getByRole('link',{name:'← 对话'}).click();await expect(input).toBeVisible();await expect(room).toHaveAttribute('data-heat','0.75');
  console.log('PASS project management and welcome replay are reachable on demand and return to the conversation');
  const fresh=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});const firstVisit=await fresh.newPage();
  await firstVisit.goto(base);const firstWelcome=firstVisit.getByTestId('hearth-welcome');await expect(firstWelcome).toHaveAttribute('data-step','arrival');
  await firstWelcome.getByRole('button',{name:'开始认识 Hearth'}).click();await firstWelcome.getByLabel('希望我怎么称呼你').fill('同行者');
  await firstWelcome.getByRole('button',{name:'返回',exact:true}).click();await firstWelcome.getByRole('button',{name:'开始认识 Hearth'}).click();await expect(firstWelcome.getByLabel('希望我怎么称呼你')).toHaveValue('同行者');
  await firstWelcome.getByRole('button',{name:'进入炉边',exact:true}).click();await expect(firstWelcome).toHaveCount(0);await firstVisit.reload();await expect(firstWelcome).toHaveCount(0);
  await fresh.close();console.log('PASS fresh welcome, retained nickname and saved local preference');
  const uncertain=await makeThread(`合成回读 ${stamp}`);await page.goto(`${base}/t/${uncertain.id}`);await expect(input).toBeVisible();await expect(room).toHaveAttribute('data-heat','0.12');
  await page.route('**/api/v1/chat/history?*',r=>r.fulfill({status:503,json:{error:{message:'Synthetic unavailable'}}}));
  await input.fill('合成回读不可用');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('暂时无法确认是否保存');await expect(input).toHaveValue('合成回读不可用');await expect(room).toHaveAttribute('data-heat','0.12');
  await page.unroute('**/api/v1/chat/history?*');await page.reload();await expect(room).toHaveAttribute('data-heat','0.42');
  console.log('PASS accepted message with unavailable readback does not falsely warm; reload recovers saved message');
  const stale=await makeThread(`合成本地叠加 ${stamp}`);const legacy=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
  await legacy.addInitScript((threadId)=>{
    localStorage.setItem('hearth.welcome.v1',JSON.stringify({version:1,completed:true,name:''}));
    localStorage.setItem('hearth.chat.localMsgs.v2',JSON.stringify({[threadId]:[{id:'old-local-user',role:'user',content:'旧本地叠加',createdAt:new Date().toISOString(),adapter:'mock',threadId}]}));
  },stale.id);
  await legacy.route('**/api/v1/threads',r=>r.fulfill({status:404,json:{error:'Synthetic unavailable'}}));
  const legacyPage=await legacy.newPage();await legacyPage.goto(`${base}/t/${stale.id}`);await expect(legacyPage.getByText('旧本地叠加')).toBeVisible();
  await expect(legacyPage.locator('.ember-atmosphere')).toHaveAttribute('data-heat','0.12');await legacy.close();
  console.log('PASS unconfirmed legacy local overlay never warms the conversation');
  if(errors.length)throw Error(errors.join('\n'));
} finally {await context.close();await browser.close();}
