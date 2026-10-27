import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ActionCard as HearthCard, Risk, TaskRun } from '@hearth/contracts';
import { isTerminalRunState } from '@hearth/contracts';
import {
  FAILURE_CLASS_LABEL,
  RUN_STATE_LABEL,
  formatRelativeTime,
  formatTtl,
} from '../features/cards';
import './ActionCard.css';

/** 该卡正在等待响应的操作（双击防抖：点击后立即禁用所有按钮） */
export type CardPendingAction = 'execute' | 'dismiss' | 'snooze' | null;

export interface ActionCardViewProps {
  card: HearthCard;
  /** 项目 badge 文案；null 时回退显示原始 projectId */
  projectName: string | null;
  /** 关联 run（来自 execute 响应或轮询），null 表示未知/无 run */
  run: TaskRun | null;
  pending: CardPendingAction;
  evidenceOpen: boolean;
  /** 最近一次操作失败的面向用户信息 */
  actionError: string | null;
  onToggleEvidence: () => void;
  onExecute: () => void;
  /** 忽略需二次确认：此处仅请求打开确认框 */
  onDismissRequest: () => void;
  onSnooze: () => void;
  /** 展开区（EvidenceDrawer 由页面注入） */
  children?: ReactNode;
}

/* ------------------------------------------------------------------ */
/* 风险与操作矩阵                                                      */
/* ------------------------------------------------------------------ */

const RISK_META: Readonly<Record<Risk, { label: string; title: string }>> = {
  L0: { label: 'L0', title: '风险 L0：只读/无副作用' },
  L1: { label: 'L1', title: '风险 L1：低风险本地操作' },
  L2: { label: 'L2', title: '风险 L2：中风险，执行前需要你批准' },
  L3: { label: 'L3', title: '风险 L3：高风险（当前策略下不执行）' },
};

const RISK_CLASS: Readonly<Record<Risk, string>> = {
  L0: 'risk-l0',
  L1: 'risk-l1',
  L2: 'risk-l2',
  L3: 'risk-l3',
};

interface InteractionState {
  executeDisabled: boolean;
  executeTitle: string;
  dismissDisabled: boolean;
  dismissTitle: string;
  snoozeDisabled: boolean;
  snoozeTitle: string;
}

/** 按卡片状态推导按钮可用性与禁用原因（title 即无障碍禁用说明） */
function interactionState(card: HearthCard): InteractionState {
  // 时间已过但状态未翻转的卡，服务端会在下次 execute 时惰性过期
  const timeExpired = Date.parse(card.expiresAt) <= Date.now();
  const ALL_ON: InteractionState = {
    executeDisabled: false,
    executeTitle: '立即按建议执行操作',
    dismissDisabled: false,
    dismissTitle: '忽略这条建议（不影响其它建议）',
    snoozeDisabled: false,
    snoozeTitle: '暂时收起，2 小时后再提醒',
  };

  if (card.status === 'expired' || (timeExpired && card.status === 'proposed')) {
    return {
      executeDisabled: true,
      executeTitle: '卡片已过期，不能执行；可重新扫描生成新建议',
      dismissDisabled: false,
      dismissTitle: '忽略这条过期建议',
      snoozeDisabled: true,
      snoozeTitle: '卡片已过期，无需再稍后',
    };
  }
  switch (card.status) {
    case 'executing':
    case 'verifying':
      return {
        executeDisabled: true,
        executeTitle: '任务执行中，请等待完成',
        dismissDisabled: true,
        dismissTitle: '任务执行中，暂不能忽略',
        snoozeDisabled: true,
        snoozeTitle: '任务执行中，暂不能稍后',
      };
    case 'awaiting_approval':
      return {
        executeDisabled: true,
        executeTitle: '等待你的批准：请在执行记录中批准或拒绝',
        dismissDisabled: true,
        dismissTitle: '等待批准中，暂不能忽略',
        snoozeDisabled: true,
        snoozeTitle: '等待批准中，暂不能稍后',
      };
    case 'completed':
      return {
        executeDisabled: true,
        executeTitle: '任务已完成，不能重复执行',
        dismissDisabled: false,
        dismissTitle: '从列表中忽略这条已完成建议',
        snoozeDisabled: true,
        snoozeTitle: '任务已结束，无需稍后',
      };
    case 'failed':
    case 'blocked':
      return {
        executeDisabled: true,
        executeTitle: `任务已${
          card.status === 'failed' ? '失败' : '被阻塞'
        }，不能重复执行；详情见执行记录`,
        dismissDisabled: false,
        dismissTitle: '从列表中忽略这条已结束的建议',
        snoozeDisabled: true,
        snoozeTitle: '任务已结束，无需稍后',
      };
    default:
      return ALL_ON;
  }
}

/* ------------------------------------------------------------------ */
/* Run 状态条                                                          */
/* ------------------------------------------------------------------ */

