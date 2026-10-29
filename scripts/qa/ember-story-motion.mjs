import {chromium} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const out='handoff/EVIDENCE/ember-story/motion';mkdirSync(out,{recursive:true});
const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}});
await context.addInitScript(()=>localStorage.setItem('hearth.welcome.v1',JSON.stringify({version:1,completed:true,name:''})));
const page=await context.newPage();const base='http://127.0.0.1:4402';
try{
 const {csrfToken}=await(await page.request.get(`${base}/api/v1/auth/session`)).json();
 const {thread}=await(await page.request.post(`${base}/api/v1/threads`,{headers:{'x-csrf-token':csrfToken,origin:base},data:{title:'Synthetic motion capture',projectId:null}})).json();
 await page.goto(`${base}/t/${thread.id}`);const flame=page.locator('.seed-presence');await flame.waitFor();await page.waitForTimeout(2500);
 const rect=await flame.boundingBox();await page.mouse.move(rect.x+rect.width*.2,rect.y+rect.height*.6);await page.waitForTimeout(900);await page.mouse.move(rect.x+rect.width*.8,rect.y+rect.height*.6);await page.waitForTimeout(900);
 const input=page.getByRole('textbox',{name:'输入消息',exact:true});await input.click();await input.pressSequentially('我想把一个想法，慢慢变成项目。',{delay:80});await page.waitForTimeout(750);
 await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForTimeout(1700);
}finally{await context.close();await browser.close();}
