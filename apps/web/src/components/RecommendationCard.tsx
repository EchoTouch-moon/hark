import { Link } from 'react-router-dom';
import {
  ANALYSIS_STATUS_LABEL,
  sendAnalysisFeedback,
  type AnalysisRun,
} from '../features/analysis';
import { formatDateTime } from '../features/runs';

export function RecommendationCard({
  run,
  observeHref,
}: {
  run: AnalysisRun;
  observeHref: string;
}) {
  return (
    <article className="card analysis-card">
      <header className="analysis-card-head">
        <span className="status-badge is-info">{ANALYSIS_STATUS_LABEL[run.status]}</span>
        <span className="status-badge is-neutral">{run.provider === 'mock' ? 'Mock 演示 · 未调用真实 AI' : 'Pi 真实模型调用'}</span>
        {run.model ? <span className="insight-card-meta">{run.model}</span> : null}
        {run.stale ? <span className="status-badge is-warning">分析时点已过期</span> : null}
      </header>
      {run.status === 'failed' || run.status === 'cancelled' ? (
        <p className="insight-warn">{run.errorMessage ?? '分析失败'}</p>
      ) : null}
      {run.status === 'no_recommendation' ? (
        <p>没有足够证据生成建议。不会用空话填卡。</p>
      ) : null}
      {run.recommendation ? (
        <>
          <h2 className="analysis-card-title">{run.recommendation.target}</h2>
          <p>{run.recommendation.statusSummary}</p>
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
                {finding.verified ? '' : ' · 未验证'}
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
        </>
      ) : null}
      <div className="insight-actions">
        <Link className="btn btn-ghost" to={observeHref}>
          查看观察证据
        </Link>
        {run.status === 'succeeded' ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => void sendAnalysisFeedback(run.id, 'useful')}>
              有用
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void sendAnalysisFeedback(run.id, 'not_useful')}>
              没用
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}
