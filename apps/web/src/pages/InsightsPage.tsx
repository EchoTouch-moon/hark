import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState, PageHeader } from '../components';
import {
  fetchInsightSummary,
  fetchInsights,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  type EngineHealth,
  type InsightListItem,
  type InsightSeverity,
  type InsightSummary,
} from '../features/insights';
import {
  fetchAnalysisRuns,
  ANALYSIS_STATUS_LABEL,
  type AnalysisRun,
} from '../features/analysis';
import {
  fetchObserverProjects,
  type ObserverProjectSummary,
} from '../features/observer';
import { formatDateTime } from '../features/runs';
import './InsightsPage.css';

const STATUS_FILTERS = [
  { id: 'open', label: '待关注', status: 'OPEN,ACKNOWLEDGED' },
  { id: 'all-open', label: '含已处理', status: 'OPEN,ACKNOWLEDGED,DISMISSED,RESOLVED,WITHDRAWN' },
] as const;

const SEVERITY_FILTERS: Array<{ id: 'all' | InsightSeverity; label: string }> = [
  { id: 'all', label: '全部级别' },
  { id: 'important', label: '重要' },
  { id: 'attention', label: '值得注意' },
  { id: 'info', label: '提示' },
];

function emptyCopy(health: EngineHealth): { title: string; hint: string } {
  if (health === 'NOT_EVALUATED') {
    return { title: '尚未评估洞察', hint: '这里空着不代表项目没有问题，只是还没有完成规则评估。' };
  }
  if (health === 'DEGRADED') {
    return { title: '洞察引擎降级', hint: '来源可能已删除、过期或冻结。不会把缺失证据显示成正常。' };
  }
  return { title: '当前没有需要关注的洞察', hint: '这不等于测试全部通过，也不等于项目进度正常。' };
}

