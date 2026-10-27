import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { ActionCard as HearthCard, SourceRef } from '@hearth/contracts';
import { isTerminalRunState } from '@hearth/contracts';
import {
  CARD_POLL_INTERVAL_MS,
  RUN_STATE_LABEL,
  formatRelativeTime,
  useCardDetail,
  useRunDetail,
} from '../features/cards';
import './EvidenceDrawer.css';

export interface EvidenceDrawerProps {
  card: HearthCard;
  onClose: () => void;
}

const SOURCE_TYPE_LABEL: Readonly<Record<string, string>> = {
  fixture: '合成数据',
  vault: '个人库',
  github: 'GitHub',
  calendar: '日历',
  mail: '邮件',
};

const STEP_STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: '等待中',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  skipped: '跳过',
};

function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 16)}…` : hash;
}

function SourceRefRow({ source }: { source: SourceRef }) {
  return (
    <li className="evd-row">
      <span className="evd-row-title">
        <span className="evd-tag">{SOURCE_TYPE_LABEL[source.sourceType] ?? source.sourceType}</span>
        <span className="evd-uri" title={source.uri}>
          {source.uri}
        </span>
      </span>
      <span className="evd-row-meta">
        观察于 {formatRelativeTime(source.observedAt)}
        {source.contentHash ? ` · ${shortHash(source.contentHash)}` : ''}
      </span>
    </li>
  );
}

/**
 * 证据面板（页面内呈现，M1-T05）：evidence SourceRef 列表 +
 * 关联事件摘要 + run 状态 / 步骤 / sha256。数据全部来自 API，
 * run 未到终态时每 900ms 轮询刷新。
 */
export function EvidenceDrawer({ card, onClose }: EvidenceDrawerProps) {
  const { detail, loading, error, refetch } = useCardDetail(card.id);
  const run = detail?.run ?? null;
  const { payload: runDetail, refetch: refetchRun } = useRunDetail(run?.id ?? null);

  const runId = run?.id ?? null;
  const runState = run?.state ?? null;
  const runTerminal = runState !== null && isTerminalRunState(runState);

  // run 进行中时轮询（终态即停）
  useEffect(() => {
    if (runId === null || runTerminal) return undefined;
    const timer = window.setInterval(() => {
      refetch();
      refetchRun();
    }, CARD_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [runId, runTerminal, refetch, refetchRun]);

  return (
    <section className="evd" aria-label={`建议「${card.title}」的证据与执行详情`}>
      <header className="evd-header">
        <h3 className="evd-title">证据与来源</h3>
        <button
          type="button"
          className="btn btn-ghost evd-close"
          onClick={onClose}
          aria-label="关闭证据面板"
        >
          关闭
        </button>
      </header>

      <div className="evd-section">
        <p className="evd-section-title">建议依据（{card.evidence.length} 条来源）</p>
        <ul className="evd-list">
          {card.evidence.map((source, index) => (
            <SourceRefRow key={`${source.sourceId}-${index}`} source={source} />
          ))}
        </ul>
      </div>

      <div className="evd-section">
        <p className="evd-section-title">关联事件</p>
        {loading ? (
          <p className="evd-note" role="status">
            事件加载中…
          </p>
        ) : error ? (
          <p className="evd-note evd-note-error" role="alert">
            事件加载失败：{error.message}
            <button type="button" className="btn btn-ghost evd-retry" onClick={refetch}>
              重试
            </button>
          </p>
        ) : detail && detail.events.length > 0 ? (
          <ul className="evd-list">
            {detail.events.map((event) => (
              <li className="evd-row" key={event.id}>
                <span className="evd-row-title">{event.summary}</span>
                <span className="evd-row-meta">
                  {event.type} · {formatRelativeTime(event.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="evd-note">没有关联事件</p>
        )}
      </div>

      <div className="evd-section">
        <p className="evd-section-title">执行</p>
        {run === null && !loading ? (
          <p className="evd-note">尚未执行</p>
        ) : run === null ? (
          <p className="evd-note" role="status">
            执行信息加载中…
          </p>
        ) : (
          <>
            <p className={`evd-run evd-run-${run.state}`}>
              {RUN_STATE_LABEL[run.state]}
              <Link className="evd-run-link" to={`/activity/${run.id}`}>
                打开执行记录
              </Link>
            </p>
            {runDetail && runDetail.steps.length > 0 ? (
              <ol className="evd-steps">
                {runDetail.steps.map((step) => (
                  <li className="evd-step" key={step.id}>
                    <span
                      className={`evd-step-status evd-step-${step.status}`}
                      title={STEP_STATUS_LABEL[step.status] ?? step.status}
                    >
                      {STEP_STATUS_LABEL[step.status] ?? step.status}
                    </span>
                    <span className="evd-step-name" title={step.name}>
                      {step.name}
                    </span>
                    {step.detail ? (
                      <span className="evd-step-detail" title={step.detail}>
                        {step.detail}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {runDetail && runDetail.evidence.length > 0 ? (
              <ul className="evd-list">
                {runDetail.evidence.map((ev) => (
                  <li className="evd-row" key={ev.id}>
                    <span className="evd-row-title">
                      <span className="evd-tag">{ev.kind}</span>
                      <span
                        className="evd-uri"
                        title={`sha256 ${ev.sha256}${ev.artifactPath ? ` · ${ev.artifactPath}` : ''}`}
                      >
                        sha256 {shortHash(ev.sha256)}
                      </span>
                    </span>
                    <span className="evd-row-meta">
                      生成于 {formatRelativeTime(ev.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
