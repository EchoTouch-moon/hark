import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorState } from '../components';
import { fetchOverview, type OverviewResponse, OVERVIEW_STATUS_LABELS } from '../features/overview';
import { fetchChatHistory, sendChatMessage, type ChatMessage } from '../features/chat';
import './HomePage.css';
const REFRESH_INTERVAL_MS = 3000;

export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('projectId') ?? undefined;

  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFetchingRef = useRef(false);

  const loadData = useCallback(
    async (isBackground = false) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      if (!isBackground) setLoading(true);

      try {
        const res = await fetchOverview(projectId);
        setData(res);
        setError(null);
      } catch (err) {
        if (!isBackground) {
          setError(err instanceof Error ? err.message : '获取今日概览失败');
        }
      } finally {
        isFetchingRef.current = false;
        if (!isBackground) setLoading(false);
      }
    },
    [projectId],
  );

  // 初次加载与参数变化加载
  useEffect(() => {
    loadData(false);
  }, [loadData]);

  // 3 秒只读不重叠静默轮询 + 后台暂停 + 切回前台立即刷新
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadData(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData(true);
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadData]);

  const handleProjectFilterChange = (selectedId: string) => {
    const next = new URLSearchParams(searchParams);
    if (!selectedId) {
      next.delete('projectId');
    } else {
      next.set('projectId', selectedId);
    }
    setSearchParams(next, { replace: true });
  };

  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetchChatHistory(abort.signal).then(result => setMessages(result.messages)).catch(() => {
      if (!abort.signal.aborted) setChatError('会话记录暂时无法读取，可前往对话页重试。');
    });
    return () => { abort.abort(); controller.current?.abort(); };
  }, []);
  async function send() {
    if (sending || !draft.trim()) return;
    const text = draft.trim();
    setSending(true); setChatError(null);
    const abort = new AbortController(); controller.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 30000);
    try {
      await sendChatMessage(text, abort.signal);
      const history = await fetchChatHistory(abort.signal);
      setMessages(history.messages); setDraft(''); setHistoryOpen(true);
    } catch (err) {
      setChatError(abort.signal.aborted ? '已停止等待。消息可能已保存在本地，请查看会话记录后重试。' : err instanceof Error ? err.message : '发送失败，请重试');
    } finally { window.clearTimeout(timer); setSending(false); }
  }
  function prompt(text: string) { setDraft(text); inputRef.current?.focus(); }
  const focus = data?.prioritizedInsights.items[0];
  const summary = data?.summary;
  const degraded = data && Object.values(data.sectionsAvailability).some(value => value !== 'AVAILABLE');
  return (
    <section className="hearth-focus" aria-label="Hearth 对话工作台">
      <div className="focus-landscape" aria-hidden="true"><div className="focus-sun"/><div className="mountain mountain-back"/><div className="mountain mountain-front"/><div className="observatory"><i/><b/></div></div>
      <header className="focus-heading">
        <p className="focus-eyebrow">A LITTLE SPACE TO FOCUS <span>●</span></p>
        <h1>和重要的事，<br/>慢慢<span>向前。</span></h1>
        <p>把纷繁留给 Hearth，把注意力留给当下。</p>
      </header>
      <div className="focus-context">
        <span className="context-dot"/>
        <span>{loading && !data ? '正在了解当前工作状态…' : summary ? OVERVIEW_STATUS_LABELS[summary.status] : '等待连接本地工作区'}</span>
        <span className="context-divider">/</span>
        <label htmlFor="home-project-select" className="visually-hidden">项目范围</label>
        <select id="home-project-select" value={projectId ?? ''} onChange={e => handleProjectFilterChange(e.target.value)}>
          <option value="">全部项目{data ? ` · ${data.projects.length}` : ''}</option>
          {data?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {error && !data && <ErrorState message={error} onRetry={() => void loadData()} />}
      {degraded && <p role="alert" className="focus-warning">部分来源暂时不可用，当前信息可能不完整。<Link to="/projects">查看项目状态</Link></p>}
      <div className="focus-conversation">
        <div className="hearth-avatar" aria-hidden="true">⌒</div>
        <div className="focus-brief">
          <p className="focus-speaker">Hearth <span>与你一起，专注当下</span></p>
          <h2>{focus ? '眼下，这件事值得你关注。' : summary?.headline ?? '从你正在做的事开始。'}</h2>
          <p>{summary?.detail ?? '说说你想推进什么，或者先添加一个本地项目。'}</p>
          {focus ? <article className="focus-decision">
            <div className="decision-meta"><span>◈ {focus.projectName}</span><span>值得关注</span></div>
            <h3>{focus.title}</h3><p>{focus.summary}</p>
            <div className="decision-bottom"><Link to={`/insights/${focus.id}`}>查看 {focus.evidenceCount} 条依据 <span>↗</span></Link><button type="button" onClick={() => prompt(`我想进一步讨论：${focus.title}`)}>和我聊聊 <span>→</span></button></div>
          </article> : summary?.status === 'NO_PROJECTS' ? <Link className="focus-start" to="/projects">添加第一个项目 <span>↗</span></Link> : null}
          {data && data.prioritizedInsights.totalOpenCount > 1 && <Link className="focus-more" to="/insights">另外 {data.prioritizedInsights.totalOpenCount - 1} 件事，等你想看时再展开 →</Link>}
        </div>
      </div>
      {messages.length > 0 && <details className="focus-history" open={historyOpen} onToggle={e => setHistoryOpen(e.currentTarget.open)}><summary>继续上次的对话 · {messages.length} 条消息</summary><div className="focus-messages" aria-live="polite">{messages.map(m => <article key={m.id} className={m.role === 'user' ? 'focus-message is-user' : 'focus-message'}><span>{m.role === 'user' ? '你' : 'Hearth · 离线演示'}</span><p>{m.content}</p></article>)}</div><Link to="/chat">打开完整会话 ↗</Link></details>}
      <div className="focus-compose-area">
        <div className="focus-prompts">{['帮我梳理下一步', '我想讨论一个新想法', '先聊聊当前的工作'].map(text => <button type="button" key={text} onClick={() => prompt(text)}>{text} <span>↗</span></button>)}</div>
        {chatError && <p className="focus-warning" role="alert">{chatError} <Link to="/chat">查看会话记录</Link></p>}
        <form className="focus-composer" onSubmit={e => { e.preventDefault(); void send(); }}>
          <span className="composer-spark" aria-hidden="true">✦</span>
          <label htmlFor="focus-input" className="visually-hidden">告诉 Hearth 你想做什么</label>
          <textarea id="focus-input" ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)} placeholder="告诉我，你现在想专注什么…" rows={2} maxLength={4000} disabled={sending} onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}/>
          {sending ? <button type="button" className="composer-send" aria-label="停止等待" onClick={() => controller.current?.abort()}>■</button> : <button type="submit" className="composer-send" disabled={!draft.trim()} aria-label="发送消息">↑</button>}
        </form>
        <div className="composer-footnote"><span>本地保存 · 对话为离线演示</span><span>Enter 发送 · Shift + Enter 换行</span></div>
      </div>
      <a className="focus-credit" href="https://deerflow.tech" target="_blank" rel="noreferrer">Created By Deerflow</a>
    </section>
  );
}
