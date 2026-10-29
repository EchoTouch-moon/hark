import {chromium,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const out='handoff/EVIDENCE/ember-motion';mkdirSync(out,{recursive:true});
const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 const auth=await page.request.get('http://127.0.0.1:4401/api/v1/auth/session');
 const {csrfToken}=await auth.json();
 const created=await page.request.post('http://127.0.0.1:4401/api/v1/threads',{headers:{'x-csrf-token':csrfToken,origin:'http://127.0.0.1:4401'},data:{title:'Synthetic motion QA',projectId:null}});
 const {thread}=await created.json();
 await page.goto(`http://127.0.0.1:4401/t/${thread.id}`);await page.locator('textarea').waitFor();await page.screenshot({path:`${out}/01-first-ember.png`,animations:'disabled'});

 await expect(page.locator('.canvas-shell')).toHaveAttribute('data-flame-state','dim');
 const input=page.locator('textarea');await input.fill('合成验收：讨论炉心动效');
 await page.route('**/api/v1/chat',route=>route.fulfill({status:500,json:{message:'Synthetic failure'}}));
 await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();await expect(input).toHaveValue('合成验收：讨论炉心动效');await expect(page.locator('.canvas-shell')).toHaveAttribute('data-flame-state','dim');
 await page.screenshot({path:`${out}/02-failed.png`,animations:'disabled'});console.log('PASS failure preserves draft and dim state');
 await page.unroute('**/api/v1/chat');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.locator('.canvas-page')).toHaveAttribute('data-motion-scene','ignite');await expect(page.locator('.canvas-shell')).toHaveAttribute('data-flame-state','lively');await expect(input).toBeFocused();
 await page.screenshot({path:`${out}/03-ignited.png`,animations:'disabled'});console.log('PASS confirmed send ignites and preserves composer focus');
 await page.reload();await expect(page.locator('.canvas-shell')).toHaveAttribute('data-flame-state','lively');console.log('PASS reload restores confirmed warmth');
 let ageHours=48;
 await page.route('**/api/v1/chat/history?*',async route=>{const response=await route.fetch();const data=await response.json();data.messages=data.messages.map(m=>m.role==='user'?{...m,createdAt:new Date(Date.now()-ageHours*3600000).toISOString()}:m);await route.fulfill({json:data});});
 await page.reload();await expect(page.locator('.canvas-shell')).toHaveAttribute('data-flame-state','warm');await page.screenshot({path:`${out}/05-warm.png`,animations:'disabled'});
 ageHours=192;await page.reload();await expect(page.locator('.canvas-shell')).toHaveAttribute('data-flame-state','dim');await page.screenshot({path:`${out}/06-return.png`,animations:'disabled'});
 await page.unroute('**/api/v1/chat/history?*');await input.fill('Synthetic rekindle');await page.getByRole('button',{name:'\u53d1\u9001',exact:true}).click();await expect(page.locator('.canvas-page')).toHaveAttribute('data-motion-scene','rekindle');await expect(page.locator('.canvas-shell')).toHaveAttribute('data-flame-state','lively');
 console.log('PASS warm/dim keyframes and confirmed rekindle');
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${out}/04-mobile-reduced.png`,animations:'disabled'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);console.log('PASS mobile and reduced-motion');
 await page.getByRole('button',{name:'\u6682\u505c\u52a8\u6548'}).click();
 await expect(page.locator('.canvas-page')).toHaveAttribute('data-motion-paused','true');
 console.log('PASS explicit motion pause');
 if(errors.length)throw Error(errors.join('\n'));
}finally{await context.close();await browser.close();}
