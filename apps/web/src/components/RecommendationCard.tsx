import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ANALYSIS_STATUS_LABEL,
  sendAnalysisFeedback,
  type AnalysisRun,
  type AnalysisFeedback,
} from '../features/analysis';
import { formatDateTime } from '../features/runs';
import './RecommendationCard.css';

export function RecommendationCard({
  run,
  observeHref,
}: {
  run: AnalysisRun;
  observeHref: string;
}) {
  const [feedback, setFeedback] = useState<AnalysisFeedback | null>(run.feedback ?? null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  useEffect(() => { setFeedback(run.feedback ?? null); setFeedbackError(null); }, [run.id, run.feedback]);

  async function submitFeedback(kind: AnalysisFeedback): Promise<void> {
    setFeedbackBusy(true);
    setFeedbackError(null);
    try {
      setFeedback(await sendAnalysisFeedback(run.id, kind));
    } catch (cause) {
      setFeedbackError(cause instanceof Error ? cause.message : '反馈保存失败，请重试');
    } finally {
      setFeedbackBusy(false);
    }
  }

  return (
    <article className="card analysis-card">
      <header className="analysis-card-head">
        <span className="status-badge is-info">{ANALYSIS_STATUS_LABEL[run.status]}</span>
        <span className="status-badge is-neutral">{run.provider === 'mock' ? 'Mock 演示 · 未调用真实 AI' : 'Pi 真实模型调用'}</span>
        {run.model ? <span className="insight-card-meta">{run.model}</span> : null}
        {run.stale ? (
          <span className="status-badge is-warning">
            {run.staleReason === 'head' ? 'HEAD / 快照已变化' : run.staleReason === 'context' ? '分析上下文已变化' : '分析来源已不可用'}
          </span>
        ) : null}
      </header>
      {run.status === 'failed' || run.status === 'cancelled' ? (
        <p className="insight-warn">{run.errorMessage ?? '分析失败'}</p>
      ) : null}
      {run.status === 'no_recommendation' ? (
        <p>没有足够证据生成建议。不会用空话填卡。</p>
      ) : null}
      {run.recommendation ? (
        <>
          <h2 className="analysis-card-title">{run.recommendation.statusSummary}</h2>
          <details className="recommendation-details">
            <summary>展开依据与下一步</summary>
            <div className="recommendation-details-content">
              <p className="insight-card-meta">讨论对象：{run.recommendation.target}</p>
              <p className="insight-card-meta">范围：{run.recommendation.scope}</p>
              <p className="insight-card-meta">
                置信度 {run.recommendation.confidence}
                {run.headSha ? ` · HEAD ${run.headSha.slice(0, 12)}` : ''}
                {run.snapshotId ? ` · snapshot ${run.snapshotId}` : ''}
                {` · ${formatDateTime(run.startedAt)}`}
              </p>
              <ul className="analysis-findings">
                {run.recommendation.findings.map((finding) => (
                  <li key={finding.title}>
                    <strong>{finding.title}</strong>
                    {finding.verified ? ' · 来源引用已匹配，结论仍需判断' : ' · 来源引用未匹配，结论未验证'}
                    <p>{finding.detail}</p>
                    <p className="insight-card-meta">
                      {finding.evidenceRefs.map((ref) => `${ref.kind}:${ref.label}`).join(' · ') || '无引用'}
                    </p>
                  </li>
                ))}
              </ul>
              {run.recommendation.nextActions.length > 0 ? (
                <div>
                  <p className="page-section-title">建议下一步</p>
                  <ul className="analysis-findings">
                    {run.recommendation.nextActions.map((action) => (
                      <li key={action.title}>
                        <strong>{action.title}</strong>
                        {action.requiresConfirmation ? ' · 需你确认' : ''}
                        <p>{action.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {run.recommendation.risks.length > 0 ? (
                <p className="insight-card-meta">风险：{run.recommendation.risks.join('；')}</p>
              ) : null}
              {run.recommendation.uncertainties.length > 0 ? (
                <p className="insight-card-meta">不确定：{run.recommendation.uncertainties.join('；')}</p>
              ) : null}
            </div>
          </details>
        </>
      ) : null}
      <details className="recommendation-feedback">
        <summary>查看观察证据与评价</summary>
        <div className="insight-actions">
          <Link className="btn btn-ghost" to={observeHref}>
            查看观察证据
          </Link>
          {run.status === 'succeeded' ? (
            <>
              <button type="button" className={`btn btn-ghost ${feedback === 'useful' ? 'is-active' : ''}`} disabled={feedbackBusy} aria-pressed={feedback === 'useful'} onClick={() => void submitFeedback('useful')}>
                有用
              </button>
              <button type="button" className={`btn btn-ghost ${feedback === 'not_useful' ? 'is-active' : ''}`} disabled={feedbackBusy} aria-pressed={feedback === 'not_useful'} onClick={() => void submitFeedback('not_useful')}>
                没用
              </button>
            </>
          ) : null}
        </div>
        {run.status === 'succeeded' ? (
          <p className="insight-card-meta" role="status" aria-live="polite">
            {feedbackBusy ? '正在保存反馈…' : feedback ? `已记录：${feedback === 'useful' ? '有用' : '没用'}` : '尚未评价建议'}
          </p>
        ) : null}
        {feedbackError ? <p className="insight-warn" role="alert">{feedbackError}</p> : null}
      </details>
    </article>
  );
}
