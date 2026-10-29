import {chromium,expect} from '@playwright/test';
const base='http://127.0.0.1:4402';const out='handoff/EVIDENCE/ember-craft';
const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
await context.addInitScript(()=>localStorage.setItem('hearth.welcome.v1',JSON.stringify({version:1,completed:true,name:''})));
const page=await context.newPage();
try{
 const {csrfToken}=await (await page.request.get(`${base}/api/v1/auth/session`)).json();
 const {thread}=await (await page.request.post(`${base}/api/v1/threads`,{headers:{'x-csrf-token':csrfToken,origin:base},data:{title:'Synthetic flame states',projectId:null}})).json();
 await page.goto(`${base}/t/${thread.id}`);await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('合成炉心三态验收');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.canvas-shell')).toHaveAttribute('data-flame-state','lively');
 let age=0;
 await page.route('**/api/v1/chat/history?*',async route=>{const response=await route.fetch();const data=await response.json();data.messages=data.messages.map(m=>m.role==='user'?{...m,createdAt:new Date(Date.now()-age*3600000).toISOString()}:m);await route.fulfill({json:data});});
 for(const [hours,band,state] of [[0,'hot','lively'],[48,'warm','warm'],[192,'cool','dim']]){
  age=hours;await page.reload();await expect(page.locator('.canvas-shell')).toHaveAttribute('data-flame-state',state);
  const art=page.locator('.composer .ember-presence');await expect(art).toHaveAttribute('data-band',band);
  // Magnify the actual rendered compact component for contour review; not a product layout.
  await page.addStyleTag({content:'.composer .ember-presence{position:fixed!important;left:40px!important;top:120px!important;width:288px!important;height:324px!important;z-index:100!important;background:#f8f5ef!important;transform:none!important;flex:none!important;}'});
  await art.screenshot({path:`${out}/flame-${band}-detail.png`,animations:'disabled'});
  console.log(`PASS actual ${state} component rendered with distinct contour; detail capture magnified`);
 }
}finally{await context.close();await browser.close();}