export function InsightsPage() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get('projectId') ?? undefined;
  const filterId = params.get('filter') === 'all-open' ? 'all-open' : 'open';
  const tab = params.get('tab') === 'history' ? 'history' : 'insights';
  const severityParam = params.get('severity');
  const severity: InsightSeverity | undefined =
    severityParam === 'important' || severityParam === 'attention' || severityParam === 'info'
      ? severityParam
      : undefined;

  const [items, setItems] = useState<InsightListItem[] | null>(null);
  const [historyRuns, setHistoryRuns] = useState<AnalysisRun[] | null>(null);
  const [projects, setProjects] = useState<ObserverProjectSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<InsightSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const isFetchingRef = useRef(false);

  const status = STATUS_FILTERS.find((item) => item.id === filterId)?.status;

  // 加载项目列表用于项目名称映射
  useEffect(() => {
    let active = true;
    fetchObserverProjects()
      .then((res) => {
        if (active) setProjects(res);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) {
      map.set(p.id, p.name);
    }
    return map;
  }, [projects]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      try {
        if (tab === 'insights') {
          const [page, nextSummary] = await Promise.all([
            fetchInsights({ projectId, status, severity, limit: 20 }, signal),
            fetchInsightSummary(signal),
          ]);
          setItems(page.items);
          setNextCursor(page.nextCursor);
          setSummary(nextSummary);
        } else {
          // tab === 'history'
          if (projectId) {
            const runs = await fetchAnalysisRuns(projectId, signal);
            setHistoryRuns(runs);
          } else if (projects.length > 0) {
            const allRuns = await Promise.all(
              projects.map((p) =>
                fetchAnalysisRuns(p.id, signal).catch(() => [] as AnalysisRun[]),
              ),
            );
            const flat = allRuns.flat().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
            setHistoryRuns(flat);
          } else {
            setHistoryRuns([]);
          }
        }
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(cause instanceof Error ? cause.message : '加载失败');
      } finally {
        isFetchingRef.current = false;
      }
    },
    [projectId, status, severity, tab, projects],
  );

  useEffect(() => {
    const controller = new AbortController();
    if (tab === 'insights') setItems(null);
    else setHistoryRuns(null);
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  // 3 秒只读不重叠轮询 + 后台暂停 + 切回前台立即刷新
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        if (loadingMore || (items?.length ?? 0) > 20) return;
        void load();
      }
    }, 3000);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [load, loadingMore, items?.length]);

  async function loadMore(): Promise<void> {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchInsights({ projectId, status, severity, cursor: nextCursor, limit: 20 });
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载更多失败');
    } finally {
      setLoadingMore(false);
    }
  }

  const health = summary?.engineHealth ?? 'NOT_EVALUATED';
  const empty = useMemo(() => emptyCopy(health), [health]);
  const filteredCount = projectId
    ? summary?.projects.find((item) => item.projectId === projectId)?.openCount ?? 0
    : summary?.openCount ?? 0;

  function updateParams(mutate: (next: URLSearchParams) => void): void {
    const next = new URLSearchParams(params);
    mutate(next);
    setParams(next, { replace: true });
  }

  return (
    <section className="page">
      <PageHeader
        title="洞察"
        subtitle="只展示有证据的候选事项。普通 Git 变化不会出现在这里。"
        actions={
          <span className="badge badge-notice">
            {health === 'NOT_EVALUATED' ? '未评估' : health === 'DEGRADED' ? '来源降级' : `待关注 ${filteredCount}`}
          </span>
        }
      />

      <div className="insight-toolbar">
        {/* 顶层视图切换：发现 vs 分析历史 */}
        <div className="insight-view-tabs" role="tablist" aria-label="视图模式">
          <button
            type="button"
            className={`btn ${tab === 'insights' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => updateParams((next) => next.delete('tab'))}
          >
            发现列表
          </button>
          <button
            type="button"
            className={`btn ${tab === 'history' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => updateParams((next) => next.set('tab', 'history'))}
          >
            分析建议历史
          </button>
        </div>

        {tab === 'insights' ? (
          <>
            <div className="insight-filters" role="tablist" aria-label="状态筛选">
              {STATUS_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`btn ${filterId === item.id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() =>
                    updateParams((next) => {
                      if (item.id === 'open') next.delete('filter');
                      else next.set('filter', item.id);
                    })
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="insight-filters" role="tablist" aria-label="严重程度">
              {SEVERITY_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`btn ${(severity ?? 'all') === item.id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() =>
                    updateParams((next) => {
                      if (item.id === 'all') next.delete('severity');
                      else next.set('severity', item.id);
                    })
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {summary && summary.projects.length > 0 ? (
          <div className="insight-filters" role="tablist" aria-label="项目筛选">
            <button
              type="button"
              className={`btn ${projectId === undefined ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => updateParams((next) => next.delete('projectId'))}
            >
              全部项目
            </button>
            {summary.projects.map((item) => {
              const displayName = projectNameMap.get(item.projectId) ?? item.projectId.slice(0, 12);
              return (
                <button
                  key={item.projectId}
                  type="button"
                  className={`btn ${projectId === item.projectId ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => updateParams((next) => next.set('projectId', item.projectId))}
                >
                  {displayName} · {item.openCount}
                </button>
              );
            })}
          </div>
        ) : null}
        {projectId ? (
          <p className="insight-filter-note">
            正在筛选项目 <span className="mono">{projectNameMap.get(projectId) ?? projectId}</span>
          </p>
        ) : null}
      </div>

      {error !== null ? <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} /> : null}

      {/* 视图 1：发现列表 */}
      {tab === 'insights' ? (
        <>
          {items === null && error === null ? (
            <div className="insight-list" aria-hidden="true">
              <div className="skeleton skeleton-tile" />
              <div className="skeleton skeleton-tile" />
            </div>
          ) : null}
          {items !== null && items.length === 0 && error === null ? <EmptyState title={empty.title} hint={empty.hint} /> : null}
          {items !== null && items.length > 0 ? (
            <>
              <ul className="insight-list">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link to={`/insights/${encodeURIComponent(item.id)}`} className="card insight-card">
                      <span className="insight-card-head">
                        <span className={`status-badge is-${SEVERITY_TONE[item.severity]}`}>{SEVERITY_LABEL[item.severity]}</span>
                        <span className={`status-badge is-${STATUS_TONE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                        <span className="status-badge is-neutral">
                          {projectNameMap.get(item.projectId) ?? item.projectId.slice(0, 8)}
                        </span>
                        {item.historical ? <span className="status-badge is-neutral">历史世代 {item.streamEpoch}</span> : null}
                        {item.evidenceAvailability !== 'AVAILABLE' ? (
                          <span className="status-badge is-warning">
                            {item.evidenceAvailability === 'UNAVAILABLE' ? '来源不可用' : '证据缺失'}
                          </span>
                        ) : null}
                      </span>
                      <span className="insight-card-title">{item.title}</span>
                      <span className="insight-card-summary">{item.summary}</span>
                      <span className="insight-card-meta">
                        {formatDateTime(item.observedAt)} · {item.primaryRuleId} · 证据 {item.evidenceCount} 条
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {nextCursor !== null ? (
                <button type="button" className="btn btn-ghost" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? '加载中…' : '加载更多'}
                </button>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
        /* 视图 2：分析历史 */
        <div className="insight-history-view">
          {historyRuns === null && error === null ? (
            <div className="insight-list" aria-hidden="true">
              <div className="skeleton skeleton-tile" />
            </div>
          ) : null}
          {historyRuns !== null && historyRuns.length === 0 && error === null ? (
            <EmptyState
              title="暂无分析建议历史"
              hint="分析建议仅在用户于洞察详情页面显式确认外发预览后才会触发运行。"
            />
          ) : null}
          {historyRuns !== null && historyRuns.length > 0 ? (
            <ul className="insight-list">
              {historyRuns.map((run) => (
                <li key={run.id}>
                  <div className="card insight-card">
                    <div className="insight-card-head">
                      <span className="status-badge is-info">
                        {ANALYSIS_STATUS_LABEL[run.status] ?? run.status}
                      </span>
                      <span className="status-badge is-neutral">
                        {projectNameMap.get(run.projectId) ?? run.projectId}
                      </span>
                      <span className="status-badge is-neutral">
                        Provider: {run.provider}
                        {run.model ? ` (${run.model})` : ''}
                      </span>
                      {run.feedback ? (
                        <span className="status-badge is-success">
                          反馈: {run.feedback === 'useful' ? '有用' : '需改进'}
                        </span>
                      ) : null}
                    </div>
                    <div className="insight-card-title">
                      {run.recommendation?.statusSummary ?? `分析任务 #${run.id.slice(0, 8)}`}
                    </div>
                    {run.insightId ? (
                      <div className="insight-card-meta">
                        关联洞察：
                        <Link to={`/insights/${encodeURIComponent(run.insightId)}`}>
                          查看关联洞察 →
                        </Link>
                      </div>
                    ) : null}
                    <div className="insight-card-meta">
                      开始时间: {formatDateTime(run.startedAt)}
                      {run.usage ? ` · 耗时 ${run.usage.latencyMs}ms` : ''}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}
