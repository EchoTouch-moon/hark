/* Hearth · 续页 — isolated interaction prototype. All data is synthetic.
 * No backend requests, filesystem access, model calls or system notifications.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'continuation-prototype.v1';
  const main = document.getElementById('app-main');
  const toastNode = document.getElementById('toast');
  const dialog = document.getElementById('evidence-dialog');
  const evidenceContent = document.getElementById('evidence-content');
  const closeEvidence = document.getElementById('close-evidence');
  if (!main || !toastNode || !dialog || !evidenceContent || !closeEvidence) return;

  const projects = {
    fragments: {
      id: 'fragments', name: '片段', english: 'Fragments', date: '2025.02', recorded: '2025 年 2 月',
      purpose: '把读过的文章，变成以后还能找回的片段。',
      category: '阅读与知识', status: '值得再看', material: 'README · 交互草图 · 摘录组件',
      idea: '读到好内容时，先留下来。过一阵子，再让它回到眼前。',
      headline: '给「片段」一个更小的起点。',
      description: '这份阅读工具的雏形已经留下了一个清楚的念头：让摘录有机会再次被看见。可以先验证“保存一段，再回来读”，把完整知识库留到之后。',
      uncertainty: '原型资料没有记录你当时为何停下；“先验证回访”是一条示例建议，仍需要你判断。',
      excerpt: '# Fragments\n\nSave a passage.\nReturn to it, a little later.\n\n— unfinished note, Feb 2025',
      pieces: ['文章摘录的小组件', '保存与回访的交互草图', '一份写到一半的 README'],
      question: '第一次回来时，你希望看到随机片段，还是上次留下的那一段？',
    },
    trails: {
      id: 'trails', name: '旧途', english: 'Trails', date: '2024.09', recorded: '2024 年 9 月',
      purpose: '把走过的地方，留成一张可以回看的私人路线。',
      category: '个人工具', status: '保留观察', material: '路线样例 · 地图草图 · 设计笔记',
      idea: '路线不只是起点和终点，也可以留住沿途的一点感受。',
      headline: '「旧途」可以先留在观察清单。',
      description: '材料里有路线和笔记的雏形，但还看不出你最想保留哪一种体验。先把这个问题想清楚，再决定是否继续，会比急着补功能更有帮助。',
      uncertainty: '缺少真实使用反馈与外部研究，不能据此判定项目的价值或可替代性。',
      excerpt: '# Trails\n\nA place, a route,\nand something worth remembering.\n\n— concept note, Sep 2024',
      pieces: ['三条合成路线样例', '地图与文字的布局草图', '尚未确认的个人使用设想'],
      question: '你更想记录走过的路线，还是留住路线上的故事？',
    },
    tide: {
      id: 'tide', name: '潮汐', english: 'Tide', date: '2026.06', recorded: '2026 年 6 月',
      purpose: '用轻一点的方式，记录一天里的专注与休息。',
      category: '日常实验', status: '尚待了解', material: '计时组件 · 本地记录样例',
      idea: '不把一天变成成绩单，只留一点节奏。',
      headline: '先找回你做「潮汐」的理由。',
      description: '目前只有计时与本地记录的示例材料。继续补功能之前，可以先聊聊：当时哪一个日常片刻，让你觉得需要它？',
      uncertainty: '尚无用户确认的目标，也未进行真实工具或市场比较。',
      excerpt: '# Tide\n\nWork for a while.\nLeave a little room to pause.\n\n— local experiment, Jun 2026',
      pieces: ['计时器界面组件', '一组本地合成记录', '尚未补充的使用目标'],
      question: '你希望它帮你开始工作，还是提醒你可以休息？',
    },
  };
  const projectIds = Object.keys(projects);
  const scopes = ['all', ...projectIds];
  const defaults = () => ({ theme: 'light', busy: false, deferred: [], kept: [], directories: [], messages: {}, drafts: {} });

  function readState() {
    const result = defaults();
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
      result.theme = value.theme === 'dark' ? 'dark' : 'light';
      result.busy = value.busy === true;
      result.deferred = Array.isArray(value.deferred) ? value.deferred.filter(id => projectIds.includes(id)) : [];
      result.kept = Array.isArray(value.kept) ? value.kept.filter(id => projectIds.includes(id)) : [];
      result.directories = Array.isArray(value.directories) ? value.directories.filter(item => typeof item === 'string').slice(0, 8).map(item => item.slice(0, 200)) : [];
      for (const scope of scopes) {
        const rows = value.messages && typeof value.messages === 'object' ? value.messages[scope] : null;
        result.messages[scope] = Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object' && ['user', 'assistant'].includes(row.role) && typeof row.text === 'string').slice(-16).map(row => ({ role: row.role, text: row.text.slice(0, 4000) })) : [];
        const draft = value.drafts && typeof value.drafts === 'object' ? value.drafts[scope] : '';
        result.drafts[scope] = typeof draft === 'string' ? draft.slice(0, 2000) : '';
      }
    } catch { /* A prototype preference failure never replaces a user's data. */ }
    return result;
  }

  const state = readState();
  let route = { view: 'discover', project: null, tab: 'overview' };
  let toastTimer;
  let previousEvidenceTrigger = null;
  let storageFailureShown = false;

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch {
      if (!storageFailureShown) { storageFailureShown = true; toast('浏览器未能保存演示偏好，本次仍可继续体验。'); }
    }
  }
  function toast(message) {
    clearTimeout(toastTimer);
    toastNode.textContent = message;
    toastNode.hidden = false;
    toastNode.classList.add('is-visible');
    toastTimer = setTimeout(() => { toastNode.classList.remove('is-visible'); toastNode.hidden = true; }, 4200);
  }
  function activeScope() { return route.project && projectIds.includes(route.project) ? route.project : 'all'; }
  function status(project) {
    if (state.kept.includes(project.id)) return '已记下方向';
    if (state.deferred.includes(project.id)) return '你选择稍后看';
    return project.status;
  }
  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    if (parts[0] === 'project' && projectIds.includes(parts[1])) return { view: 'dossier', project: parts[1], tab: ['overview', 'research', 'decisions'].includes(parts[2]) ? parts[2] : 'overview' };
    if (parts[0] === 'conversation') return { view: 'conversation', project: projectIds.includes(parts[1]) ? parts[1] : null, tab: 'overview' };
    return { view: ['discover', 'projects', 'settings', 'setup'].includes(parts[0]) ? parts[0] : 'discover', project: null, tab: 'overview' };
  }
  function rememberDraft() {
    const input = document.getElementById('conversation-input');
    if (route.view === 'conversation' && input) state.drafts[activeScope()] = input.value.slice(0, 2000);
  }
  function navigate(hash) {
    rememberDraft();
    save();
    if (location.hash === hash) { route = parseHash(); render(true); }
    else location.hash = hash;
  }
  function pageHeading(title, description, extra = '') {
    return `<header class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${extra}</header>`;
  }

  function renderDiscover() {
    const project = projectIds.map(id => projects[id]).find(item => !state.deferred.includes(item.id)) || projects.fragments;
    const allDeferred = projectIds.every(id => state.deferred.includes(id));
    const otherProjects = projectIds.filter(id => id !== project.id);
    return `${pageHeading('值得再看一眼', '有些想法，只是缺一个新的起点。', '<span class="page-date">2026 · 10 · 30</span>')}
      ${state.deferred.length ? `<div class="saved-choice"><span>你选择稍后看 ${state.deferred.length} 条示例线索。</span><button type="button" class="text-button" data-action="restore">恢复这些线索</button></div>` : ''}
      <div class="discovery-layout">
        <article class="feature-story">
          <h2>${allDeferred ? '给这些想法，留一点时间。' : escapeHTML(project.headline)}</h2>
          <p class="story-disclosure">根据合成档案给出的示例判断</p><p class="story-description">${allDeferred ? '这三条示例线索都已被你搁置。它们还在项目档案里，不会因为暂时不看而丢失。' : escapeHTML(project.description)}</p>
          <div class="story-context"><span class="context-label">之前留下的念头</span><p>“${escapeHTML(project.idea)}”</p><button type="button" class="project-inline" data-action="open-dossier" data-project="${project.id}">${escapeHTML(project.name)} <span aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button></div>
          <div class="story-actions"><button type="button" class="primary" data-action="open-project-chat" data-project="${project.id}">接着聊这个项目 <span aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button><button type="button" class="text-button" data-action="${allDeferred ? 'restore' : 'defer'}" data-project="${project.id}">${allDeferred ? '重新看看线索' : '先放一放'}</button></div>
          <button type="button" class="evidence-link" data-action="evidence" data-project="${project.id}">看看这条判断的依据 <span aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></span></button>
        </article>
        <aside class="project-paper" aria-label="合成项目档案摘页">
          <span class="paper-tab">项目档案 / ${escapeHTML(project.english)}</span>
          <header class="paper-heading"><span class="document-mark" aria-hidden="true"></span><h3>${escapeHTML(project.name)}</h3><span>${escapeHTML(project.date)}</span></header>
          <p class="paper-purpose">${escapeHTML(project.purpose)}</p>
          <div class="paper-rule"></div>
          <pre class="paper-excerpt">${escapeHTML(project.excerpt)}</pre>
          <p class="paper-annotation">一份未完成的念头，<br>也可以有下一页。</p>
          <div class="attachment-row"><span>合成材料摘录</span><button type="button" class="text-button" data-action="open-dossier" data-project="${project.id}">翻开档案 <span aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button></div>
        </aside>
      </div>
      <section class="discovery-bottom" aria-labelledby="more-clues"><h3 id="more-clues">其他留在页边的线索</h3><div class="clue-list">${otherProjects.map(id => {
        const item = projects[id];
        return `<button type="button" class="clue-row" data-action="open-dossier" data-project="${id}"><span class="clue-title">${escapeHTML(item.name)}</span><span class="clue-description">${escapeHTML(item.question)}</span><span class="clue-date">${escapeHTML(item.date)}</span><span aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button>`;
      }).join('')}</div><p class="quiet-note">这些是设计演示中的合成项目。真实研究与后台能力尚未连接。</p></section>`;
  }

  function renderProjects() {
    return `${pageHeading('想法还在这里', '不必记得每一个细节。先找到那个你想接着做的项目。', '<span class="collection-count">3 份示例档案</span>')}
      <div class="project-list" aria-label="示例项目列表">${projectIds.map((id, index) => {
        const project = projects[id];
        return `<button type="button" class="project-row" data-action="open-dossier" data-project="${id}"><span class="project-index">${String(index + 1).padStart(2, '0')}</span><span class="project-row-main"><span class="project-name">${escapeHTML(project.name)} <span>${escapeHTML(project.english)}</span></span><span class="project-purpose">${escapeHTML(project.purpose)}</span><span class="project-material">${escapeHTML(project.material)}</span></span><span class="project-row-meta"><span class="project-choice">${escapeHTML(status(project))}</span><span>${escapeHTML(project.recorded)}</span></span><span class="row-arrow" aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button>`;
      }).join('')}</div>
      <div class="library-footnote"><p>档案里的推测会保留来源，<br>你的补充与选择会留下来。</p><button type="button" class="secondary" data-action="setup">看看目录如何加入 <span aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button></div>
      <p class="quiet-note">此处展示三个合成项目，不代表已读取你的电脑。</p>`;
  }

  function renderDossier() {
    const project = projects[route.project] || projects.fragments;
    const tabs = [['overview', '项目概况'], ['research', '研究与线索'], ['decisions', '你的选择']];
    let content;
    if (route.tab === 'research') {
      content = `<section class="dossier-section"><h2>重新看它的一个角度</h2><p>${escapeHTML(project.description)}</p><h3>还不能确定的部分</h3><p>${escapeHTML(project.uncertainty)}</p><div class="source-note"><span>示例研究笔记 R-03 · 尚未连接外部来源</span><button type="button" class="evidence-link" data-action="evidence" data-project="${project.id}">查看示例依据 <svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button></div></section>`;
    } else if (route.tab === 'decisions') {
      content = `<section class="dossier-section"><h2>下一步，由你决定</h2><p>${state.kept.includes(project.id) ? '你已在本原型中记下这个方向。它是一条讨论记录，不代表已执行开发。' : state.deferred.includes(project.id) ? '你已选择稍后看。这条示例判断仍可在档案中找回。' : '这份档案还没有你的决定。可以继续讨论，或者先留下一个方向。'}</p><button type="button" class="primary" data-action="keep-project" data-project="${project.id}">${state.kept.includes(project.id) ? '方向已记下（演示）' : '记下这个方向（演示）'}</button><p class="quiet-note">选择只保存在本浏览器的原型记录里，不会修改、移动或归档任何真实文件。</p></section>`;
    } else {
      content = `<section class="dossier-section"><h2>当时想做的事</h2><p class="dossier-lead">${escapeHTML(project.idea)}</p><p>根据合成材料整理的项目概况。真实的初衷与搁置原因，仍需要你补充确认。</p><h3>已经留下的材料</h3><ul class="material-list">${project.pieces.map(piece => `<li>${escapeHTML(piece)}</li>`).join('')}</ul><h3>一个还没回答的问题</h3><p>${escapeHTML(project.question)}</p><button type="button" class="evidence-link" data-action="evidence" data-project="${project.id}">查看这份概况的来源 <svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button></section>`;
    }
    return `<button type="button" class="back-button" data-action="back-projects"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4m6-6-6 6 6 6"/></svg> 项目库</button><div class="dossier-layout"><article class="current-project"><header class="dossier-heading"><h1>${escapeHTML(project.name)}</h1><span class="dossier-category">${escapeHTML(project.category)} · 示例档案</span><p>${escapeHTML(project.purpose)}</p><span class="dossier-recorded">最早的示例记录 · ${escapeHTML(project.recorded)}</span></header><nav class="dossier-tabs" aria-label="项目档案内容">${tabs.map(([id, label]) => `<button type="button" data-action="dossier-tab" data-tab="${id}" data-project="${project.id}"${route.tab === id ? ' aria-current="page" class="is-active"' : ''}>${label}</button>`).join('')}</nav>${content}</article><aside class="note-sheet"><span class="note-fold" aria-hidden="true"></span><h2>留在页边的线索</h2><p>${escapeHTML(project.headline)}</p><span class="note-source">示例判断 · 有待你的回应</span><button type="button" class="primary" data-action="open-project-chat" data-project="${project.id}">接着聊 <span aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button><button type="button" class="text-button" data-action="${state.deferred.includes(project.id) ? 'restore-project' : 'defer'}" data-project="${project.id}">${state.deferred.includes(project.id) ? '恢复这条线索' : '先放一放'}</button></aside></div>`;
  }

  function renderConversation() {
    const scope = activeScope();
    const project = scope === 'all' ? null : projects[scope];
    const messages = state.messages[scope] || [];
    const initial = project ? `这份示例档案里，${project.name}想做的是：${project.purpose}\n\n${project.question}` : '我们可以从全部示例项目里找回一个念头，也可以从某一份档案接着聊。';
    return `<header class="conversation-heading"><div><h1>从一个念头接着聊。</h1><p>${project ? `现在围绕「${escapeHTML(project.name)}」讨论` : '先不选项目，也能聊聊你留下的那些想法。'}</p></div><button type="button" class="scope-button" data-action="global-chat">${project ? '回到全部项目' : '全部示例项目'} <span aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button></header>
      <div class="conversation-layout"><section class="chat-transcript" aria-label="示例对话" aria-live="polite"><article class="chat-message is-assistant"><span class="message-author">Hearth <span>示例开场</span></span><p>${escapeHTML(initial).replace(/\n/g, '<br>')}</p>${project ? `<button type="button" class="evidence-link" data-action="open-dossier" data-project="${project.id}">翻开「${escapeHTML(project.name)}」的档案 <svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button>` : ''}</article>${messages.map(message => `<article class="chat-message ${message.role === 'user' ? 'is-user' : 'is-assistant'}"><span class="message-author">${message.role === 'user' ? '你' : 'Hearth <span>示例答复</span>'}</span><p>${escapeHTML(message.text).replace(/\n/g, '<br>')}</p>${message.role === 'assistant' ? `<button type="button" class="evidence-link" data-action="evidence" data-project="${project?.id || 'fragments'}">查看示例资料 <svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button>` : ''}</article>`).join('')}</section>
      ${messages.length === 0 && !project ? `<div class="conversation-suggestions" aria-label="示例问题">${['有哪些想法，值得重新拾起？', '哪些项目可以先保留观察？', '我想找回「片段」的思路'].map(prompt => `<button type="button" class="suggestion-chip" data-action="prompt" data-prompt="${escapeHTML(prompt)}">${escapeHTML(prompt)} <span aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button>`).join('')}</div>` : ''}
      <form id="conversation-form" class="conversation-composer"><label for="conversation-input" class="composer-label">${project ? `${escapeHTML(project.name)} · 项目讨论` : '全部项目 · 自由讨论'}</label><div class="composer-input-row"><textarea id="conversation-input" name="message" rows="2" maxlength="2000" placeholder="${project ? '想先找回哪一段？' : '比如：有哪些想法，值得重新拾起？'}" required>${escapeHTML(state.drafts[scope] || '')}</textarea><button type="submit" class="primary composer-send" aria-label="发送示例消息">发送 <span aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button></div><p class="composer-disclosure">交互设计演示 · 回复为本机预设示例，不连接模型。</p></form></div>`;
  }

  function renderSetup() {
    return `<div class="setup-layout"><section class="setup-introduction"><h1>重新认识，<br>你做过的项目。</h1><p>给想法一个可以回来的地方。<br>从几个允许了解的目录开始。</p><div class="setup-steps"><div><span>发现</span><p>逐步认识散落的项目</p></div><div><span>记住</span><p>为每个项目留下独立档案</p></div><div><span>再出发</span><p>有了有用的参考，再请你回来</p></div></div></section><section class="setup-form-sheet" aria-labelledby="directory-title"><h2 id="directory-title">带入一份项目目录</h2><p class="form-disclosure">设计演示 · 输入不会读取本机目录。</p><form id="directory-form"><label for="demo-directory">示例目录路径</label><input id="demo-directory" name="directory" type="text" placeholder="例如 /Projects/ideas" maxlength="200" autocomplete="off" required><p class="field-hint">此处只保存一条演示记录，不授予真实访问权限。</p><label class="checkbox-label" for="directory-confirm"><input id="directory-confirm" name="confirm" type="checkbox" required><span>我了解这是模拟添加，不会扫描文件</span></label><button type="submit" class="primary">添加示例目录 <span aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button></form>${state.directories.length ? `<div class="demo-directories"><h3>本原型中的示例目录</h3><ul>${state.directories.map(directory => `<li>${escapeHTML(directory)}</li>`).join('')}</ul><button type="button" class="evidence-link" data-action="back-projects">打开示例项目库 <svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button></div>` : ''}<details class="setup-details"><summary>读取范围与后续设置</summary><p>目标产品只在授权范围内了解项目，跳过依赖缓存、构建产物及排除目录。模型外发、公开研究与本机通知分别设置。</p><p>本设计原型未配置这些能力，不会访问模型、网络或系统通知。</p></details></section></div>`;
  }

  function renderSettings() {
    return `${pageHeading('留一点空间给自己', '让后台有节奏地工作，也让你随时能作主。')}
      <div class="settings-list"><section class="setting-row"><div><h2>后台资源策略 <span>演示</span></h2><p>${state.busy ? '忙碌演示：暂缓新任务，保留示例进度。' : '空闲演示：展示资源允许时的工作状态。'}</p></div><button type="button" class="secondary" data-action="busy">切换为${state.busy ? '空闲' : '忙碌'}演示</button></section><section class="setting-row"><div><h2>项目目录</h2><p>${state.directories.length ? `已添加 ${state.directories.length} 条原型目录记录，均未读取文件。` : '可以体验目录如何加入；原型不会读取本机文件。'}</p></div><button type="button" class="secondary" data-action="setup">体验目录授权 <span aria-hidden="true"><svg class="action-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></button></section><section class="setting-row"><div><h2>模型与公开研究</h2><p>未配置。所有判断与回复均来自合成示例资料，不会发生外发或费用。</p></div><span class="setting-value">未连接</span></section><section class="setting-row"><div><h2>本机通知</h2><p>原型不请求通知权限，也不发送系统通知。真实产品会由你决定何时接收。</p></div><span class="setting-value">未启用</span></section><section class="setting-row"><div><h2>阅览模式</h2><p>浅色与深色保留相同的信息层级。</p></div><button type="button" class="secondary" data-action="theme">切换为${state.theme === 'dark' ? '浅色' : '深色'}</button></section></div><p class="quiet-note">忙闲切换只改变演示状态，不检测系统负载，不启动后台任务。</p>`;
  }

  function syncShell() {
    document.documentElement.dataset.theme = state.theme;
    const themeButton = document.getElementById('theme-toggle');
    if (themeButton) { themeButton.setAttribute('aria-label', `切换为${state.theme === 'dark' ? '浅色' : '深色'}阅览`); themeButton.setAttribute('aria-pressed', String(state.theme === 'dark')); themeButton.dataset.theme = state.theme; }
    const busyButton = document.getElementById('busy-toggle');
    if (busyButton) { busyButton.setAttribute('aria-label', `当前${state.busy ? '忙碌' : '空闲'}演示，点击切换`); busyButton.setAttribute('aria-pressed', String(state.busy)); busyButton.dataset.busy = String(state.busy); const label = busyButton.querySelector('[data-busy-label]'); if (label) label.textContent = state.busy ? '忙碌演示 · 暂缓新任务' : '空闲演示 · 慢慢了解'; }
    const labels = { discover: '发现', projects: '项目库', dossier: '项目档案', conversation: '对话', setup: '目录授权演示', settings: '偏好设置' };
    const pageLocation = document.getElementById('page-location');
    if (pageLocation) pageLocation.textContent = route.project ? `${labels[route.view]} / ${projects[route.project].name}` : labels[route.view];
    const navView = route.view === 'dossier' ? 'projects' : route.view === 'setup' ? 'settings' : route.view;
    document.querySelectorAll('nav [data-route]').forEach(button => {
      const current = button.dataset.route === navView;
      button.classList.toggle('is-active', current);
      if (current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    document.title = `${labels[route.view]} · Hearth 续页设计原型`;
  }

  function render(focusMain = false) {
    syncShell();
    main.dataset.view = route.view;
    main.dataset.renderHash = location.hash;
    main.innerHTML = ({ discover: renderDiscover, projects: renderProjects, dossier: renderDossier, conversation: renderConversation, setup: renderSetup, settings: renderSettings }[route.view] || renderDiscover)();
    main.classList.remove('view-enter');
    if (focusMain) { void main.offsetWidth; main.classList.add('view-enter'); }
    if (focusMain) { main.focus({ preventScroll: true }); main.scrollTop = 0; window.scrollTo({ top: 0 }); }
  }
  function openEvidence(projectId, trigger) {
    const project = projects[projectId] || projects.fragments;
    previousEvidenceTrigger = trigger;
    evidenceContent.innerHTML = `<div class="evidence-header"><span class="evidence-kind">合成档案 / ${escapeHTML(project.name)}</span><h2 id="evidence-title">这条判断从哪里来</h2><p>这里只解释原型中的示例判断，不代表真实项目分析或联网研究。</p></div><div class="evidence-body"><section><h3>已给定的示例材料</h3><ul>${project.pieces.map(piece => `<li>${escapeHTML(piece)}</li>`).join('')}</ul><pre>${escapeHTML(project.excerpt)}</pre></section><section><h3>这次的示例推断</h3><p>${escapeHTML(project.description)}</p></section><section><h3>尚不知道的部分</h3><p>${escapeHTML(project.uncertainty)}</p></section><section class="source-note"><h3>研究来源状态</h3><p>示例研究笔记 R-03 · 尚未连接外部来源</p><p>原型没有研究过真实市场、论文或开源项目；这里没有可据以决策的真实外部引用。</p></section></div>`;
    dialog.setAttribute('aria-labelledby', 'evidence-title');
    if (!dialog.open) dialog.showModal();
    closeEvidence.focus();
  }
  function closeDialog() {
    dialog.close();
    if (previousEvidenceTrigger?.isConnected) previousEvidenceTrigger.focus();
  }
  function toggleBusy() { state.busy = !state.busy; save(); syncShell(); if (route.view === 'settings') render(); toast(state.busy ? '已切换到忙碌演示，真实后台任务不会被启动或暂停。' : '已切换到空闲演示，不检测电脑资源。'); }
  function toggleTheme() { state.theme = state.theme === 'dark' ? 'light' : 'dark'; save(); syncShell(); if (route.view === 'settings') render(); }
  function exampleReply(text, scope) {
    if (scope !== 'all') {
      const project = projects[scope];
      if (/归档|删|放弃/.test(text)) return `按「${project.name}」的合成档案，现在还不足以替你决定去留。可以先保留材料，并把你不想继续的原因记下来。\n\n这是示例答复，不会归档、移动或删除项目。`;
      if (/目标|当时|为什么|初衷|思路|记忆/.test(text)) return `这份示例材料留下的念头是：“${project.idea}”\n\n${project.uncertainty}\n\n如果你愿意，可以补充当时最想解决的那个具体问题。`;
      return `我们可以先从这一点继续：${project.question}\n\n${project.description}\n\n这条回复使用原型里的合成资料，没有读取代码或进行真实研究。`;
    }
    if (/归档|保留|放弃|删/.test(text)) return '按这三份合成档案，「旧途」适合先保留观察，「潮汐」还需要找回使用目标；「片段」可以先聊一个较小的验证方向。\n\n这些只是设计示例中的条件化建议。存在成熟同类、或者项目搁置很久，都不能单独证明它没有继续的价值。';
    if (/片段/.test(text)) return '「片段」留下的线索是让摘录能在之后再次被看见。示例建议先把“保存与回访”连起来，其他功能可以稍后再判断。\n\n你可以从项目库翻开它的档案，再围绕这个项目继续聊。';
    return '从示例项目里看，「片段」有一个可以缩小验证的方向；「旧途」还需要明确要留住路线还是故事；「潮汐」需要先补充当时的使用动机。\n\n这是一条本机预设的示例答复。真实产品会根据获准读取的项目记忆与研究来回答，并说明尚未覆盖的部分。';
  }

  document.addEventListener('click', event => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;
    const nav = element.closest('[data-route]');
    if (nav) { navigate(`#${nav.dataset.route}`); return; }
    if (element.closest('#theme-toggle')) { toggleTheme(); return; }
    if (element.closest('#busy-toggle')) { toggleBusy(); return; }
    if (element.closest('#setup-link')) { event.preventDefault(); navigate('#setup'); return; }
    if (element.closest('#close-evidence')) { closeDialog(); return; }
    const button = element.closest('[data-action]');
    if (!button) return;
    const id = projectIds.includes(button.dataset.project) ? button.dataset.project : 'fragments';
    switch (button.dataset.action) {
      case 'open-project-chat': navigate(`#conversation/${id}`); break;
      case 'global-chat': navigate('#conversation'); break;
      case 'open-dossier': navigate(`#project/${id}/overview`); break;
      case 'back-projects': navigate('#projects'); break;
      case 'setup': navigate('#setup'); break;
      case 'dossier-tab': navigate(`#project/${id}/${button.dataset.tab}`); break;
      case 'evidence': openEvidence(id, button); break;
      case 'defer': if (!state.deferred.includes(id)) state.deferred.push(id); save(); render(true); toast(`已在演示中记下：稍后看「${projects[id].name}」。`); break;
      case 'restore': state.deferred = []; save(); render(true); toast('示例线索已恢复，可重新查看。'); break;
      case 'restore-project': state.deferred = state.deferred.filter(value => value !== id); save(); render(true); toast('这条示例线索已恢复。'); break;
      case 'keep-project': if (!state.kept.includes(id)) state.kept.push(id); save(); render(); toast(`已记下「${projects[id].name}」的示例方向，未执行任何项目操作。`); break;
      case 'prompt': { const input = document.getElementById('conversation-input'); if (input) { input.value = button.dataset.prompt || ''; state.drafts[activeScope()] = input.value; save(); input.focus(); } break; }
      case 'busy': toggleBusy(); break;
      case 'theme': toggleTheme(); break;
      default: break;
    }
  });

  document.addEventListener('keydown', event => {
    if (event.target instanceof HTMLTextAreaElement && event.target.id === 'conversation-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.target.form?.requestSubmit(); }
  });
  document.addEventListener('input', event => {
    if (event.target instanceof HTMLTextAreaElement && event.target.id === 'conversation-input') {
      state.drafts[activeScope()] = event.target.value.slice(0, 2000);
      save();
    }
  });
  document.addEventListener('submit', event => {
    if (!(event.target instanceof HTMLFormElement)) return;
    if (event.target.id === 'conversation-form') {
      event.preventDefault();
      const input = document.getElementById('conversation-input');
      const text = input?.value.trim();
      if (!text) return;
      const scope = activeScope();
      const messages = state.messages[scope] || [];
      messages.push({ role: 'user', text: text.slice(0, 2000) }, { role: 'assistant', text: exampleReply(text, scope) });
      state.messages[scope] = messages.slice(-16);
      state.drafts[scope] = '';
      save();
      render();
      const nextInput = document.getElementById('conversation-input');
      nextInput?.focus({ preventScroll: true });
      const transcript = main.querySelector('.chat-transcript');
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    } else if (event.target.id === 'directory-form') {
      event.preventDefault();
      const input = document.getElementById('demo-directory');
      const confirmation = document.getElementById('directory-confirm');
      const directory = input?.value.trim();
      if (!directory || !confirmation?.checked) return;
      if (!state.directories.includes(directory)) state.directories.push(directory.slice(0, 200));
      state.directories = state.directories.slice(-8);
      save();
      render();
      toast('示例目录已加入原型记录。没有读取文件或启动扫描。');
      main.querySelector('.demo-directories')?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
  window.addEventListener('hashchange', () => { route = parseHash(); render(true); });
  window.addEventListener('beforeunload', () => { rememberDraft(); save(); });
  route = parseHash();
  if (!location.hash) history.replaceState(null, '', '#discover');
  render();
})();
