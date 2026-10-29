import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorState, PageHeader } from '../components';
import { ApiError } from '../features/api/client';
import {
  acknowledgeInsight,
  dismissInsight,
  fetchInsight,
  sendInsightFeedback,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  type InsightDetail,
} from '../features/insights';
import { formatDateTime } from '../features/runs';
import './InsightsPage.css';

export function InsightDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<InsightDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (insightId: string, signal?: AbortSignal) => {
    const next = await fetchInsight(insightId, signal);
    setDetail(next);
    setError(null);
  }, []);

  useEffect(() => {
    if (id === undefined) return undefined;
    const controller = new AbortController();
    void load(id, controller.signal).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setDetail(null);
      setError(
        cause instanceof ApiError && cause.status === 404
          ? '这条洞察不存在或已被清除'
          : cause instanceof Error
            ? cause.message
            : '加载失败',
      );
    });
    return () => controller.abort();
  }, [id, load, reloadKey]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    try {
      await action();
      if (id !== undefined) await load(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  if (error !== null && detail === null) {
    return (
      <section className="page">
        <PageHeader title="洞察详情" />
        <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
      </section>
    );
  }
  if (detail === null) {
    return (
      <section className="page">
        <PageHeader title="洞察详情" />
        <div className="skeleton skeleton-tile" />
      </section>
    );
  }

  const canAck = detail.status === 'OPEN';
  const canDismiss = detail.status === 'OPEN' || detail.status === 'ACKNOWLEDGED';
  const evidenceHref = detail.observeHref.startsWith('/observe/') ? detail.observeHref : `/observe/${detail.projectId}`;

  return (
    <section className="page">
      <PageHeader
        title={detail.title}
        subtitle="有证据的候选事项。不能据此判断当前 HEAD。"
        actions={
          <span className="insight-card-head">
            <span className={`status-badge is-${SEVERITY_TONE[detail.severity]}`}>{SEVERITY_LABEL[detail.severity]}</span>
            <span className={`status-badge is-${STATUS_TONE[detail.status]}`}>{STATUS_LABEL[detail.status]}</span>
          </span>
        }
      />
      <p>
        <Link to="/insights">返回列表</Link>
        {' · '}
        <Link to={evidenceHref}>查看观察证据</Link>
      </p>
      {error !== null ? <ErrorState message={error} /> : null}

      {detail.evidenceAvailability !== 'AVAILABLE' ? (
        <ErrorState
          message={
            detail.evidenceAvailability === 'UNAVAILABLE'
              ? '来源项目已删除或流已冻结，证据不再可用。'
              : '触发证据已不在 inbox 中，不能当作仍可验证。'
          }
        />
      ) : null}
      {detail.engineFrozen ? <p className="insight-warn">该项目的规则消费已冻结，不会自动重置游标。</p> : null}
      {detail.historical ? (
        <p className="insight-warn">这是 stream epoch {detail.streamEpoch} 的历史边界记录，不代表当前世代。</p>
      ) : null}
      {detail.status === 'ACKNOWLEDGED' ? <p className="insight-filter-note">已确认看过，仍待关注。确认已看不等于已恢复。</p> : null}
      {detail.status === 'DISMISSED' ? (
        <p className="insight-filter-note">已不再关注。刷新后不会回到待关注列表，证据仍保留。</p>
      ) : null}
      {detail.status === 'RESOLVED' ? <p className="insight-filter-note">已观察到恢复证据。用户反馈不会因此被改写。</p> : null}

      <div className="card insight-detail">
        <p>{detail.summary}</p>
        <dl className="insight-dl">
          <div>
            <dt>规则</dt>
            <dd className="mono">
              {detail.primaryRuleId} v{detail.primaryRuleVersion}
            </dd>
          </div>
          <div>
            <dt>原因码</dt>
            <dd className="mono">{detail.reasonCodes.length > 0 ? detail.reasonCodes.join(', ') : '—'}</dd>
          </div>
          <div>
            <dt>主题族</dt>
            <dd className="mono">{detail.issueFamily}</dd>
          </div>
          <div>
            <dt>项目</dt>
            <dd className="mono">{detail.projectId}</dd>
          </div>
          <div>
            <dt>首次观察</dt>
            <dd>{formatDateTime(detail.firstObservedAt)}</dd>
          </div>
          <div>
            <dt>最近实质观察</dt>
            <dd>{formatDateTime(detail.observedAt)}</dd>
          </div>
          <div>
            <dt>HEAD 绑定</dt>
            <dd>未确定</dd>
          </div>
          <div>
            <dt>反馈</dt>
            <dd>{detail.feedback === 'useful' ? '有用' : detail.feedback === 'not_useful' ? '没用' : '尚未评价'}</dd>
          </div>
        </dl>
      </div>

      <div className="page-section">
        <p className="page-section-title">为什么出现</p>
        <p className="insight-card-summary">
          规则 {detail.primaryRuleId} 根据已观察证据生成这条提示。模板数据只保留有限字段，不会复述源码或本机绝对路径。
        </p>
      </div>

      <div className="page-section">
        <p className="page-section-title">证据指针</p>
        {detail.evidence.length === 0 ? (
          <EmptyState title="没有可展示的证据指针" hint="不会编造快照或报告内容。" />
        ) : (
          <ul className="insight-evidence">
            {detail.evidence.map((item) => (
              <li key={`${item.role}-${item.sourceId}`} className="card">
                <span>{item.role}</span>
                <span className="mono">
                  {item.sourceKind} {item.sourceId}
                </span>
                <span>{item.quality}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="insight-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !canAck} onClick={() => void run(() => acknowledgeInsight(detail.id))}>
          确认已看
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy || !canDismiss} onClick={() => void run(() => dismissInsight(detail.id))}>
          不再关注这条
        </button>
        <button
          type="button"
          className={`btn btn-ghost ${detail.feedback === 'useful' ? 'is-active' : ''}`}
          disabled={busy}
          onClick={() => void run(() => sendInsightFeedback(detail.id, 'useful'))}
        >
          有用
        </button>
        <button
          type="button"
          className={`btn btn-ghost ${detail.feedback === 'not_useful' ? 'is-active' : ''}`}
          disabled={busy}
          onClick={() => void run(() => sendInsightFeedback(detail.id, 'not_useful'))}
        >
          没用
        </button>
      </div>
    </section>
  );
}
