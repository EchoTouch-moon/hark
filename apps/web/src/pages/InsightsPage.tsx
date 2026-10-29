import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const severityParam = params.get('severity');
  const severity: InsightSeverity | undefined =
    severityParam === 'important' || severityParam === 'attention' || severityParam === 'info'
      ? severityParam
      : undefined;
  const [items, setItems] = useState<InsightListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<InsightSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const status = STATUS_FILTERS.find((item) => item.id === filterId)?.status;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const [page, nextSummary] = await Promise.all([
        fetchInsights({ projectId, status, severity, limit: 20 }, signal),
        fetchInsightSummary(signal),
      ]);
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setSummary(nextSummary);
      setError(null);
    },
    [projectId, status, severity],
  );

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    void load(controller.signal).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setItems(null);
      setError(cause instanceof Error ? cause.message : '加载洞察失败');
    });
    return () => controller.abort();
  }, [load, reloadKey]);

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
              className={`btn ${ (severity ?? 'all') === item.id ? 'btn-primary' : 'btn-ghost'}`}
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
        {summary && summary.projects.length > 0 ? (
          <div className="insight-filters" role="tablist" aria-label="项目筛选">
            <button
              type="button"
              className={`btn ${projectId === undefined ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => updateParams((next) => next.delete('projectId'))}
            >
              全部项目
            </button>
            {summary.projects.map((item) => (
              <button
                key={item.projectId}
                type="button"
                className={`btn ${projectId === item.projectId ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => updateParams((next) => next.set('projectId', item.projectId))}
              >
                {item.projectId.slice(0, 12)} · {item.openCount}
              </button>
            ))}
          </div>
        ) : null}
        {projectId ? (
          <p className="insight-filter-note">
            正在筛选项目 <span className="mono">{projectId}</span>
          </p>
        ) : null}
      </div>

      {error !== null ? <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} /> : null}
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
                    {formatDateTime(item.observedAt)} · {item.primaryRuleId} · 证据 {item.evidenceCount} · HEAD 绑定未确定
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
    </section>
  );
}
