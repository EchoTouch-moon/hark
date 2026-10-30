import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useThreads } from '../app/AppShell';
import { fetchObserverDetail, fetchObserverProjects, type ObserverDetail, type ObserverProjectSummary } from '../features/observer';
import { fetchAnalysisRuns, type AnalysisRun } from '../features/analysis';
import { formatDateTime } from '../features/runs';
import { observationJudgment } from '../features/projectJudgment';
import { AnalysisLaunch } from './AnalysisLaunch';
import { RecommendationCard } from './RecommendationCard';
import './ProjectConversation.css';

/** Project selection only reads the registry. Opening a thread never grants observation. */
export function ProjectStart({ enabled = true }: { enabled?: boolean }) {
  const { openProject, threadsReady, threadsError, refreshThreads } = useThreads();
  const [params] = useSearchParams();
  const requested = params.get('project');
  const [projects, setProjects] = useState<ObserverProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void fetchObserverProjects(controller.signal).then(list => {
      if (!controller.signal.aborted) setProjects(list);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '项目加载失败，请重试');
    });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!requested || !enabled || !threadsReady || threadsError || attempted.current === requested) return;
    attempted.current = requested;
    setOpening(requested);
    void openProject(requested).catch(cause => {
      setError(cause instanceof Error ? cause.message : '无法进入项目，请重新选择');
      setOpening(null);
    });
  }, [requested, enabled, threadsReady, threadsError, openProject, retry]);

  async function choose(id: string) {
    setOpening(id);
    setError(null);
    try { await openProject(id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法进入项目，请重试'); setOpening(null); }
  }

  return <section className="project-start" aria-labelledby="project-start-title" aria-busy={opening !== null}>
    <h1 id="project-start-title">先带入一个项目，<br />再一起看下一步。</h1>
    <p className="project-start__intro">从项目的真实变化开始，让每次讨论都有依据。</p>
    {projects === null && !error ? <p role="status">正在读取本地项目…</p> : null}
    {projects && projects.length > 0 ? <ul className="project-start__list">{projects.map(project => <li key={project.id}>
      <button type="button" disabled={opening !== null || !threadsReady || !!threadsError} onClick={() => void choose(project.id)}>
        <span>{project.name}</span><span>{opening === project.id ? '正在进入…' : '继续讨论 →'}</span>
      </button>
    </li>)}</ul> : null}
    {error || threadsError ? <div className="project-start__error" role="alert"><p>{error ?? threadsError}</p><button type="button" onClick={() => { attempted.current = null; setRetry(n => n + 1); void refreshThreads(); }}>重新读取</button></div> : null}
    <Link className="btn btn-primary" to="/projects">{projects?.length ? '带入另一个项目' : '添加本地项目'}</Link>
    <p className="project-start__boundary">由你选择本地 Git 仓库并确认只读范围。<br />不会修改代码、运行测试或自动调用模型。</p>
  </section>;
}

/** Real observation and explicit analysis share the conversation space; chat stays labelled Mock. */
export function ProjectFocus({ projectId, onReady }: { projectId: string; onReady: (id: string | null) => void }) {
  const [state, setState] = useState<{ id: string; detail: ObserverDetail; run: AnalysisRun | null; historyError: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const historyGeneration = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++historyGeneration.current;
    onReady(null);
    setError(null);
    void (async () => {
      try {
        const detail = await fetchObserverDetail(projectId, controller.signal);
        if (controller.signal.aborted) return;
        setState({ id: projectId, detail, run: null, historyError: null });
        onReady(projectId);
        try {
          const runs = await fetchAnalysisRuns(projectId, controller.signal);
          if (!controller.signal.aborted && historyGeneration.current === generation) setState({ id: projectId, detail, run: runs.find(run => run.projectId === projectId) ?? null, historyError: null });
        } catch {
          if (!controller.signal.aborted && historyGeneration.current === generation) setState({ id: projectId, detail, run: null, historyError: '分析记录暂时无法读取，可重新读取。' });
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '项目来源无法读取');
      }
    })();
    return () => controller.abort();
  }, [projectId, retry, onReady]);
  const current = state?.id === projectId ? state : null;
  if (error) return <section className="project-focus" role="alert"><p>项目暂时无法读取：{error}</p><button type="button" className="btn btn-ghost" onClick={() => setRetry(n => n + 1)}>重新读取</button><Link to="/projects">重新选择项目</Link></section>;
  if (!current) return <p className="project-focus" role="status">正在确认项目与观察范围…</p>;
  const { detail, run } = current;
  const href = `/observe/${encodeURIComponent(projectId)}`;
  return <section className="project-focus" aria-label="当前项目与观察结论">
    <header className="project-focus__identity"><Link to={href}>{detail.project.name}</Link><span>只读观察 · {detail.project.enabled ? '已启用' : '已暂停'}</span></header>
    <p className="project-focus__time">{detail.health.lastSuccessAt ? `最近成功观察 ${formatDateTime(detail.health.lastSuccessAt)}` : '尚无成功观察记录'}</p>
    {run ? <RecommendationCard key={run.id} run={run} observeHref={href} /> : <p className="project-focus__judgment">{observationJudgment(detail)}</p>}
    <details className="project-focus__details" key={projectId}>
      <summary>查看观察依据与分析入口</summary>
      <div className="project-focus__evidence">
        <p>以上观察只描述已取得的记录，不代表项目健康或完成度。聊天回复仍是离线演示，不会自行读取代码或形成真实模型判断。</p>
        <Link to={href}>查看观察时间、来源和缺口 →</Link>
        <AnalysisLaunch input={{ projectId, trigger: 'project' }} label="分析这个项目（先确认调用方式）" disabled={!detail.snapshot || detail.health.collectionStatus === 'UNAVAILABLE'} onComplete={next => { historyGeneration.current++; setState(previous => previous?.id === projectId ? { ...previous, run: next, historyError: null } : previous); }} />
        <p>分析由你主动发起：Mock 会明确标记；真实模型保留内容预览与本次同意。不会修改项目。</p>
      </div>
    </details>
    {current.historyError ? <p className="project-focus__history-error" role="status">{current.historyError} <button type="button" onClick={() => setRetry(n => n + 1)}>重新读取</button></p> : null}
  </section>;
}
