import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorState, PageHeader } from '../components';
import { ApiError } from '../features/api/client';
import {
  CARD_STATUS_LABELS,
  cardStatusTone,
  fetchProjectSnapshot,
  type ProjectSnapshot,
} from '../features/projects';
import {
  RUN_STATE_LABELS,
  VERDICT_LABELS,
  formatDateTime,
  runStateTone,
  verdictTone,
} from '../features/runs';
import './ProjectDetailPage.css';

/** 快照请求的错误投影：404 单独处理（未知项目） */
interface LoadError {
  status: number;
  message: string;
}

/**
 * U03 项目详情（M1-T07）：
 * 全部数据来自 GET /projects/:id —— 服务端已按项目隔离，
 * 前端不做任何跨项目过滤伪装。未知项目 id → 404 ErrorState。
 */
export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (id === undefined) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchProjectSnapshot(id, controller.signal);
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
        }
      } catch (cause) {
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setSnapshot(null);
        setError({
          status: cause instanceof ApiError ? cause.status : 0,
          message: cause instanceof Error ? cause.message : '加载项目详情失败',
        });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, reloadKey]);

  const retry = useCallback(() => {
    setSnapshot(null);
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  if (id === undefined) {
    return (
      <section className="page">
        <PageHeader title="项目详情" subtitle="未指定项目" />
        <ErrorState message="缺少项目 ID，无法加载项目详情" />
      </section>
    );
  }

  const loading = snapshot === null && error === null;

  return (
    <section className="page">
      {loading || error !== null || snapshot === null ? (
        <>
          <PageHeader title="项目详情" subtitle={`项目 ${id}`} />
          <div className="page-section" aria-busy={loading} aria-label="项目快照">
            {loading ? (
              <div className="pd-skeleton-stack" aria-hidden="true">
                <div className="skeleton skeleton-block" />
                <div className="skeleton skeleton-block" />
              </div>
            ) : error !== null ? (
              <div className="pd-error-wrap">
                <ErrorState
                  message={
                    error.status === 404
                      ? `项目 ${id} 不存在（404）。它可能尚未初始化，或链接已过期。`
                      : error.message
                  }
                  onRetry={retry}
                />
                <Link className="btn btn-ghost pd-back-btn" to="/projects">
                  返回项目列表
                </Link>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <PageHeader
            title={snapshot.project.name}
            subtitle={`项目 ${snapshot.project.id} · 数据由服务端按项目隔离`}
            actions={
              <Link className="btn btn-ghost" to="/projects">
                返回列表
              </Link>
            }
          />

          <div className="page-section" aria-label="项目目的">
            <p className="page-section-title">项目目的</p>
            <div className="card pd-purpose">
              <p>{snapshot.project.description}</p>
            </div>
          </div>

          <div className="page-section" aria-label="最近事件">
            <p className="page-section-title">最近事件</p>
            {snapshot.events.length === 0 ? (
              <EmptyState title="该项目还没有事件" hint="事件由数据源进入后出现在这里" />
            ) : (
              <ul className="pd-event-list">
                {[...snapshot.events]
                  .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
                  .map((event) => (
                    <li key={event.id} className="card pd-event">
                      <div className="pd-event-head">
                        <span className="pd-event-time">{formatDateTime(event.occurredAt)}</span>
                        <span className="pd-event-type mono">{event.type}</span>
                      </div>
                      <p className="pd-event-summary">{event.summary}</p>
                      <p className="pd-event-source">来源 {event.source.uri}</p>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="page-section" aria-label="该项目的卡片">
            <p className="page-section-title">建议卡片</p>
            {snapshot.cards.length === 0 ? (
              <EmptyState title="该项目暂无卡片" hint="值得处理的事会先以卡片形式出现" />
            ) : (
              <ul className="pd-card-list">
                {snapshot.cards.map((card) => (
                  <li key={card.id} className="card pd-action-card">
                    <div className="pd-action-card-head">
                      <span className="pd-action-card-title">{card.title}</span>
                      <span className={`status-badge is-${cardStatusTone(card.status)}`}>
                        {CARD_STATUS_LABELS[card.status]}
                      </span>
                    </div>
                    <p className="pd-action-card-why">{card.whyNow}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="page-section" aria-label="该项目的执行历史">
            <p className="page-section-title">执行历史</p>
            {snapshot.runs.length === 0 ? (
              <EmptyState title="该项目还没有执行记录" hint="从卡片发起执行后，记录会出现在这里" />
            ) : (
              <ul className="pd-run-list">
                {[...snapshot.runs]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((run) => (
                    <li key={run.id}>
                      <Link
                        to={`/activity/${encodeURIComponent(run.id)}`}
                        className="card pd-run-row"
                      >
                        <span className="pd-run-time">{formatDateTime(run.createdAt)}</span>
                        <span className={`status-badge is-${runStateTone(run.state)}`}>
                          {RUN_STATE_LABELS[run.state]}
                        </span>
                        {run.verificationVerdict !== undefined ? (
                          <span className={`status-badge is-${verdictTone(run.verificationVerdict)}`}>
                            {VERDICT_LABELS[run.verificationVerdict]}
                          </span>
                        ) : (
                          <span className="pd-run-verdict-none">尚未验证</span>
                        )}
                        <span className="pd-run-open">详情 →</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
