/**
 * @fileoverview 项目与仓库列表页（ProjectsPage）
 * 
 * 职责：
 * 1. 展示已注册的项目概览与待处理洞察计数；
 * 2. 展示代码仓库观察器（Project Observer）的实时状态（Git 分支、工作区脏状态、测试摘要与采集健康度）；
 * 3. 提供本地 Git 仓库注册入口，支持自定义项目名称与测试报告路径；
 * 4. 支持快捷暂停/继续指定仓库的观察采集。
 */

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, PageHeader } from '../components';
import { fetchProjects, type ProjectSummary } from '../features/projects';
import {
  collectionTone,
  COLLECTION_LABELS,
  fetchObserverProjects,
  registerObserverProject,
  scanObserverProject,
  setObserverEnabled,
  testLabel,
  worktreeLabel,
  type ObserverProjectSummary,
} from '../features/observer';
import { useRuntimeMode } from '../features/runtime-mode';
import { formatDateTime } from '../features/runs';
import { fetchInsightSummary } from '../features/insights';
import { emitEmberCue } from '../features/ember-cues';
import './ProjectsPage.css';

export function ProjectsPage() {
  const {state}=useRuntimeMode();
  const demoMode=state.status==='ready' && state.legacyDemoAvailable;
  const formId = useId();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [observed, setObserved] = useState<ObserverProjectSummary[] | null>(null);
  const [insightCounts, setInsightCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [observerError, setObserverError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [reportPath, setReportPath] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [addedProjectId, setAddedProjectId] = useState<string | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [registerMessage, setRegisterMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const list = demoMode ? await fetchProjects(controller.signal) : [];
        if (!cancelled) {
          setProjects(list);
          setError(null);
        }
      } catch (cause) {
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setError(cause instanceof Error ? cause.message : '加载项目列表失败');
      }
    })();
    (async () => {
      try {
        const list = await fetchObserverProjects(controller.signal);
        if (!cancelled) {
          setObserved(list);
          setObserverError(null);
        }
      } catch (cause) {
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setObserverError(cause instanceof Error ? cause.message : '加载观察仓库失败');
        setObserved([]);
      }
    })();
    (async () => {
      try {
        const summary = await fetchInsightSummary(controller.signal);
        if (!cancelled) {
          const next: Record<string, number> = {};
          for (const row of summary.projects) next[row.projectId] = row.openCount;
          setInsightCounts(next);
        }
      } catch {
        if (!cancelled) setInsightCounts({});
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadKey, demoMode]);

  const retry = useCallback(() => {
    setProjects(null);
    setObserved(null);
    setError(null);
    setObserverError(null);
    setReloadKey((key) => key + 1);
  }, []);

  async function onRegister(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (registering) return;
    if (!confirmed) {
      setRegisterMessage('请先确认将把该路径加入只读观察。');
      return;
    }
    setRegistering(true);
    setAddedProjectId(null);
    setRegisterMessage(null);
    try {
      const added = await registerObserverProject({
        localPath: path.trim(),
        name: name.trim() === '' ? undefined : name.trim(),
        reports:
          reportPath.trim() === ''
            ? undefined
            : [{ format: 'junit-xml', relativePath: reportPath.trim() }],
      });
      emitEmberCue('project-added');
      setAddedProjectId(added.project.id);
      setPath('');
      setName('');
      setReportPath('');
      setConfirmed(false);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      emitEmberCue('failed');
      setRegisterMessage(cause instanceof Error ? cause.message : '注册失败');
    } finally {
      setRegistering(false);
    }
  }

  async function onToggle(project: ObserverProjectSummary, enabled: boolean): Promise<void> {
    setBusyProjectId(project.id);
    try {
      await setObserverEnabled(project.id, enabled);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setObserverError(cause instanceof Error ? cause.message : '更新观察开关失败');
    } finally {
      setBusyProjectId(null);
    }
  }

  async function onScanProject(project: ObserverProjectSummary): Promise<void> {
    setBusyProjectId(project.id);
    try {
      await scanObserverProject(project.id);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setObserverError(cause instanceof Error ? cause.message : '检查失败');
    } finally {
      setBusyProjectId(null);
    }
  }

  const showLoading = projects === null && error === null;

  return (
    <section className="page project-entry-page">
      <PageHeader title={observed && observed.length > 0 ? "从一个项目，继续谈。" : "先带入一个项目。"} subtitle="让谈话从有来源的事实开始。选择已有项目，或添加一个本地 Git 仓库。" />

      <div className="page-section" aria-label="本地仓库观察">
        {observerError !== null ? <ErrorState message={observerError} onRetry={retry} /> : null}
        {observed === null ? (
          <div className="project-grid" role="status" aria-label="正在加载项目"><div className="skeleton skeleton-tile" /></div>
        ) : observed.length === 0 ? (
          <p className="project-entry-empty">添加项目后，先查看实际观察，再围绕它展开谈话。</p>
        ) : (
          <div className="project-entry-existing">
            <h2 className="project-entry-section-title">选择一个已有项目</h2>
            <ul className="project-grid project-entry-list">
              {observed.map((project) => {
                const test = testLabel(project.test);
                const busy = busyProjectId === project.id;
                return (
                  <li key={project.id}>
                    <article className="project-tile obs-tile">
                      <div className="obs-tile-heading">
                        <h3 className="project-tile-name">{project.name}</h3>
                        <span className={`status-badge is-${project.enabled ? collectionTone(project.collectionStatus) : 'neutral'}`}>
                          {project.enabled ? COLLECTION_LABELS[project.collectionStatus] : '观察已暂停'}
                        </span>
                      </div>
                      <p className="obs-tile-time">{project.lastSuccessAt ? `最近成功观察 ${formatDateTime(project.lastSuccessAt)}` : '尚无成功观察记录'}</p>
                      <Link className="btn btn-primary obs-start-conversation" to={`/?project=${encodeURIComponent(project.id)}`}>围绕这个项目开始谈</Link>
                      <details className="obs-project-details">
                        <summary>查看观察范围与状态</summary>
                        <p className="mono">{project.canonicalPath}</p>
                        <p className="obs-tile-meta mono">{project.detached ? 'detached' : project.branch ?? '—'} · {project.shortSha ?? (project.unborn ? 'UNBORN' : '—')}</p>
                        <div className="obs-tile-badges">
                          <span className={`status-badge is-${project.collectionStatus === 'UNAVAILABLE' ? 'danger' : project.worktree?.conflicted ? 'danger' : project.worktree?.clean ? 'info' : 'warning'}`}>{project.collectionStatus === 'UNAVAILABLE' ? '来源不可用' : worktreeLabel(project.worktree, project.unborn)}</span>
                          <span className={`status-badge is-${test.tone}`}>{test.text}</span>
                        </div>
                        <p className="obs-tile-time">待关注洞察 {insightCounts[project.id] ?? 0}</p>
                        <div className="obs-tile-actions">
                          <button type="button" className="btn btn-ghost" disabled={busyProjectId !== null} onClick={() => void onScanProject(project)}>{busy ? '正在处理…' : '立即检查'}</button>
                          <button type="button" className="btn btn-ghost" disabled={busyProjectId !== null} onClick={() => void onToggle(project, !project.enabled)}>{project.enabled ? '暂停观察' : '恢复观察'}</button>
                          <Link className="btn btn-ghost" to={`/observe/${encodeURIComponent(project.id)}`}>查看观察证据</Link>
                          <Link className="btn btn-ghost" to={`/insights?projectId=${encodeURIComponent(project.id)}`}>查看洞察</Link>
                        </div>
                      </details>
                    </article>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <h2 className="project-entry-section-title">添加本地项目</h2>
        <form className="card obs-register" onSubmit={onRegister}>
          <p className="obs-register-lead">
            Hearth 只在本机读取这个仓库的 Git 状态。不会改动代码、运行测试或自动调用模型。
          </p>
          <div className="obs-register-grid">
            <label htmlFor={`${formId}-path`}>
              本地 Git 仓库路径
              <input
                id={`${formId}-path`}
                type="text"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/Users/you/src/my-repo"
                required
                disabled={registering}
                autoComplete="off"
              />
            </label>
            <label htmlFor={`${formId}-name`}>
              显示名称（可选）
              <input
                id={`${formId}-name`}
                type="text"
                value={name}
                disabled={registering}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
          <details className="obs-register-options">
            <summary>已有测试报告？可选添加</summary>
            <p>仅读取你声明的 JUnit 报告；没有报告时测试状态保持未知。</p>
            <label htmlFor={`${formId}-report`}>
              JUnit 报告相对路径（可选）
              <input id={`${formId}-report`} type="text" value={reportPath} disabled={registering}
                onChange={(event) => setReportPath(event.target.value)}
                placeholder="reports/junit.xml" autoComplete="off" />
            </label>
          </details>
          <label className="obs-confirm" htmlFor={`${formId}-confirm`}>
            <input
              id={`${formId}-confirm`}
              type="checkbox"
              checked={confirmed}
              disabled={registering}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            我确认将该本地路径加入只读观察
          </label>
          <div className="obs-register-actions">
            <button className="btn btn-primary" type="submit" disabled={registering || !confirmed || path.trim() === ''}>
              {registering ? '正在添加…' : '添加项目'}
            </button>
            {registerMessage ? <p className="obs-register-msg" role="alert">{registerMessage}</p> : null}
          </div>
          {addedProjectId && <div className="project-story-feedback" role="status">
            <p>项目已添加。观察结果与分析状态会如实显示；尚未调用模型。</p>
            <Link className="btn btn-primary" to={`/?project=${encodeURIComponent(addedProjectId)}`}>进入这个项目的谈话</Link>
          </div>}
        </form>

      </div>

      {demoMode ? <div className="page-section" aria-busy={showLoading} aria-label="任务项目">
        <p className="page-section-title">Hearth 任务项目</p>
        {showLoading ? (
          <div className="project-grid" aria-hidden="true">
            <div className="skeleton skeleton-tile" />
            <div className="skeleton skeleton-tile" />
          </div>
        ) : error !== null ? (
          <ErrorState message={error} onRetry={retry} />
        ) : projects !== null && projects.length === 0 ? (
          <EmptyState
            title="还没有任务项目"
            hint="初始化演示数据后，会在这里看到 Project Atlas 与 Project Beacon 两个合成项目"
          />
        ) : (
          <ul className="project-grid">
            {projects?.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/projects/${encodeURIComponent(project.id)}`}
                  className="project-tile card"
                >
                  <span className="project-tile-name">{project.name}</span>
                  <span className="project-tile-desc">{project.description}</span>
                  <span className="project-tile-more">查看项目详情 →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div> : null}
    </section>
  );
}
