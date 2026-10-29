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
  setObserverEnabled,
  testLabel,
  worktreeLabel,
  type ObserverProjectSummary,
} from '../features/observer';
import { formatDateTime } from '../features/runs';
import { fetchInsightSummary } from '../features/insights';
import './ProjectsPage.css';

export function ProjectsPage() {
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
  const [registerMessage, setRegisterMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchProjects(controller.signal);
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
  }, [reloadKey]);

  const retry = useCallback(() => {
    setProjects(null);
    setObserved(null);
    setError(null);
    setObserverError(null);
    setReloadKey((key) => key + 1);
  }, []);

  async function onRegister(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!confirmed) {
      setRegisterMessage('请先确认将把该路径加入只读观察。');
      return;
    }
    setRegistering(true);
    setRegisterMessage(null);
    try {
      await registerObserverProject({
        localPath: path.trim(),
        name: name.trim() === '' ? undefined : name.trim(),
        reports:
          reportPath.trim() === ''
            ? undefined
            : [{ format: 'junit-xml', relativePath: reportPath.trim() }],
      });
      setPath('');
      setName('');
      setReportPath('');
      setConfirmed(false);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setRegisterMessage(cause instanceof Error ? cause.message : '注册失败');
    } finally {
      setRegistering(false);
    }
  }

  async function onToggle(project: ObserverProjectSummary, enabled: boolean): Promise<void> {
    try {
      await setObserverEnabled(project.id, enabled);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setObserverError(cause instanceof Error ? cause.message : '更新观察开关失败');
    }
  }

  const showLoading = projects === null && error === null;

  return (
    <section className="page">
      <PageHeader title="项目" subtitle="本地仓库观察事实 + Hearth 已授权的任务项目" />

      <div className="page-section" aria-label="本地仓库观察">
        <p className="page-section-title">本地仓库观察</p>
        <form className="card obs-register" onSubmit={onRegister}>
          <p className="obs-register-lead">
            只读采集 Git 状态与已声明的 JUnit 报告。不会运行测试、不会改仓库、不会访问网络。
          </p>
          <div className="obs-register-grid">
            <label htmlFor={`${formId}-path`}>
              本地 Git 路径
              <input
                id={`${formId}-path`}
                type="text"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/Users/you/src/my-repo"
                required
                autoComplete="off"
              />
            </label>
            <label htmlFor={`${formId}-name`}>
              显示名称（可选）
              <input
                id={`${formId}-name`}
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label htmlFor={`${formId}-report`}>
              JUnit 报告相对路径（可选）
              <input
                id={`${formId}-report`}
                type="text"
                value={reportPath}
                onChange={(event) => setReportPath(event.target.value)}
                placeholder="reports/junit.xml"
                autoComplete="off"
              />
            </label>
          </div>
          <label className="obs-confirm" htmlFor={`${formId}-confirm`}>
            <input
              id={`${formId}-confirm`}
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            我确认将该本地路径加入只读观察
          </label>
          <div className="obs-register-actions">
            <button className="btn btn-primary" type="submit" disabled={registering || path.trim() === ''}>
              {registering ? '正在注册…' : '注册观察'}
            </button>
            {registerMessage ? <p className="obs-register-msg">{registerMessage}</p> : null}
          </div>
        </form>

        {observerError !== null ? <ErrorState message={observerError} onRetry={retry} /> : null}
        {observed === null ? (
          <div className="project-grid" aria-hidden="true">
            <div className="skeleton skeleton-tile" />
          </div>
        ) : observed.length === 0 ? (
          <EmptyState title="还没有观察中的仓库" hint="登记一个本地 Git 仓库后，这里会显示分支、HEAD、工作区与测试证据。" />
        ) : (
          <ul className="project-grid">
            {observed.map((project) => {
              const test = testLabel(project.test);
              return (
                <li key={project.id}>
                  <article className="project-tile card obs-tile">
                    <Link to={`/observe/${encodeURIComponent(project.id)}`} className="obs-tile-link">
                      <span className="project-tile-name">{project.name}</span>
                      <span className="obs-tile-meta mono">
                        {project.detached ? 'detached' : project.branch ?? '—'} · {project.shortSha ?? (project.unborn ? 'UNBORN' : '—')}
                      </span>
                      <span className="obs-tile-badges">
                        <span className={`status-badge is-${collectionTone(project.collectionStatus)}`}>
                          {COLLECTION_LABELS[project.collectionStatus]}
                        </span>
                        <span className={`status-badge is-${project.collectionStatus === 'UNAVAILABLE' ? 'danger' : project.worktree?.conflicted ? 'danger' : project.worktree?.clean ? 'info' : 'warning'}`}>
                          {project.collectionStatus === 'UNAVAILABLE'
                            ? '不可用'
                            : worktreeLabel(project.worktree, project.unborn)}
                        </span>
                        <span className={`status-badge is-${test.tone}`}>{test.text}</span>
                      </span>
                      <span className="obs-tile-time">最近成功扫描 {formatDateTime(project.lastSuccessAt ?? undefined)}</span>
                      <span className="obs-tile-time">
                        待关注洞察 {insightCounts[project.id] ?? 0} · 详情见洞察页
                      </span>
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost obs-tile-toggle"
                      onClick={() => void onToggle(project, !project.enabled)}
                    >
                      {project.enabled ? '暂停观察' : '恢复观察'}
                    </button>
                    <Link className="btn btn-ghost" to={`/insights?projectId=${encodeURIComponent(project.id)}`}>
                      查看洞察
                    </Link>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="page-section" aria-busy={showLoading} aria-label="任务项目">
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
      </div>
    </section>
  );
}
