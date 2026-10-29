import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base='http://127.0.0.1:4403', out='handoff/EVIDENCE/conversation-hearth/motion';mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}});
await context.addInitScript(()=>localStorage.setItem('hearth.welcome.v1',JSON.stringify({version:1,completed:true,name:''})));
const page=await context.newPage();
try{
 const {csrfToken}=await(await page.request.get(`${base}/api/v1/auth/session`)).json();
 const {thread}=await(await page.request.post(`${base}/api/v1/threads`,{headers:{'x-csrf-token':csrfToken,origin:base},data:{title:'合成动效预览',projectId:null}})).json();
 await page.goto(`${base}/t/${thread.id}`);const input=page.getByRole('textbox',{name:'输入消息',exact:true});await input.waitFor();await page.waitForTimeout(2200);
 await input.pressSequentially('先聊聊这个项目想解决什么。',{delay:65});await page.waitForTimeout(500);await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForTimeout(1600);
 for(const text of ['我们先梳理下一步。','继续。','把这个想法记下来。']){await input.fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForTimeout(900);}
 await page.waitForTimeout(1000);
}finally{await context.close();await browser.close();}