function RunStatusStrip({ run }: { run: TaskRun | null }) {
  if (run === null) return null;
  const runLink = (
    <Link className="acard-run-link" to={`/activity/${run.id}`}>
      查看 Run
    </Link>
  );

  if (!isTerminalRunState(run.state)) {
    return (
      <p className={`acard-run acard-run-live acard-run-${run.state}`}>
        <span className="acard-run-dot" aria-hidden="true" />
        {RUN_STATE_LABEL[run.state]}
        <span className="acard-run-id" title={run.id}>
          {run.id}
        </span>
      </p>
    );
  }

  switch (run.state) {
    case 'completed':
      return (
        <p className="acard-run acard-run-completed">
          已完成 · {runLink}
        </p>
      );
    case 'failed':
      return (
        <p className="acard-run acard-run-failed">
          执行失败：{FAILURE_CLASS_LABEL[run.failureClass ?? 'unknown'] ?? '未知原因'} · {runLink}
        </p>
      );
    case 'blocked':
      return (
        <p className="acard-run acard-run-blocked">
          已阻塞：{FAILURE_CLASS_LABEL[run.failureClass ?? 'unknown'] ?? '被策略或依赖阻塞'} ·{' '}
          {runLink}
        </p>
      );
    case 'cancelled':
      return <p className="acard-run acard-run-cancelled">已取消 · {runLink}</p>;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* ActionCard                                                          */
/* ------------------------------------------------------------------ */

/**
 * U01 主动建议卡片：标题 / 项目 badge / whyNow / 来源 / 相对时间 /
 * 风险等级 / TTL，以及 查看证据·开始处理·忽略·稍后 四个操作。
 */
export function ActionCard({
  card,
  projectName,
  run,
  pending,
  evidenceOpen,
  actionError,
  onToggleEvidence,
  onExecute,
  onDismissRequest,
  onSnooze,
  children,
}: ActionCardViewProps) {
  const risk = card.action.risk;
  const riskMeta = RISK_META[risk];
  const interaction = interactionState(card);
  const ttl = formatTtl(card.expiresAt);
  const sourceUri = card.evidence[0]?.uri;
  const isL2 = risk === 'L2';
  const executeLabel = isL2 ? '请求批准' : '开始处理';
  const busy = pending !== null;

  // 防抖：任一操作等待响应期间，整卡按钮禁用
  const disabledBy = (base: boolean, baseTitle: string): { disabled: boolean; title: string } =>
    busy
      ? {
          disabled: true,
          title:
            pending === 'execute'
              ? '正在提交执行请求…'
              : pending === 'dismiss'
                ? '正在忽略…'
                : '正在设置稍后提醒…',
        }
      : { disabled: base, title: baseTitle };

  const exec = disabledBy(interaction.executeDisabled, interaction.executeTitle);
  const dis = disabledBy(interaction.dismissDisabled, interaction.dismissTitle);
  const snz = disabledBy(interaction.snoozeDisabled, interaction.snoozeTitle);

  return (
    <article
      className={`acard${evidenceOpen ? ' acard-open' : ''}`}
      aria-labelledby={`acard-title-${card.id}`}
    >
      <div className="acard-main">
        <div className="acard-badges">
          <span
            className={`acard-risk ${RISK_CLASS[risk]}`}
            title={riskMeta.title}
            aria-label={riskMeta.title}
          >
            {riskMeta.label}
          </span>
          {isL2 ? (
            <span className="acard-approval-tag">需批准</span>
          ) : null}
          <span className="acard-project" title={`项目：${projectName ?? card.projectId}`}>
            {projectName ?? card.projectId}
          </span>
        </div>

        <h2 className="acard-title" id={`acard-title-${card.id}`}>
          {card.title}
        </h2>
        <p className="acard-why">{card.whyNow}</p>

        {sourceUri ? (
          <p className="acard-source">
            <span className="acard-source-label">来源</span>
            <span className="acard-source-uri" title={sourceUri}>
              {sourceUri}
            </span>
          </p>
        ) : null}

        <p className="acard-meta">
          <span>{formatRelativeTime(card.createdAt)}</span>
          <span aria-hidden="true">·</span>
          <span
            className={`acard-ttl acard-ttl-${ttl.urgency}`}
            title={`有效期至 ${card.expiresAt}`}
          >
            {ttl.label}
          </span>
          {card.status === 'snoozed' && card.snoozedUntil ? (
            <>
              <span aria-hidden="true">·</span>
              <span>已稍后，{formatRelativeTime(card.snoozedUntil)}再提醒</span>
            </>
          ) : null}
        </p>

        <RunStatusStrip run={run} />

        {actionError ? (
          <p className="acard-error" role="alert">
            {actionError}
          </p>
        ) : null}

        <div className="acard-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onToggleEvidence}
            aria-expanded={evidenceOpen}
            aria-controls={`acard-evidence-${card.id}`}
          >
            {evidenceOpen ? '收起证据' : '查看证据'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onExecute}
            disabled={exec.disabled}
            title={exec.title}
          >
            {busy && pending === 'execute' ? '提交中…' : executeLabel}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onDismissRequest}
            disabled={dis.disabled}
            title={dis.title}
          >
            忽略
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onSnooze}
            disabled={snz.disabled}
            title={snz.title}
          >
            稍后
          </button>
        </div>
      </div>

      {evidenceOpen ? (
        <div className="acard-evidence" id={`acard-evidence-${card.id}`}>
          {children}
        </div>
      ) : null}
    </article>
  );
}
