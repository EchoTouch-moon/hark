// @ts-check
/** @typedef {'overview'|'a'|'b'} View */
/** @typedef {'ready'|'loading'|'empty'|'no-source'|'error'} DisplayState */
/** @typedef {{title:string,kind:string,icon:string,color:string,description:string,goal:string,result:string,todo:string,source:string,opinion:string}} Project */
/** @type {Record<'a'|'b', Project>} */
const projects = {
  a: {title:'星光书签', kind:'模拟 Git 项目', icon:'✦', color:'star', description:'一个关于整理阅读笔记的虚构项目。', goal:'制作一个用于整理虚构阅读笔记的书签清单。', result:'已写出本地清单的初步分类方案。', todo:'为清单补充按主题筛选的说明。', source:'预置材料 · source-project-a-1', opinion:'分类的雏形已经有了，接下来可以先把主题筛选的说明补完整。'},
  b: {title:'雨滴记录', kind:'模拟非 Git 项目', icon:'◒', color:'rain', description:'一份关于每日天气观察的虚构记录。', goal:'整理一份虚构的每日天气观察记录。', result:'已准备一页手写记录格式的示例。', todo:'决定如何在记录中标注日期和天气变化。', source:'预置材料 · source-project-b-1', opinion:'记录格式已有示例，日期和天气变化的标注方式仍待决定。'}
};
/** @type {View} */ let currentView = 'overview';
/** @type {DisplayState} */ let displayState = 'ready';
/** @param {string} id @returns {HTMLElement} */
function element(id) { const node = document.getElementById(id); if (!(node instanceof HTMLElement)) throw new Error(`Missing ${id}`); return node; }
const content = element('content');
const breadcrumb = element('breadcrumb');
/** @param {string} id */
function clone(id) { const template = document.getElementById(id); if (!(template instanceof HTMLTemplateElement)) throw new Error(`Missing ${id}`); return template.content.cloneNode(true); }
function render() {
  content.replaceChildren();
  breadcrumb.textContent = currentView === 'overview' ? '全部项目' : projects[currentView].title;
  document.querySelectorAll('[data-view]').forEach((node) => { if (!(node instanceof HTMLElement) || !node.classList.contains('nav-item')) return; const active = node.dataset.view === currentView; node.classList.toggle('active', active); if (active) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current'); });
  if (displayState !== 'ready') {
    const states = {
      loading: ['◌','正在加载展示状态','这是静态状态示意，未发起服务请求。'],
      empty: ['◇','这里还没有内容','当前仅展示空状态；不会虚构项目或观点。'],
      'no-source': ['◈','来源不可用','无法确认来源时，不展示观点。'],
      error: ['!','暂时无法获取内容','这是错误状态示意；未使用预置数据冒充请求成功。']
    };
    const details = states[displayState];
    const wrap = document.createElement('div'); wrap.className='state-panel';
    const symbol=document.createElement('span'); symbol.className='state-symbol'; symbol.textContent=details[0];
    const heading=document.createElement('h1'); heading.textContent=details[1];
    const desc=document.createElement('p'); desc.textContent=details[2];
    wrap.append(symbol,heading,desc); content.append(wrap); return;
  }
  if (currentView === 'overview') { content.append(clone('overview-template')); return; }
  const project=projects[currentView]; content.append(clone('project-template'));
  for (const [id,value] of Object.entries({title:project.title,kind:project.kind,description:project.description,goal:project.goal,result:project.result,todo:project.todo,source:project.source,opinion:project.opinion})) element(id).textContent=value;
  const icon=element('hero-icon'); icon.textContent=project.icon; icon.classList.add(project.color);
  const form=element('chat-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault(); const input=element('question'); if (!(input instanceof HTMLTextAreaElement)) return;
    const message=input.value.trim(); if (!message) { input.focus(); return; }
    const body=element('chat-body'); const user=document.createElement('div'); user.className='user-message'; user.textContent=message;
    const reply=document.createElement('p'); reply.className='mock-reply'; reply.textContent='示意回复：这条消息未被分析或保存，也没有生成观点修订。';
    body.append(user,reply); input.value=''; body.scrollTop=body.scrollHeight;
  });
}
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button=event.target.closest('[data-view]'); if (!(button instanceof HTMLElement)) return;
  const view=button.dataset.view; if (view !== 'overview' && view !== 'a' && view !== 'b') return;
  currentView=view; render(); window.scrollTo({top:0,behavior:'auto'});
});
const footer=document.querySelector('footer');
if (footer instanceof HTMLElement) {
  const label=document.createElement('label'); label.className='state-control'; label.textContent='预览状态 ';
  const select=document.createElement('select'); select.setAttribute('aria-label','切换静态预览状态');
  for (const [value,text] of [['ready','正常'],['loading','加载'],['empty','空状态'],['no-source','来源不可用'],['error','失败']]) { const option=document.createElement('option'); option.value=value; option.textContent=text; select.append(option); }
  select.addEventListener('change', () => { const value=select.value; if (value==='ready'||value==='loading'||value==='empty'||value==='no-source'||value==='error') { displayState=value; render(); } });
  label.append(select); footer.append(label);
}
render();
