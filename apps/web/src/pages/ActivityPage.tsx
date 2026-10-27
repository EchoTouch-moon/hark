import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader } from '../components';
import { TaskTimeline } from '../components/TaskTimeline';
import { ApprovalSheet } from '../components/ApprovalSheet';
import { ApiError } from '../features/api/client';
import {
  FAILURE_CLASS_LABELS,
  RUN_STATE_LABELS,
  VERDICT_LABELS,
  cancelRun,
  decideApproval,
  fetchRunDetail,
  fetchRuns,
  formatDateTime,
  isTerminalRunState,
  runStateTone,
  verdictTone,
  type ApprovalDecision,
  type RunDetailPayload,
} from '../features/runs';
import type { TaskRun } from '@hearth/contracts';
import './ActivityPage.css';

/** 非终态 run 的轮询间隔（docs/02-U04：终态后停止请求） */
const POLL_INTERVAL_MS = 900;

/* ------------------------------------------------------------------ */
/* 复制按钮：run id / sha256 等等宽片段 */
/* ------------------------------------------------------------------ */

interface CopyButtonProps {
  value: string;
  /** 可访问名称里的对象说明，如 “Run ID”、“SHA-256” */
  label: string;
}

function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const handleCopy = async (): Promise<void> => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText !== undefined) {
        await navigator.clipboard.writeText(value);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // 剪贴板 API 不可用（非安全上下文等）时的兜底
      try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        ok = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        ok = false;
      }
    }
    setCopied(ok);
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={handleCopy}
      aria-label={copied ? `${label} 已复制` : `复制${label}`}
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* /activity —— 执行记录列表（缺少 runId 时的落点） */
/* ------------------------------------------------------------------ */

