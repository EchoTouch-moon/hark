import type { ActionCard, Risk, TaskRun } from '@hearth/contracts';
import { formatDateTime, type ApprovalDecision } from '../features/runs';

/**
 * ApprovalSheet（docs/02-U04 审批面板）：
 * - 显式列出动作类型、目标、风险等级与参数（脱敏 JSON）；
 * - 说明批准有效期与默认拒绝原则；
 * - 默认焦点落在「拒绝」按钮（默认拒绝）；
 * - approve/deny 由页面调用 POST /approvals/:runId。
 */

export interface ApprovalSheetProps {
  run: TaskRun;
  card: ActionCard;
  /** 正在提交中的决定；提交期间两个按钮禁用 */
  deciding: ApprovalDecision | null;
  /** 状态冲突（409）或提交失败的提示 */
  notice?: string | null;
  onDecide: (decision: ApprovalDecision) => void;
}

const RISK_LABELS: Record<Risk, string> = {
  L0: 'L0 · 只读',
  L1: 'L1 · 本地产物',
  L2: 'L2 · 需要你在线明确批准',
  L3: 'L3 · 一律拒绝（策略禁止执行）',
};

function riskTone(risk: Risk): string {
  switch (risk) {
    case 'L3':
      return 'danger';
    case 'L2':
      return 'warning';
    case 'L1':
      return 'info';
    default:
      return 'neutral';
  }
}

function safeParamsJson(params: Record<string, unknown>): string {
  try {
    return JSON.stringify(params, null, 2);
  } catch {
    return '（参数无法序列化展示）';
  }
}

export function ApprovalSheet({ run, card, deciding, notice, onDecide }: ApprovalSheetProps) {
  const action = card.action;
  const disabled = deciding !== null;

  return (
    <section className="approval-sheet" aria-labelledby="approval-sheet-title">
      <div className="approval-sheet-head">
        <h2 id="approval-sheet-title" className="approval-sheet-title">
          需要你批准
        </h2>
        <span className="status-badge is-warning">待审批</span>
      </div>
      <p className="approval-sheet-lede">
        这条执行在等你做决定。不做选择就等于不批准（默认拒绝）；批准只对下面列出的这一个动作生效。
      </p>

      <dl className="approval-sheet-facts">
        <div className="fact-row">
          <dt className="fact-label">动作类型</dt>
          <dd className="fact-value">
            <code className="mono">{action.actionType}</code>
          </dd>
        </div>
        <div className="fact-row">
          <dt className="fact-label">作用目标</dt>
          <dd className="fact-value">
            <code className="mono">{action.target.resourceId}</code>
            {action.target.path ? (
              <>
                {' '}
                <span className="fact-sub">
                  路径 <code className="mono">{action.target.path}</code>
                </span>
              </>
            ) : null}
          </dd>
        </div>
        <div className="fact-row">
          <dt className="fact-label">风险等级</dt>
          <dd className="fact-value">
            <span className={`status-badge is-${riskTone(action.risk)}`}>
              {RISK_LABELS[action.risk]}
            </span>
          </dd>
        </div>
        <div className="fact-row">
          <dt className="fact-label">参数（脱敏）</dt>
          <dd className="fact-value">
            <pre className="approval-params mono">{safeParamsJson(action.params)}</pre>
          </dd>
        </div>
        <div className="fact-row">
          <dt className="fact-label">批准有效期</dt>
          <dd className="fact-value">
            卡片有效期至 {formatDateTime(card.expiresAt)}。批准是一次性授权：仅绑定上面这个动作摘要与目标，执行前服务端还会再次校验；过期后自动失效，不会延续到相似动作。
          </dd>
        </div>
      </dl>

      {notice ? (
        <p className="approval-notice" role="alert">
          {notice}
        </p>
      ) : null}

      <div className="approval-actions">
        {/* 默认拒绝：焦点先落在「拒绝」 */}
        <button
          type="button"
          className="btn btn-ghost"
          autoFocus
          disabled={disabled}
          onClick={() => onDecide('deny')}
        >
          {deciding === 'deny' ? '提交中…' : '拒绝'}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled}
          onClick={() => onDecide('approve')}
        >
          {deciding === 'approve' ? '提交中…' : '批准执行'}
        </button>
      </div>
      <p className="approval-run-hint">
        Run <code className="mono">{run.id}</code>
      </p>
    </section>
  );
}
