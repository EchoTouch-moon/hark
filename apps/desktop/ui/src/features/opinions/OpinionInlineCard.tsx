import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  AlertTriangle,
  History,
  Check,
  MessageSquareDiff,
  PauseCircle,
  Edit3,
} from "lucide-react";
import {
  EvidenceRef,
  ID,
  OpinionFeedbackAction,
  OpinionView,
} from "../../bridge/HarkBridge";

interface OpinionInlineCardProps {
  opinion: OpinionView;
  evidenceMap: Record<ID, EvidenceRef>;
  onInspectEvidence: (evidenceId: ID) => void;
  onSubmitFeedback: (
    opinionId: ID,
    expectedRevision: number,
    action: OpinionFeedbackAction,
    comment?: string
  ) => Promise<void>;
}

/**
 * FE-08 · OpinionInlineCard
 * PRD §3.3.D, §4.3:
 * - 观点是独立业务实体，卡片显示 summary、状态、简短依据数、uncertainties 概况。
 * - 点击展开 evidence / counterArguments / uncertainties / suggestedNextStep。
 * - 观点动作：有帮助（helpful）、反驳（rebut）、搁置（shelve）、修正（revise），后端返回新的持久状态后才显示已保存。
 */
export const OpinionInlineCard: React.FC<OpinionInlineCardProps> = ({
  opinion,
  evidenceMap,
  onInspectEvidence,
  onSubmitFeedback,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [feedbackDraftMode, setFeedbackDraftMode] = useState<"rebut" | "revise" | null>(null);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastSavedReceipt, setLastSavedReceipt] = useState<string | null>(null);

  const statusLabelMap: Record<OpinionView["status"], string> = {
    active: "当前有效观点",
    shelved: "已搁置",
    disputed: "存在反驳 / 争议中",
    superseded: "已被新版本替代",
    stale: "依据已过期 · 待重验",
  };

  const handleQuickAction = async (action: OpinionFeedbackAction, customComment?: string) => {
    setSubmitting(true);
    setLastSavedReceipt(null);
    try {
      await onSubmitFeedback(opinion.id, opinion.revision, action, customComment);
      setFeedbackDraftMode(null);
      setCommentText("");
      setLastSavedReceipt(`后端已持久化回执 · 修订版本 v${opinion.revision + 1}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article
      aria-label={`Agent 观点：${opinion.title}`}
      data-testid={`opinion-card-${opinion.id}`}
      className="my-4 rounded-[var(--corner-md)] border border-[var(--border-strong)] bg-gradient-to-b from-[#e88e47]/[0.04] to-[var(--surface-elevated)] hearth-surface p-5 transition-all duration-200 hover:border-[#e88e47]/45 animate-hearth-fade-up"
    >
      {/* 顶栏元数据：遵循 Zero-Pill 无胶囊规范，采用排版分隔符 `·` */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)] mb-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-[#c27537] dark:text-[#f1bb7c]">
            Agent 结构化观点
          </span>
          <span aria-hidden="true">·</span>
          <span>状态：{statusLabelMap[opinion.status]}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">依据 {opinion.evidenceRefs.length}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">不确定性 {opinion.uncertainties.length}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">修订 v{opinion.revision}</span>
        </div>
        <span className="font-mono tabular-nums text-[11px]">
          最近核验 {opinion.lastUpdatedAt.slice(0, 16).replace("T", " ")}
        </span>
      </div>

      {/* 观点标题与简述 */}
      <h4 className="text-[16px] font-semibold font-serif-narrative text-[var(--text-primary)] leading-snug mb-2">
        观点：{opinion.title}
      </h4>
      <p className="text-sm text-[var(--text-primary)] leading-relaxed mb-3.5 opacity-95">
        {opinion.summary}
      </p>

      {/* 用户此前提交过的修正/反驳备注 */}
      {opinion.userFeedbackNote && (
        <div className="mb-3.5 rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-black/[0.025] dark:bg-white/[0.03] px-3.5 py-2.5 text-xs text-[var(--text-muted)]">
          <span className="font-medium text-[var(--text-primary)]">你的最近反馈记录：</span>
          {opinion.userFeedbackNote}
        </div>
      )}

      {/* 后端回执确认提示（必须收到新 revision 后才显示） */}
      {lastSavedReceipt && (
        <div
          role="status"
          className="mb-3.5 flex items-center gap-1.5 text-xs text-[var(--semantic-success)] font-medium animate-hearth-pop"
        >
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span>{lastSavedReceipt}</span>
        </div>
      )}

      {/* 展开详情区：依据、反例、不确定性、建议下一步 */}
      {expanded && (
        <div className="mt-2 mb-4 pt-3.5 border-t border-[var(--border-subtle)] space-y-3.5 text-xs animate-hearth-pop">
          <div>
            <div className="font-semibold text-[var(--text-primary)] mb-1">推理脉络</div>
            <p className="text-[var(--text-muted)] leading-relaxed">{opinion.rationale}</p>
          </div>

          {/* 关联证据列表 */}
          <div>
            <div className="font-semibold text-[var(--text-primary)] mb-2">
              关联依据 ({opinion.evidenceRefs.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {opinion.evidenceRefs.map((refId) => {
                const ev = evidenceMap[refId];
                return (
                  <button
                    key={refId}
                    type="button"
                    onClick={() => onInspectEvidence(refId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-solid)] hover:border-[#e88e47]/60 text-left transition-all active:scale-[0.98]"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#c27537] dark:text-[#f1bb7c] shrink-0" />
                    <span className="font-medium text-[var(--text-primary)]">
                      {ev ? ev.title : refId}
                    </span>
                    {ev?.availability === "stale" && (
                      <span className="text-amber-600 dark:text-amber-400">· 已过期</span>
                    )}
                    {ev?.verificationLevel === "snippet" && (
                      <span className="text-[var(--text-muted)]">· 仅摘要</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 反例 / Counter-arguments */}
          {opinion.counterArguments.length > 0 && (
            <div>
              <div className="font-semibold text-[var(--text-primary)] mb-1">
                潜在反例与边界权衡 ({opinion.counterArguments.length})
              </div>
              <ul className="list-disc list-inside space-y-1 text-[var(--text-muted)] leading-relaxed">
                {opinion.counterArguments.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 不确定性 / Uncertainties */}
          {opinion.uncertainties.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)] mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>尚未验证的不确定性 ({opinion.uncertainties.length})</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[var(--text-muted)] leading-relaxed">
                {opinion.uncertainties.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {opinion.suggestedNextStep && (
            <div className="rounded-[var(--corner-sm)] bg-black/[0.03] dark:bg-white/[0.03] px-3.5 py-2.5 text-[var(--text-primary)]">
              <span className="font-semibold">建议下一步：</span>
              <span className="text-[var(--text-muted)]">{opinion.suggestedNextStep}</span>
            </div>
          )}

          {/* 历史修订轨迹 */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowHistory((prev) => !prev)}
              className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <History className="w-3.5 h-3.5" />
              <span>
                {showHistory ? "收起修订历史" : `查看版本演进历史 (${opinion.history.length})`}
              </span>
            </button>
            {showHistory && (
              <div className="mt-2.5 space-y-1.5 pl-3 border-l border-[var(--border-strong)] animate-hearth-pop">
                {opinion.history.map((h) => (
                  <div key={h.revision} className="text-[11px] text-[var(--text-muted)]">
                    <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                      v{h.revision}
                    </span>
                    <span aria-hidden="true"> · </span>
                    <span>{h.status}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{h.note}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 反驳或修正意见输入框 */}
      {feedbackDraftMode && (
        <div className="mt-3 mb-3 pt-3 border-t border-[var(--border-subtle)] space-y-2.5 animate-hearth-pop">
          <label
            htmlFor={`opinion-feedback-input-${opinion.id}`}
            className="block text-xs font-medium text-[var(--text-primary)]"
          >
            {feedbackDraftMode === "rebut"
              ? "输入你的反驳依据（将使观点状态转为 disputed 并生成新版本）："
              : "输入你的修正建议（将更新建议下一步并持久化新版本）："}
          </label>
          <textarea
            id={`opinion-feedback-input-${opinion.id}`}
            rows={2}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={
              feedbackDraftMode === "rebut"
                ? "例如：这里忽略了离线冷启动时的只读快照缓存…"
                : "例如：建议仅在用户显式点击确认时才触发落库…"
            }
            className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-solid)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-2 focus:outline-[var(--focus-ring)]"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setFeedbackDraftMode(null);
                setCommentText("");
              }}
              className="px-2.5 py-1 rounded-md text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              取消
            </button>
            <button
              type="button"
              disabled={submitting || !commentText.trim()}
              onClick={() => handleQuickAction(feedbackDraftMode, commentText.trim())}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#c27537] text-white hover:bg-[#b0672c] disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              {submitting ? "正在同步回执…" : "提交并持久化"}
            </button>
          </div>
        </div>
      )}

      {/* 操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--border-subtle)]">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-xs font-medium text-[#c27537] dark:text-[#f1bb7c] hover:underline whitespace-nowrap shrink-0"
        >
          <span>{expanded ? "收起依据和反例" : "查看依据和反例"}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleQuickAction("helpful")}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium border border-[var(--border-subtle)] bg-[var(--surface-solid)]/60 hover:border-[#3d8068] hover:text-[#3d8068] transition-all active:scale-[0.97] whitespace-nowrap shrink-0"
          >
            <Check className="w-3.5 h-3.5" />
            <span>有帮助</span>
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() =>
              setFeedbackDraftMode((prev) => (prev === "rebut" ? null : "rebut"))
            }
            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium border border-[var(--border-subtle)] bg-[var(--surface-solid)]/60 hover:border-[#b74a46] hover:text-[#b74a46] transition-all active:scale-[0.97] whitespace-nowrap shrink-0"
          >
            <MessageSquareDiff className="w-3.5 h-3.5" />
            <span>反驳</span>
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() =>
              setFeedbackDraftMode((prev) => (prev === "revise" ? null : "revise"))
            }
            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium border border-[var(--border-subtle)] bg-[var(--surface-solid)]/60 hover:border-[#c27537] hover:text-[#c27537] transition-all active:scale-[0.97] whitespace-nowrap shrink-0"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>修正</span>
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleQuickAction("shelve")}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium border border-[var(--border-subtle)] bg-[var(--surface-solid)]/60 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all active:scale-[0.97] whitespace-nowrap shrink-0"
          >
            <PauseCircle className="w-3.5 h-3.5" />
            <span>搁置</span>
          </button>
        </div>
      </div>
    </article>
  );
};
