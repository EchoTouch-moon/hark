import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState, PageHeader } from '../components';
import {
  fetchAllObserverEvents,
  fetchObserverProjects,
  EVENT_TYPE_LABELS,
  type ObserverEvent,
  type ObserverEventType,
  type ObserverProjectSummary,
} from '../features/observer';
import { formatDateTime } from '../features/runs';
import './ObservationsPage.css';

const REFRESH_INTERVAL_MS = 3000;

function formatEventPayload(evt: ObserverEvent): string {
  const p = evt.payload as Record<string, unknown> | null;
  if (!p) return '无详细载荷信息';

  switch (evt.type) {
    case 'PROJECT_REGISTERED':
      return `项目注册完成，路径：${String(p.canonicalPath ?? p.path ?? '')}`;
    case 'REPOSITORY_HEAD_CHANGED':
      return `HEAD 提交变化：${String(p.fromHeadSha ?? '').slice(0, 7)} → ${String(p.toHeadSha ?? '').slice(0, 7)}${p.branch ? ` (${String(p.branch)})` : ''}`;
    case 'REPOSITORY_BRANCH_CHANGED':
      return `分支切换：${String(p.fromBranch ?? '未知')} → ${String(p.toBranch ?? '未知')}`;
    case 'WORKTREE_STATE_CHANGED': {
      const wt = p.worktree as Record<string, unknown> | undefined;
      if (wt) {
        const parts: string[] = [];
        if (wt.clean) parts.push('工作区干净');
        if (Number(wt.staged) > 0) parts.push(`${wt.staged} 个暂存`);
        if (Number(wt.unstaged) > 0) parts.push(`${wt.unstaged} 个未暂存`);
        if (Number(wt.untracked) > 0) parts.push(`${wt.untracked} 个未跟踪`);
        if (wt.conflicted) parts.push('存在冲突');
        return `工作区状态：${parts.join('，') || '有变更'}`;
      }
      return '工作区文件状态变动';
    }
    case 'TEST_REPORT_UPDATED': {
      const test = p.test as Record<string, unknown> | undefined;
      if (test) {
        const res = String(test.result ?? 'UNKNOWN');
        const total = test.tests !== undefined ? `，共 ${test.tests} 个用例` : '';
        const passed = test.passed !== undefined ? `（通过 ${test.passed}` : '';
        const failed = test.failed !== undefined ? `，失败 ${test.failed}）` : '）';
        return `测试结果：${res}${total}${passed}${failed}`;
      }
      return '收到新的测试报告';
    }
    case 'REPOSITORY_UNAVAILABLE':
      return `仓库不可访问：${String(p.reason ?? p.message ?? '路径异常或未挂载')}`;
    case 'REPOSITORY_RECOVERED':
      return '仓库已恢复可访问状态';
    case 'OBSERVATION_GAP':
      return `观测空窗期：${String(p.gapDuration ?? p.duration ?? '未知时长')}`;
    case 'ADAPTER_ERROR':
      return `适配器执行错误：${String(p.error ?? p.message ?? '未知错误')}`;
    default:
      return JSON.stringify(p);
  }
}

export function ObservationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('projectId') ?? undefined;

  const [projects, setProjects] = useState<ObserverProjectSummary[]>([]);
  const [events, setEvents] = useState<ObserverEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFetchingRef = useRef(false);

  // 加载项目列表用于筛选器
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

  const loadInitial = useCallback(
    async (isBackground = false) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      if (!isBackground) setLoading(true);

      try {
        const res = await fetchAllObserverEvents({ projectId, limit: 30 });
        setEvents(res.events);
        setNextCursor(res.nextCursor);
        setError(null);
      } catch (err) {
        if (!isBackground) {
          setError(err instanceof Error ? err.message : '获取观察事件失败');
        }
      } finally {
        isFetchingRef.current = false;
        if (!isBackground) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    loadInitial(false);
  }, [loadInitial]);

  // 3 秒只读不重叠轮询 + 后台暂停 + 切回前台立即刷新
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadInitial(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadInitial(true);
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadInitial]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchAllObserverEvents({
        projectId,
        cursor: nextCursor,
        limit: 30,
      });
      setEvents((prev) => [...prev, ...res.events]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载更多事件失败');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleProjectFilter = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (!id) {
      next.delete('projectId');
    } else {
      next.set('projectId', id);
    }
    setSearchParams(next, { replace: true });
  };

  const projectNameMap = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <section className="page observations-page">
      <PageHeader
        title="观察记录"
        subtitle="本地观察事件客观时间线 · 零未授权模型调用"
        actions={
          <div className="obs-filter-bar">
            <label htmlFor="obs-project-select" className="obs-filter-label">
              项目范围：
            </label>
            <select
              id="obs-project-select"
              className="obs-filter-select"
              value={projectId ?? ''}
              onChange={(e) => handleProjectFilter(e.target.value)}
            >
              <option value="">全部项目 ({projects.length})</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {loading && events.length === 0 ? (
        <div className="obs-loading" role="status">正在加载观察事件时间线…</div>
      ) : error && events.length === 0 ? (
        <ErrorState message={error} onRetry={() => loadInitial(false)} />
      ) : events.length === 0 ? (
        <EmptyState
          title="暂无观察记录"
          hint="当已登记项目产生 Git 提交、分支切换或测试报告变动后，事件将自动记录于此。"
        />
      ) : (
        <div className="obs-timeline-container">
          <ul className="obs-timeline">
            {events.map((evt) => {
              const typeLabel =
                EVENT_TYPE_LABELS[evt.type as ObserverEventType] ?? evt.type;
              const projName = projectNameMap.get(evt.projectId) ?? evt.projectId;
              return (
                <li key={evt.eventId} className="obs-timeline-item">
                  <div className="obs-timeline-badge-col">
                    <span className="obs-timeline-dot" />
                    <span className="obs-timeline-line" />
                  </div>
                  <article className="obs-timeline-card">
                    <div className="obs-card-header">
                      <time className="obs-card-time">{formatDateTime(evt.observedAt)}</time>
                      <span className="obs-card-proj">
                        <Link to={`/observe/${evt.projectId}`}>{projName}</Link>
                      </span>
                      <span className="obs-card-type">{typeLabel}</span>
                      <span className="obs-card-source">源: {evt.evidence.source}</span>
                      <span className="obs-card-quality">质量: {evt.evidence.quality}</span>
                    </div>
                    <p className="obs-card-summary">{formatEventPayload(evt)}</p>
                  </article>
                </li>
              );
            })}
          </ul>

          {nextCursor ? (
            <div className="obs-load-more-wrap">
              <button
                type="button"
                className="obs-btn-load-more"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? '正在加载更多…' : '加载更多历史记录'}
              </button>
            </div>
          ) : (
            <div className="obs-end-hint">已加载全部观察记录</div>
          )}
        </div>
      )}
    </section>
  );
}