function RunListView() {
  const [runs, setRuns] = useState<TaskRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchRuns(undefined, controller.signal);
        if (!cancelled) {
          setRuns(list);
          setError(null);
        }
      } catch (cause) {
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setError(cause instanceof Error ? cause.message : '加载执行记录失败');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setRuns(null);
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  const loading = runs === null && error === null;

  return (
    <section className="page">
      <PageHeader title="执行记录" subtitle="所有任务执行与验证结果，点击查看时间线与证据" />
      <div className="page-section" aria-busy={loading} aria-label="执行列表">
        {loading ? (
          <div className="act-skeleton-stack" aria-hidden="true">
            <div className="skeleton skeleton-block" />
            <div className="skeleton skeleton-block" />
            <div className="skeleton skeleton-block" />
          </div>
        ) : error !== null ? (
          <ErrorState message={error} onRetry={retry} />
        ) : runs !== null && runs.length === 0 ? (
          <EmptyState
            title="还没有执行记录"
            hint="从 Home 的行动卡片发起执行后，记录会出现在这里"
          />
        ) : (
          <ul className="act-run-list">
            {[...(runs ?? [])]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((run) => (
                <li key={run.id}>
                  <Link
                    to={`/activity/${encodeURIComponent(run.id)}`}
                    className="card act-run-row"
                    aria-label={`查看执行 ${run.actionId}（${RUN_STATE_LABELS[run.state]}）的详情`}
                  >
                    <span className="mono act-run-action">{run.actionId}</span>
                    <span className={`status-badge is-${runStateTone(run.state)}`}>
                      {RUN_STATE_LABELS[run.state]}
                    </span>
                    <span className="act-run-time">{formatDateTime(run.createdAt)}</span>
                    {run.verificationVerdict !== undefined ? (
                      <span
                        className={`status-badge is-${verdictTone(run.verificationVerdict)}`}
                      >
                        {VERDICT_LABELS[run.verificationVerdict]}
                      </span>
                    ) : (
                      <span className="act-run-verdict-none">尚未验证</span>
                    )}
                    <span className="act-run-open">详情 →</span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* /activity/:runId —— 单条执行详情 */
/* ------------------------------------------------------------------ */

function RunDetailView({ runId }: { runId: string }) {
  const [data, setData] = useState<RunDetailPayload | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deciding, setDeciding] = useState<ApprovalDecision | null>(null);

  const runRef = useRef<TaskRun | null>(null);
  useEffect(() => {
    runRef.current = data?.run ?? null;
  }, [data]);

  // 初次加载 / 手动重试
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchRunDetail(runId, controller.signal);
        if (!cancelled) {
          setData(payload);
          setLoadError(null);
        }
      } catch (cause) {
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setData(null);
        setLoadError({
          status: cause instanceof ApiError ? cause.status : 0,
          message: cause instanceof Error ? cause.message : '加载执行详情失败',
        });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId, reloadKey]);

  // 轮询：非终态每 900ms 静默刷新；终态后不再发请求
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const current = runRef.current;
      if (current === null || isTerminalRunState(current.state)) return;
      try {
        const payload = await fetchRunDetail(runId);
        runRef.current = payload.run;
        setData(payload);
      } catch {
        // 瞬时失败：保留旧数据，下一轮继续重试
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [runId, reloadKey]);

  const retry = useCallback(() => {
    setData(null);
    setLoadError(null);
    setActionError(null);
    setApprovalNotice(null);
    setReloadKey((key) => key + 1);
  }, []);

  const handleCancelConfirmed = useCallback(async () => {
    setCancelConfirmOpen(false);
    setCancelling(true);
    setActionError(null);
    try {
      const run = await cancelRun(runId);
      setData((prev) => (prev === null ? prev : { ...prev, run }));
    } catch (cause) {
      setActionError(
        `取消失败：${cause instanceof Error ? cause.message : '未知错误'}（可稍后重试）`,
      );
    } finally {
      setCancelling(false);
    }
  }, [runId]);

  const handleDecide = useCallback(
    async (decision: ApprovalDecision) => {
      setDeciding(decision);
      setApprovalNotice(null);
      try {
        const run = await decideApproval(runId, decision);
        setData((prev) => (prev === null ? prev : { ...prev, run }));
        setApprovalNotice(
          decision === 'approve'
            ? '已批准。执行即将开始，下方状态会自动刷新。'
            : '已拒绝。这条执行不会发生。',
        );
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) {
          setApprovalNotice('审批状态已变化（该执行可能已被处理或过期），正在为你刷新最新状态…');
          try {
            const payload = await fetchRunDetail(runId);
            setData(payload);
          } catch {
            // 刷新失败时保留旧数据，轮询会继续跟进
          }
        } else {
          setApprovalNotice(`提交失败：${cause instanceof Error ? cause.message : '未知错误'}`);
        }
      } finally {
        setDeciding(null);
      }
    },
    [runId],
  );

  if (loadError !== null) {
    return (
      <section className="page">
        <PageHeader title="执行详情" subtitle={`Run ${runId}`} />
        <div className="page-section" aria-label="执行详情加载失败">
          <div className="act-error-wrap">
            <ErrorState
              message={
                loadError.status === 404
                  ? `执行 ${runId} 不存在（404）。它可能从未创建，或记录已被清理。`
                  : loadError.message
              }
              onRetry={retry}
            />
            <Link className="btn btn-ghost" to="/activity">
              返回执行列表
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (data === null) {
    return (
      <section className="page">
        <PageHeader title="执行详情" subtitle={`Run ${runId}`} />
        <div className="page-section" aria-busy="true" aria-label="执行详情加载中">
          <div className="act-skeleton-stack" aria-hidden="true">
            <div className="skeleton skeleton-block" />
            <div className="skeleton skeleton-block" />
          </div>
        </div>
      </section>
    );
  }

  const { run, steps, evidence, card } = data;
  const terminal = isTerminalRunState(run.state);
  const awaiting = run.state === 'awaiting_approval';

  return (
    <section className="page">
      <PageHeader
        title="执行详情"
        subtitle={`动作 ${run.actionId} 的执行记录`}
        actions={
          <>
            {terminal ? (
              <span className="act-cancel-hint" id="act-cancel-disabled-reason">
                已结束的执行不能取消
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost"
              disabled={terminal || cancelling}
              aria-describedby={terminal ? 'act-cancel-disabled-reason' : undefined}
              title={terminal ? '已结束的执行不能取消' : undefined}
              onClick={() => setCancelConfirmOpen(true)}
            >
              {cancelling ? '取消中…' : '取消执行'}
            </button>
          </>
        }
      />

      {actionError !== null ? (
        <p className="act-action-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <div className="page-section" aria-label="执行概要">
        <div className="card act-meta">
          <dl className="act-meta-grid">
            <div className="act-meta-item">
              <dt className="act-meta-label">Run ID</dt>
              <dd className="act-meta-value act-copyable">
                <code className="mono">{run.id}</code>
                <CopyButton value={run.id} label="Run ID" />
              </dd>
            </div>
            <div className="act-meta-item">
              <dt className="act-meta-label">状态</dt>
              <dd className="act-meta-value">
                <span className={`status-badge is-${runStateTone(run.state)}`}>
                  {RUN_STATE_LABELS[run.state]}
                </span>
                {!terminal ? (
                  <span className="act-live-hint">进行中 · 每 0.9 秒自动刷新</span>
                ) : null}
              </dd>
            </div>
            <div className="act-meta-item">
              <dt className="act-meta-label">动作</dt>
              <dd className="act-meta-value">
                <code className="mono">{run.actionId}</code>
              </dd>
            </div>
            <div className="act-meta-item">
              <dt className="act-meta-label">关联卡片</dt>
              <dd className="act-meta-value">{card !== null ? card.title : '（卡片数据不可用）'}</dd>
            </div>
            <div className="act-meta-item">
              <dt className="act-meta-label">创建 / 开始 / 结束</dt>
              <dd className="act-meta-value act-meta-times">
                <span>创建 {formatDateTime(run.createdAt)}</span>
                <span>开始 {formatDateTime(run.startedAt)}</span>
                <span>结束 {formatDateTime(run.endedAt)}</span>
              </dd>
            </div>
            {run.verificationVerdict !== undefined ? (
              <div className="act-meta-item">
                <dt className="act-meta-label">验证结论</dt>
                <dd className="act-meta-value">
                  <span className={`status-badge is-${verdictTone(run.verificationVerdict)}`}>
                    {VERDICT_LABELS[run.verificationVerdict]}
                  </span>
                </dd>
              </div>
            ) : null}
            {run.failureClass !== undefined ? (
              <div className="act-meta-item">
                <dt className="act-meta-label">失败类别</dt>
                <dd className="act-meta-value">
                  <span className="status-badge is-danger">
                    {FAILURE_CLASS_LABELS[run.failureClass]}
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>

      {awaiting ? (
        <div className="page-section" aria-label="审批面板">
          {card !== null ? (
            <ApprovalSheet
              run={run}
              card={card}
              deciding={deciding}
              notice={approvalNotice}
              onDecide={handleDecide}
            />
          ) : (
            <section className="approval-sheet" aria-labelledby="approval-fallback-title">
              <h2 id="approval-fallback-title" className="approval-sheet-title">
                需要你批准
              </h2>
              <p className="approval-sheet-lede">
                该执行在等待审批，但关联卡片数据不可用，无法展示动作详情。按默认拒绝原则，建议直接拒绝。
              </p>
              {approvalNotice !== null ? (
                <p className="approval-notice" role="alert">
                  {approvalNotice}
                </p>
              ) : null}
              <div className="approval-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  autoFocus
                  disabled={deciding !== null}
                  onClick={() => void handleDecide('deny')}
                >
                  {deciding === 'deny' ? '提交中…' : '拒绝'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={deciding !== null}
                  onClick={() => void handleDecide('approve')}
                >
                  {deciding === 'approve' ? '提交中…' : '批准执行'}
                </button>
              </div>
            </section>
          )}
        </div>
      ) : null}

      <div className="page-section" aria-label="执行步骤">
        <p className="page-section-title">执行步骤</p>
        <TaskTimeline steps={steps} />
      </div>

      <div className="page-section" aria-label="验证证据">
        <p className="page-section-title">验证证据</p>
        {evidence.length === 0 ? (
          <EmptyState
            title="暂无验证证据"
            hint="执行进入验证阶段后，产物与哈希会出现在这里"
          />
        ) : (
          <ul className="act-evidence-list">
            {evidence.map((item) => (
              <li key={item.id} className="card act-evidence">
                <div className="act-evidence-row">
                  <span className="status-badge is-neutral">{item.kind}</span>
                  <span className="act-evidence-time">{formatDateTime(item.createdAt)}</span>
                </div>
                <div className="act-evidence-row act-copyable">
                  <span className="act-evidence-label">SHA-256</span>
                  <code className="mono act-hash">{item.sha256}</code>
                  <CopyButton value={item.sha256} label="SHA-256" />
                </div>
                <div className="act-evidence-row">
                  <span className="act-evidence-label">产物路径</span>
                  {item.artifactPath !== undefined && item.artifactPath !== '' ? (
                    <code className="mono">{item.artifactPath}</code>
                  ) : (
                    <span className="act-evidence-none">（无落盘产物）</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="取消这条执行？"
        description="取消后未开始的步骤不会再执行，已产生的副作用不会被撤销。"
        confirmText="确认取消执行"
        cancelText="先不取消"
        onCancel={() => setCancelConfirmOpen(false)}
        onConfirm={() => void handleCancelConfirmed()}
      />
    </section>
  );
}

/**
 * U04 Activity（M1-T08）：
 * - /activity        → 执行记录列表
 * - /activity/:runId → 执行详情（时间线 / 审批 / 证据 / 轮询 / 取消）
 */
export function ActivityPage() {
  const { runId } = useParams<{ runId: string }>();
  if (runId === undefined) {
    return <RunListView />;
  }
  return <RunDetailView runId={runId} />;
}
