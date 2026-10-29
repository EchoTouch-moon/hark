import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.HEARTH_QA_URL ?? 'http://127.0.0.1:4402';
const out = process.env.HEARTH_QA_OUT ?? 'handoff/EVIDENCE/ember-craft';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}});
const page = await context.newPage();
const errors=[];
page.on('pageerror', error => errors.push(error.message));
async function capture(name) {
  await page.waitForTimeout(1050); // Allow finite GSAP entrance choreography to reach its readable pose.
  await page.screenshot({path:`${out}/${name}.png`,animations:'disabled'});
}
async function noOverflow() {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function createThread() {
  const auth = await page.request.get(`${base}/api/v1/auth/session`);
  const {csrfToken} = await auth.json();
  const response = await page.request.post(`${base}/api/v1/threads`, {headers:{'x-csrf-token':csrfToken,origin:base}, data:{title:'Craft QA synthetic thread',projectId:null}});
  expect(response.status()).toBeLessThan(300);
  return (await response.json()).thread;
}
try {
  const thread = await createThread();
  await page.goto(`${base}/t/${thread.id}`);
  const welcome = page.getByTestId('hearth-welcome');
  await expect(welcome).toHaveAttribute('data-step','arrival');
  await capture('01-arrival'); await noOverflow();
  await welcome.getByRole('button',{name:'开始认识 Hearth'}).click();
  await expect(welcome).toHaveAttribute('data-step','introduce');
  await welcome.getByLabel('希望我怎么称呼你').fill('同行者');
  await capture('02-introduce');
  await welcome.getByRole('button',{name:'返回',exact:true}).click();
  await welcome.getByRole('button',{name:'开始认识 Hearth'}).click();
  await expect(welcome.getByLabel('希望我怎么称呼你')).toHaveValue('同行者');
  await welcome.getByRole('button',{name:'进入炉边',exact:true}).click();
  await expect(welcome).toHaveCount(0);
  const input = page.getByRole('textbox',{name:'输入消息',exact:true});
  await expect(input).toBeFocused();
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-flame-state','dim');
  await capture('03-entered');
  console.log('PASS arrival / introduction / back retains nickname / enter focuses input without heating');
  await page.reload(); await expect(input).toBeVisible(); await expect(welcome).toHaveCount(0);
  await page.getByRole('button',{name:'重看欢迎'}).click();
  await expect(welcome).toBeVisible(); await welcome.getByRole('button',{name:'跳过欢迎'}).click(); await expect(welcome).toHaveCount(0);
  console.log('PASS welcome persists locally, replay and skip work');
  await input.fill('合成验收：让这个想法慢慢成形');
  await page.route('**/api/v1/chat',route=>route.fulfill({status:500,json:{message:'Synthetic failure'}}));
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(input).toHaveValue('合成验收：让这个想法慢慢成形');
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-flame-state','dim');
  await capture('04-error');
  await page.unroute('**/api/v1/chat');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-flame-state','lively');
  await expect(input).toBeFocused();
  await capture('05-conversation');
  console.log('PASS failed send retains draft and dim state, confirmed send ignites and keeps focus');
  const mantle=page.locator('.composer .ember-presence__mantle');
  const movingBefore=await mantle.getAttribute('d');await page.waitForTimeout(220);
  expect(await mantle.getAttribute('d')).not.toBe(movingBefore);
  console.log('PASS actual GSAP path interpolation is running');
  await page.getByRole('button',{name:'暂停动效'}).click();
  await expect(page.locator('.canvas-page')).toHaveAttribute('data-motion-paused','true');
  await page.waitForTimeout(80);const pausedBefore=await mantle.getAttribute('d');await page.waitForTimeout(240);
  expect(await mantle.getAttribute('d')).toBe(pausedBefore);
  console.log('PASS paused GSAP path remains stable');
  await page.setViewportSize({width:1280,height:800}); await capture('06-desktop-1280'); await noOverflow();
  const rect=await input.boundingBox(); expect(rect.y+rect.height).toBeLessThan(800);
  console.log('PASS manual pause and 1280 desktop viewport');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'重看欢迎'}).click();
  await capture('07-reduced-motion');
  await welcome.getByRole('button',{name:'跳过欢迎'}).click();await expect(welcome).toHaveCount(0);
  console.log('PASS reduced motion welcome remains operable');
  const privateContext = await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
  await privateContext.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key,value) {
      if(key === 'hearth.welcome.v1') throw new Error('Synthetic storage unavailable');
      return original.call(this,key,value);
    };
  });
  const privatePage = await privateContext.newPage();
  await privatePage.goto(base);
  const privateWelcome = privatePage.getByTestId('hearth-welcome');
  await privateWelcome.getByRole('button',{name:'开始认识 Hearth'}).click();
  await privateWelcome.getByRole('button',{name:'进入炉边',exact:true}).click();
  await privateWelcome.getByRole('button',{name:'临时进入',exact:true}).waitFor();
  await privatePage.screenshot({path:`${out}/08-storage-unavailable.png`,animations:'disabled'});
  await privateWelcome.getByRole('button',{name:'临时进入',exact:true}).click();
  await expect(privateWelcome).toHaveCount(0);
  await privateContext.close();
  console.log('PASS blocked preference storage offers temporary entry');
  if(errors.length) throw new Error(errors.join('\n'));
} finally {
  await context.close();
  await browser.close();
}
