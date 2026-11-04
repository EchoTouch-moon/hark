// @ts-check
/** @typedef {{ id:string, title:string, kind:string, coverage:string, understanding:Understanding|null }} Project */
/** @typedef {{ text:string, source:{sourceId:string} }|null} Fact */
/** @typedef {{ goal:Fact, result:Fact, todo:Fact }|null} Understanding */
/** @typedef {{ revision:{id:string, version:number, opinion:string, facts:Array<{statement:string,source:{observerSourceId?:string}}>}, change:{previousRevisionId:string,reason:string}|null, feedback:Array<{reason?:string,choice:string}> }|null} Opinion */
/** @typedef {{ question:string, answer:string }} SavedQuestion */
/** @typedef {{ project:Project, understanding:Understanding, current:Opinion, previous:Opinion, first:Opinion, questions:SavedQuestion[] }} Detail */
/** @typedef {{ synthetic:true, projects:Project[], unavailableCount:number, unassigned:Array<{title:string,text:string}>, access?:Array<{id:string,title:string,state:string}>, initializationErrors?:string[] }} Inventory */
/** @typedef {{ requestId:string, reason:string, createdAt:string, expectedVersion:number }} Challenge */
/** @typedef {{ requestId:string, question:string, createdAt:string }} Question */
/** @type {string|null} */ let csrf = null;
/** @type {Inventory|null} */ let inventory = null;
/** @type {string} */ let view = 'overview';
/** @type {Detail|null} */ let detail = null;
let sequence = 0;
/** @type {{configured:boolean, mode:string, modelId:string|null, reason:string|null, recipient:string, timeoutMs:number}} */
let modelStatus = { configured:false, mode:'disabled', modelId:null, reason:'模型未配置', recipient:'未配置', timeoutMs:90000 };
/** @type {Map<string,Challenge>} */ const pending = new Map();
const pendingPrefix='hark-synthetic-pending:';
const questionPrefix='hark-synthetic-question:';
/** @param {string} id @returns {Challenge|undefined} */
function readPending(id){
  const cached=pending.get(id); if(cached)return cached;
  try { const value=JSON.parse(sessionStorage.getItem(pendingPrefix+id) ?? 'null');
    if(value && typeof value.requestId==='string' && typeof value.reason==='string' && typeof value.createdAt==='string' && Number.isSafeInteger(value.expectedVersion) && value.expectedVersion>0){pending.set(id,value);return value;}
  } catch { /* Unavailable storage means no persisted retry can be read. */ }
  return undefined;
}
/** @param {string} id @param {Challenge} value */
function savePending(id,value){sessionStorage.setItem(pendingPrefix+id,JSON.stringify(value));pending.set(id,value);}
/** @param {string} id */
function clearPending(id){pending.delete(id);try{sessionStorage.removeItem(pendingPrefix+id);}catch{/* The result is already confirmed. */}}
/** @param {string} id @returns {Question|undefined} */
function readPendingQuestion(id){try { const value=JSON.parse(sessionStorage.getItem(questionPrefix+id) ?? 'null'); if(value && typeof value.requestId==='string' && typeof value.question==='string' && typeof value.createdAt==='string')return value; } catch { /* Ignore unavailable or invalid storage. */ } return undefined;}
/** @param {string} id @param {Question} value */
function savePendingQuestion(id,value){sessionStorage.setItem(questionPrefix+id,JSON.stringify(value));}
/** @param {string} id */
function clearPendingQuestion(id){try{sessionStorage.removeItem(questionPrefix+id);}catch{/* The result is already confirmed. */}}
/** @param {string} id @returns {HTMLElement} */
function element(id) { const node = document.getElementById(id); if (!(node instanceof HTMLElement)) throw new Error(`Missing ${id}`); return node; }
const content=element('content'), nav=element('navigation'), breadcrumb=element('breadcrumb');
/** @param {string} tag @param {string} [className] @param {string} [text] */
function el(tag,className='',text='') { const node=document.createElement(tag); if(className) node.className=className; node.textContent=text; return node; }
/** @param {string} text @param {string} className @param {() => void} action */
function button(text,className,action) { const node=document.createElement('button'); node.type='button'; node.className=className; node.textContent=text; node.addEventListener('click',action); return node; }
/** @param {string} path @param {object} [body] @returns {Promise<any>} */
async function request(path,body) {
  const headers = new Headers();
  if (body !== undefined) { if (!csrf) throw new Error('会话不可用，请刷新页面'); headers.set('Content-Type','application/json'); headers.set('X-Hearth-CSRF',csrf); }
  const response=await fetch(path,{ method:body === undefined ? 'GET':'POST', credentials:'same-origin', headers, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
  let data; try { data=await response.json(); } catch { throw new Error('服务响应无效'); }
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : '请求失败');
  return data;
}
/** @param {unknown} error */
function errorText(error) { return error instanceof Error ? error.message : '无法连接合成服务'; }
/** @param {string} title @param {string} description */
function showState(title,description) { content.replaceChildren(); const panel=el('div','state-panel'); panel.append(el('span','state-symbol','✳'),el('h1','',title),el('p','',description)); content.append(panel); }
function renderNav() {
  nav.replaceChildren();
  const all=button('◫  全部项目','nav-item',()=>navigate('overview')); if(view==='overview'){ all.classList.add('active'); all.setAttribute('aria-current','page'); } nav.append(all);
  nav.append(el('p','side-heading projects-label','合成项目'));
  for(const project of inventory?.projects ?? []) {
    const item=button(`✦  ${project.title}`,'nav-item',()=>navigate(project.id));
    if(view===project.id){item.classList.add('active');item.setAttribute('aria-current','page');} nav.append(item);
  }
}
/** @param {string} target */
async function navigate(target) {
  view=target; detail=null; const requestSequence=++sequence; renderNav();
  breadcrumb.textContent=target==='overview' ? '全部项目' : (inventory?.projects.find(item=>item.id===target)?.title ?? '项目');
  showState('正在加载','正在读取合成服务的数据。');
  try {
    if(target==='overview') { const response=await request('/api/inventory'); if(requestSequence!==sequence)return; inventory=response; renderNav(); renderOverview(); }
    else { const response=await request(`/api/projects/${encodeURIComponent(target)}`); if(requestSequence!==sequence)return; detail=response; renderDetail(); }
  } catch(error) { if(requestSequence!==sequence)return; showState('暂时无法获取内容',errorText(error)); }
}
function renderOverview() {
  content.replaceChildren(); const heading=el('div','page-heading'); const title=el('div'); title.append(el('div','eyebrow','YOUR WORKSPACE'),el('h1','','从这里，重新看见你的项目。'),el('p','','把散落的线索放在一起，慢慢理清正在发生的事。')); heading.append(title,el('div','heading-mark','✳')); content.append(heading);
  const section=el('div','section-heading'); const label=el('div'); label.append(el('span','section-index','01 / 项目盘点'),el('h2','','项目一览')); section.append(label);
  const scan=button('盘点预置项目','primary-button',async()=>{
    const requestSequence=++sequence;
    scan.disabled=true; status.textContent='正在盘点预置虚构资料…';
    try { const result=await request('/api/inventory',{}); if(requestSequence!==sequence)return; inventory=result; renderNav(); renderOverview(); }
    catch(error){ if(requestSequence===sequence)status.textContent=`盘点失败：${errorText(error)}`; }
    finally{scan.disabled=false;}
  }); section.append(scan); content.append(section);
  const errors=inventory?.initializationErrors ?? [];
  const status=el('p','operation-status',errors.length ? `部分项目未能完成盘点：${errors.join('、')}。其他可用项目仍可查看。` : '仅盘点服务端的固定虚构资料，不扫描用户目录。'); status.setAttribute('role','status'); content.append(status);
  const grid=el('div','project-grid');
  for(const project of inventory?.projects ?? []){
    const card=button('','project-card',()=>navigate(project.id));
    const top=el('div','card-top'); top.append(el('span',`project-icon big ${project.kind==='simulated_git_marker'?'star':'rain'}`,project.kind==='simulated_git_marker'?'✦':'◒'),el('span','card-arrow','↗'));
    card.append(top,el('span','tag',project.kind==='simulated_git_marker'?'模拟 Git 项目':'模拟非 Git 项目'),el('h3','',project.title),el('p','',project.understanding?.goal?.text ?? '尚未分析或来源不可用。'),el('div','card-footer',project.coverage==='available'?'合成材料已覆盖 · 查看项目 →':'部分材料未分析 · 查看项目 →')); grid.append(card);
  }
  if(!inventory?.projects.length) content.append(el('p','empty-note','当前没有可用项目。可盘点预置项目；已撤销的授权不会重新开启。'));
  content.append(grid);
  if(inventory?.unavailableCount) content.append(el('p','empty-note',`${inventory.unavailableCount} 个项目目前不可用或尚未分析。`));
  for(const item of inventory?.unassigned ?? []) { const box=el('div','unassigned'); const copy=el('div'); copy.append(el('strong','',item.title),el('p','',item.text)); box.append(el('div','unassigned-icon','?'),copy,el('span','','归属未知')); content.append(box); }
  renderAccessList();
}
function renderAccessList() {
  if(!inventory?.access?.length)return;
  const list=el('div','access-list'); list.append(el('h2','','合成项目访问状态'));
  for(const item of inventory.access){ const row=el('div','access-row'); row.append(el('span','',`${item.title} · ${accessLabel(item.state)}`)); if(item.state==='paused')row.append(button('恢复','secondary-button',()=>accessAction(item.id,'resume'))); list.append(row); }
  content.append(list);
}
/** @param {string} state */
function accessLabel(state) { return ({active:'可用',paused:'已暂停',revoked:'已撤销',uninitialized:'尚未初始化',unavailable:'不可用'})[/** @type {'active'|'paused'|'revoked'|'uninitialized'|'unavailable'} */(state)] ?? state; }
/** @param {string} projectId @param {'pause'|'resume'|'revoke'} action */
async function accessAction(projectId,action) {
  if(action==='revoke' && !window.confirm('撤销后无法在此恢复该合成项目的访问。确定撤销吗？'))return;
  const initialView=view, requestSequence=++sequence;
  showState('正在更新访问状态','请稍候。');
  try { await request(`/api/projects/${encodeURIComponent(projectId)}/access`,{action}); if(requestSequence!==sequence)return; await navigate('overview'); }
  catch(error){if(requestSequence!==sequence)return; view=initialView; showState('更新失败',`${errorText(error)}。请返回项目列表重试。`); content.append(button('返回项目列表','secondary-button',()=>navigate('overview')));}
}
/** @param {Fact} item */
function factText(item){return item?.text ?? '未知或来源不可用';}
/** @param {Opinion} record @param {string} label */
function opinionBlock(record,label){
  const section=el('article','opinion'); const heading=el('div','opinion-top',`✳  ${label} · 合成规则观点`); section.append(heading);
  if(!record){section.append(el('p','','暂无可用观点；来源未确认或尚未分析。'));return section;}
  section.append(el('p','',record.revision.opinion));
  for(const fact of record.revision.facts) section.append(el('div','opinion-foot',`依据：${fact.statement} · ${fact.source.observerSourceId ?? '合成来源'}`));
  if(record.change)section.append(el('p','revision-reason',`修订原因：${record.change.reason.replace(/^用户反馈 feedback-[a-f0-9]{64}：/, '用户反馈：')}`));
  for(const feedback of record.feedback) section.append(el('p','revision-reason',`用户反馈（${feedback.choice === 'challenge' ? '质疑' : feedback.choice}）：${feedback.reason ?? '无说明'}`));
  return section;
}
function renderDetail(){
  if(!detail)return; const selected=view, data=detail; content.replaceChildren();
  content.append(button('← 返回全部项目','back-link',()=>navigate('overview')));
  const heading=el('div','project-header'); const text=el('div'); text.append(el('div','eyebrow','合成项目 / 虚构资料'),el('h1','',data.project.title),el('p','','来自受控预置材料')); heading.append(text,el('span','project-icon hero star','✦')); content.append(heading);
  const layout=el('div','project-layout'), details=el('div','details'); const section=el('div','section-heading compact'); const st=el('div'); st.append(el('span','section-index','01 / 项目概览'),el('h2','','目前，我们知道的')); section.append(st,el('span','quiet-note','来自虚构材料')); details.append(section);
  const facts=el('div','facts'); for(const [n,label,item] of /** @type {Array<[string,string,Fact]>} */([['01','目标',data.understanding?.goal ?? null],['02','已有成果',data.understanding?.result ?? null],['03','接下来',data.understanding?.todo ?? null]])) { const row=el('article'); const copy=el('div'); copy.append(el('span','fact-label',label),el('p','',factText(item))); if(item)copy.append(el('small','fact-source',`合成来源 · ${item.source.sourceId}`)); row.append(el('span','fact-number',n),copy); facts.append(row); } details.append(facts);
  const opheading=el('div','section-heading opinion-heading'); const oh=el('div'); oh.append(el('span','section-index','02 / 一点想法'),el('h2','','值得留意')); opheading.append(oh); details.append(opheading,opinionBlock(data.current,data.current ? `v${data.current.revision.version}`:'暂无观点'));
  if(data.previous){const history=document.createElement('details');history.className='version-preview';const summary=el('summary','','查看旧版与反馈');history.append(summary,opinionBlock(data.previous,`v${data.previous.revision.version}`));if(data.first)history.append(opinionBlock(data.first,`v${data.first.revision.version}`));details.append(history);}
  const actions=el('div','access-actions'); actions.append(button('暂停访问','secondary-button',()=>accessAction(selected,'pause')),button('撤销访问','secondary-button',()=>accessAction(selected,'revoke'))); details.append(actions,el('p','uncertainty','撤销不可在此恢复；暂停后可从项目列表恢复。'));
  const convo=el('aside','conversation');convo.setAttribute('aria-label','项目对话');
  const header=el('div','conversation-header'); header.append(el('strong','','和 Hark 聊聊'),el('span','mock-chip','追问 MOCK'),el('span','model-chip',modelStatus.configured ? (modelStatus.mode==='mock' ? '模型 Mock' : String(modelStatus.modelId)) : '模型未配置'));convo.append(header);
  const messages=el('div','chat-body');messages.append(el('p','chat-hint','追问仍是固定 Mock。发给模型前可以预览全部外发内容；未确认不会请求模型。模型回答不是已验证事实。'));for(const saved of data.questions ?? [])messages.append(el('div','user-message',saved.question),el('p','mock-reply',`Mock：${saved.answer}`));const modelLog=el('div','model-log');messages.append(modelLog);convo.append(messages);
  const form=document.createElement('form'); form.addEventListener('submit',event=>event.preventDefault()); const label=document.createElement('label');label.htmlFor='question';label.textContent='追问或质疑';const input=document.createElement('textarea');input.id='question';input.rows=3;input.maxLength=500;input.placeholder='写下你的想法…'; const hint=el('p','operation-status');hint.setAttribute('role','status');const previewBox=el('div','preview-box');previewBox.hidden=true;const controls=el('div','form-actions');const ask=button('追问','secondary-button',()=>question());const challenge=button('质疑并保存','primary-button',()=>submitChallenge());const previewBtn=button('预览外发','secondary-button',()=>previewModel());const abandon=button('放弃重试并重新读取','secondary-button',()=>{clearPending(selected);clearPendingQuestion(selected);void navigate(selected);});abandon.hidden=true;if(!modelStatus.configured)previewBtn.disabled=true;controls.append(ask,challenge,previewBtn,abandon);form.append(label,input,previewBox,controls,hint);convo.append(form);layout.append(details,convo);content.append(layout);
  const outstanding=readPending(selected), outstandingQuestion=readPendingQuestion(selected); if(outstanding){input.value=outstanding.reason;input.readOnly=true;ask.disabled=true;challenge.textContent='重试上次质疑';abandon.hidden=false;hint.textContent='上次保存结果尚未确认；反馈可能已保存而修订未完成。可重试原请求，或放弃重试并重新读取版本。';}else if(outstandingQuestion){input.value=outstandingQuestion.question;input.readOnly=true;challenge.disabled=true;ask.textContent='重试上次追问';abandon.hidden=false;hint.textContent='上次追问的保存结果尚未确认；可重试原请求，或放弃重试并重新读取。';}
  /** @param {boolean} busy */ function setBusy(busy){ask.disabled=busy;challenge.disabled=busy;abandon.disabled=busy;previewBtn.disabled=busy||!modelStatus.configured;}
  async function question(){let payload=readPendingQuestion(selected);if(!payload){const text=input.value.trim();if(!text){input.focus();return;}payload={requestId:crypto.randomUUID(),question:text,createdAt:new Date().toISOString()};try{savePendingQuestion(selected,payload);}catch{hint.textContent='无法保留重试信息，未发送追问。';return;}}const requestSequence=sequence;input.readOnly=true;ask.textContent='重试上次追问';abandon.hidden=false;setBusy(true);hint.textContent='正在保存追问并获取 Mock 回复…';try{const answer=await request(`/api/projects/${encodeURIComponent(selected)}/question`,payload);clearPendingQuestion(selected);if(requestSequence!==sequence)return;messages.append(el('div','user-message',payload.question),el('p','mock-reply',`Mock：${String(answer.answer ?? '')}`));for(const fact of answer.facts ?? [])messages.append(el('p','mock-reply',`合成依据：${String(fact.statement ?? '')}`));input.value='';input.readOnly=false;ask.textContent='追问';abandon.hidden=true;hint.textContent='追问和 Mock 回复已保存；回复不会作为事实。';}catch(error){if(requestSequence===sequence)hint.textContent=`未确认保存结果：${errorText(error)}。可重试原请求，或放弃重试并重新读取。`;}finally{setBusy(false);if(readPendingQuestion(selected))challenge.disabled=true;}}
  async function submitChallenge(){
    let payload=readPending(selected); const reason=input.value.trim();
    if(!payload){if(!reason){input.focus();return;}if(!data.current){hint.textContent='没有可质疑的有效观点。';return;}payload={requestId:crypto.randomUUID(),reason,createdAt:new Date().toISOString(),expectedVersion:data.current.revision.version};try{savePending(selected,payload);}catch{hint.textContent='无法保留重试信息，未发送反馈。';return;}}
    const requestSequence=sequence;input.readOnly=true;challenge.textContent='重试上次质疑';abandon.hidden=false;
    setBusy(true);hint.textContent='正在保存反馈…';
    try{await request(`/api/projects/${encodeURIComponent(selected)}/challenge`,payload);clearPending(selected);if(requestSequence!==sequence)return;hint.textContent='反馈已保存，正在读取版本。';await navigate(selected);}
    catch(error){if(requestSequence===sequence)hint.textContent=`未确认保存结果：${errorText(error)}。反馈可能已保存而修订未完成；可重试原请求，或放弃重试并重新读取版本。`;}
    finally{setBusy(false);if(readPending(selected))ask.disabled=true;}
  }
  /** @type {string|null} */ let conversationId=null; /** @type {{previewId:string, question:string}|null} */ let openPreview=null;
  input.addEventListener('input',()=>{ if(!openPreview)return; const current=openPreview; openPreview=null; previewBox.hidden=true; previewBox.replaceChildren(); void request(`/api/model/previews/${current.previewId}/cancel`,{projectId:selected}).catch(()=>{}); });
  function paintMessage(message){ if(message.role==='user'){modelLog.append(el('div','user-message',String(message.question ?? '')));return;} const block=el('div','model-answer'); if(message.withheld||!message.answer){block.append(el('p','',message.withheld?'来源已失效，模型回答已隐藏。':'没有可显示的模型回答。'));} else { block.append(el('p','',String(message.answer))); for(const item of message.uncertainties ?? [])block.append(el('p','model-meta',`不确定：${item}`)); for(const fact of message.evidence ?? [])block.append(el('p','model-meta',fact.available===false?`证据 ${fact.id} 已失效`:`证据（未验证）：${fact.statement ?? fact.id}`)); if(message.unboundEvidenceRefs?.length)block.append(el('p','model-meta',`未采纳的证据编号：${message.unboundEvidenceRefs.join('、')}`)); } modelLog.append(block); }
  async function loadThread(){ const requestSequence=sequence; try { const thread=await request(`/api/model/projects/${encodeURIComponent(selected)}/conversation`); if(requestSequence!==sequence)return null; modelLog.replaceChildren(); conversationId=typeof thread.id==='string'?thread.id:null; for(const message of thread.messages ?? [])paintMessage(message); return thread; } catch { if(requestSequence===sequence && modelStatus.configured)hint.textContent='模型对话暂时无法读取。'; return null; } }
  /** @param {{state?:string, error?:string|null}} run */
  function runStatus(run){ if(run.state==='running')return '正在请求模型…'; if(run.state==='cancelled')return '已取消，没有把结果当作成功。'; if(run.state==='unknown')return '结果未知，不会自动再次请求模型。'; if(run.state==='failed')return `模型请求失败：${run.error ?? '未知错误'}。没有改用 Mock。`; return '模型请求已结束。'; }
  function showPreview(preview){ openPreview={previewId:String(preview.previewId), question:input.value.trim()}; previewBox.hidden=false; previewBox.replaceChildren(); previewBox.append(el('h3','','即将发送的内容'),el('p','model-meta',`接收方：${preview.recipient} · 模型：${preview.modelId} · 摘要：${preview.digest}`),el('p','model-meta',`限制：超时 ${preview.limits?.timeoutMs ?? ''} ms，输出上限 ${preview.limits?.maxOutputBytes ?? ''} 字节，调用上限 ${preview.limits?.maxCalls ?? ''}。${preview.truncated?'低优先级上下文已截断。':''}`)); const system=document.createElement('pre'); system.textContent=String(preview.outbound?.system ?? ''); const user=document.createElement('pre'); user.textContent=String(preview.outbound?.user ?? ''); previewBox.append(el('p','model-meta','系统指令'),system,el('p','model-meta','实际外发资料'),user); const actions=el('div','form-actions'); actions.append(button('确认发送','primary-button',()=>confirmModel()),button('取消预览','secondary-button',()=>cancelPreview())); previewBox.append(actions); }
  async function previewModel(){ if(!modelStatus.configured){hint.textContent='模型未配置，不会发出请求。';return;} const text=input.value.trim(); if(!text){input.focus();return;} const requestSequence=sequence; setBusy(true); hint.textContent='正在本地生成预览…'; try { const preview=await request('/api/model/preview',{projectId:selected, question:text, requestId:crypto.randomUUID(), ...(conversationId?{conversationId}:{})}); if(requestSequence!==sequence)return; conversationId=String(preview.conversationId); showPreview(preview); hint.textContent='预览只在本地生成，尚未请求模型。'; } catch(error){ if(requestSequence===sequence){openPreview=null; previewBox.hidden=true; hint.textContent=`没有生成可发送的预览：${errorText(error)}`;} } finally { setBusy(false); } }
  async function cancelPreview(){ const current=openPreview; openPreview=null; previewBox.hidden=true; previewBox.replaceChildren(); if(!current)return; try { await request(`/api/model/previews/${current.previewId}/cancel`,{projectId:selected}); hint.textContent='已取消预览，没有请求模型。'; } catch(error){ hint.textContent=`预览取消结果未确认：${errorText(error)}`; } }
  async function confirmModel(){ const current=openPreview; if(!current || current.question!==input.value.trim()){hint.textContent='问题已变化，请重新预览。';openPreview=null;previewBox.hidden=true;return;} const requestSequence=sequence; setBusy(true); hint.textContent='正在请求模型…'; try { const started=await request('/api/model/runs',{projectId:selected, previewId:current.previewId, question:current.question}); openPreview=null; previewBox.hidden=true; previewBox.replaceChildren(); if(requestSequence!==sequence)return; const rounds=Math.max(8, Math.ceil((modelStatus.timeoutMs || 90000)/300)); let run=null; for(let index=0; index<rounds; index++){ run=await request(`/api/model/runs/${started.runId}?projectId=${encodeURIComponent(selected)}`); if(requestSequence!==sequence)return; hint.textContent=runStatus(run); if(run.state!=='running')break; await new Promise(resolve=>setTimeout(resolve,300)); } if(!run || requestSequence!==sequence)return; if(run.state==='succeeded'){ const finished=run; await loadThread(); if(requestSequence!==sequence)return; hint.textContent=finished.withheld?'来源已失效，没有显示模型回答。':'模型已回答。回答和证据都未标记为已验证事实。'; if(finished.suggestedOpinion && !finished.withheld){ const save=button('保存为观点草案','secondary-button',async()=>{ save.disabled=true; try { await request('/api/model/opinions',{projectId:selected, runId:String(finished.id), save:true}); if(requestSequence===sequence)hint.textContent='已保存为观点草案，没有写入项目事实，也没有执行建议。'; } catch(error){ if(requestSequence===sequence)hint.textContent=`草案没有保存：${errorText(error)}`; } }); modelLog.append(save); } } } catch(error){ if(requestSequence===sequence)hint.textContent=`没有确认模型结果：${errorText(error)}。没有改用 Mock。`; } finally { setBusy(false); } }
  void loadThread();
}
async function start(){
  showState('正在连接','正在建立本地合成会话。');
  try{const result=await request('/api/session');if(typeof result.csrfToken!=='string'||!result.csrfToken)throw new Error('会话响应无效');csrf=result.csrfToken;modelStatus=await request('/api/model/status');const modeLabel=document.getElementById('mode-label');if(modeLabel)modeLabel.textContent=modelStatus.configured?(modelStatus.mode==='mock'?'合成演示 · Mock 模型':`合成演示 · ${modelStatus.modelId}`):'合成演示 · 模型未配置';await navigate('overview');}
  catch(error){showState('无法连接合成服务',`${errorText(error)}。请检查服务后刷新页面。`);}
}
start();
