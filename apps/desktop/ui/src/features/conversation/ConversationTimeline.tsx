import React, { useState } from "react";
import {
  FileText,
  HelpCircle,
  CheckCircle2,
  RotateCcw,
  Copy,
  Check,
  Edit3,
  FolderSearch,
  Sparkles,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import {
  ConversationMessage,
  EvidenceRef,
  ID,
  MemoryReceiptData,
  OpinionFeedbackAction,
  OpinionView,
} from "../../bridge/HarkBridge";
import { OpinionInlineCard } from "../opinions/OpinionInlineCard";
import { StreamAccumulatorState } from "../../bridge/schemas";

interface ConversationTimelineProps {
  workspaceId?: string;
  workspaceName: string;
  messages: ConversationMessage[];
  opinionsMap: Record<ID, OpinionView>;
  evidenceMap: Record<ID, EvidenceRef>;
  streamState: StreamAccumulatorState | null;
  onInspectEvidence: (evidenceId: ID) => void;
  onSubmitOpinionFeedback: (
    opinionId: ID,
    expectedRevision: number,
    action: OpinionFeedbackAction,
    comment?: string
  ) => Promise<void>;
  onRevertMemory: (operationId: ID) => Promise<void>;
  onPrefillCorrection: (promptText: string) => void;
  onEnableModelAuth?: () => void;
}

/**
 * FE-05 · ConversationTimeline
 * PRD §3.3.C, §4.1, §4.2, §4.3:
 * - 中央对话时间线：最大可读宽度 760–840px（--content-max: 800px）。
 * - 首条主动开场消息（agent_opening_message）：展示项目理解、已确认依据、未知/未验证、一个具体引导问题，以及 [查看依据] [纠正理解]。
 * - 未授权模型时的本地初扫卡片（local_scan_card）：展示本地只读统计与开启模型初读入口。
 * - 记忆写入回执（MemoryReceiptData）：显示“已记下决策 · 查看 / 撤销”。
 */
export const ConversationTimeline: React.FC<ConversationTimelineProps> = ({
  workspaceId,
  workspaceName,
  messages,
  opinionsMap,
  evidenceMap,
  streamState,
  onInspectEvidence,
  onSubmitOpinionFeedback,
  onRevertMemory,
  onPrefillCorrection,
  onEnableModelAuth,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revertingOpId, setRevertingOpId] = useState<string | null>(null);
  const standaloneOpinions = Object.values(opinionsMap).filter((opinion) =>
    opinion.workspaceId === workspaceId && !messages.some((message) => message.opinionId === opinion.id)
  );

  const handleCopy = (msg: ConversationMessage) => {
    const refsText =
      msg.sourceRefs && msg.sourceRefs.length > 0
        ? `\n\n引用来源: ${msg.sourceRefs
            .map((id) => evidenceMap[id]?.displayLocation || id)
            .join(", ")}`
        : "";
    navigator.clipboard?.writeText(`${msg.content}${refsText}`);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const handleRevert = async (receipt: MemoryReceiptData) => {
    setRevertingOpId(receipt.operationId);
    try {
      await onRevertMemory(receipt.operationId);
    } finally {
      setRevertingOpId(null);
    }
  };

  return (
    <div
      role="log"
      aria-label={`${workspaceName} 对话时间线`}
      data-testid="conversation-timeline"
      className="space-y-8 pb-10"
    >
      {messages.map((msg) => {
        const isUser = msg.role === "user";
        const isSystem = msg.role === "system_notice";
        const attachedOpinion = msg.opinionId ? opinionsMap[msg.opinionId] : undefined;

        if (msg.kind === "memory_receipt" && msg.memoryReceipt) {
          const receipt = msg.memoryReceipt;
          return (
            <details key={msg.id} data-testid={`memory-receipt-${receipt.operationId}`} className="rounded-lg text-xs text-[var(--text-muted)]">
              <summary className="flex cursor-pointer items-center gap-2 py-1.5 hover:text-[var(--text-primary)]">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#3d8068]" />
                <span className="truncate">{receipt.reverted ? "已撤回" : "已记录"} · {receipt.decisionTitle}</span>
              </summary>
              <div className="mt-2 space-y-3 rounded-xl border border-[var(--border-subtle)] p-4">
                <p className="whitespace-pre-wrap leading-relaxed">{receipt.decisionSummary}</p>
                <div className="flex flex-wrap items-center gap-4">
                  {receipt.sourceMessageId && <button type="button" className="hover:text-[#c27537]" onClick={() => onInspectEvidence(receipt.sourceMessageId!)}>查看原文</button>}
                  {!receipt.reverted && <button type="button" disabled={revertingOpId === receipt.operationId} className="hover:text-[#b74a46]" onClick={() => handleRevert(receipt)}>{revertingOpId === receipt.operationId ? "撤销中…" : "撤销记录"}</button>}
                  <span className="ml-auto text-[10px]">v{receipt.revision} · {receipt.operationId}</span>
                </div>
              </div>
            </details>
          );
        }

        // 1. 本地初扫卡片 (local_scan_card，当未启用 StepFun 模型初读时)
        if (msg.kind === "local_scan_card" && msg.localScanData) {
          const scan = msg.localScanData;
          return (
            <details
              key={msg.id}
              data-testid="local-scan-card"
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-3 text-xs text-[var(--text-muted)]"
            >
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FolderSearch className="w-4 h-4 text-[#e88e47]" />
                  <span className="font-semibold text-[var(--text-primary)]">
                    项目资料
                  </span>
                </div>
                <span className="tabular-nums">
                  已读取 {scan.scannedFilesCount} 项资料
                </span>
              </summary>
              <div className="pt-4 space-y-4">
              <p className="text-sm leading-relaxed text-[var(--text-primary)]">这是已读取的本地资料，尚未覆盖整个项目。{scan.modelAuthRequired ? " AI 分析尚未完成。" : ""}</p>
              <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface-solid)]/60 p-4 space-y-2">
                <div className="font-semibold text-[var(--text-primary)]">已读取资料</div>
                <div className="break-words leading-relaxed text-[var(--text-muted)]">{scan.keyManifests.join("、")}</div>
              </div>

              {scan.modelAuthRequired && onEnableModelAuth && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--border-subtle)] text-xs">
                  <span className="text-[var(--text-muted)]">
                    设置项目的 AI 访问权限后，可以继续分析。
                  </span>
                  <button
                    type="button"
                    onClick={onEnableModelAuth}
                    className="px-3.5 py-2 rounded-lg font-medium bg-[#c27537] text-white hover:bg-[#b0672c] transition-all active:scale-[0.98]"
                  >
                    查看项目设置
                  </button>
                </div>
              )}
              </div>
            </details>
          );
        }

        // 2. Agent 首次主动开场消息 (agent_opening_message，对应 PRD §3.3.C & §4.1.6)
        if (msg.kind === "agent_opening_message" && msg.openingData) {
          const open = msg.openingData;
          return (
            <article
              key={msg.id}
              data-testid="agent-opening-message"
              className="rounded-[var(--corner-md)] border border-[#e88e47]/35 bg-gradient-to-b from-[#e88e47]/[0.05] via-[var(--surface-elevated)] to-[var(--surface-elevated)] hearth-surface p-6 sm:p-7 space-y-5 animate-hearth-fade-up"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#e88e47]" />
                  <span className="font-serif-narrative font-semibold text-sm text-[var(--text-primary)]">
                    {workspaceName} · 已完成首次认识
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>主动开场（已持久化消息 {msg.id}）</span>
                </div>
                <span className="font-mono tabular-nums">
                  {msg.persistedAt.slice(11, 16)}
                </span>
              </div>

              {open.foldedLocalScanId && (
                <div className="text-xs text-[var(--text-muted)] bg-black/[0.03] dark:bg-white/[0.03] px-3.5 py-2 rounded-lg">
                  已将此前的本地结构扫描卡片（{open.foldedLocalScanId}）折叠归档为当前开场的底层证据附件，避免重复介绍。
                </div>
              )}

              {/* 项目整体理解 */}
              <div className="space-y-2.5 text-[15px] text-[var(--text-primary)] leading-relaxed">
                <p>{msg.content}</p>
                <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                  {open.projectUnderstanding}
                </p>
              </div>

              {/* 依据与未知双栏对比 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-1">
                <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface-solid)]/75 p-4 space-y-2">
                  <div className="font-semibold text-[var(--text-primary)]">
                    我目前可以确认的事实 ({open.confirmedFacts.length})
                  </div>
                  <ul className="list-disc list-inside space-y-1.5 text-[var(--text-muted)] leading-relaxed">
                    {open.confirmedFacts.map((fact, idx) => (
                      <li key={idx}>{fact}</li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface-solid)]/75 p-4 space-y-2">
                  <div className="font-semibold text-[var(--text-primary)]">
                    仍未验证或待核实的边界 ({open.unknownsAndUnverified.length})
                  </div>
                  <ul className="list-disc list-inside space-y-1.5 text-[var(--text-muted)] leading-relaxed">
                    {open.unknownsAndUnverified.map((unk, idx) => (
                      <li key={idx}>{unk}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* 引导问题 */}
              <div className="rounded-[var(--corner-sm)] border border-[#e88e47]/35 bg-[#e88e47]/[0.07] px-4 py-3.5 text-sm font-medium font-serif-narrative text-[var(--text-primary)] flex items-start gap-3">
                <HelpCircle className="w-4 h-4 text-[#c27537] dark:text-[#f1bb7c] shrink-0 mt-0.5" />
                <span className="leading-relaxed">{open.guidingQuestion}</span>
              </div>

              {/* 操作入口：[查看依据] [纠正理解] */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--border-subtle)] text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {msg.sourceRefs && msg.sourceRefs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onInspectEvidence(msg.sourceRefs![0])}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-medium bg-[var(--surface-solid)] border border-[var(--border-strong)] text-[var(--text-primary)] hover:border-[#e88e47] transition-all active:scale-[0.98]"
                    >
                      <FileText className="w-3.5 h-3.5 text-[#c27537] dark:text-[#f1bb7c]" />
                      <span>查看依据 ({msg.sourceRefs.length})</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      onPrefillCorrection(
                        `我想纠正你对「${workspaceName}」的初步理解：`
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-medium bg-[var(--surface-solid)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all active:scale-[0.98]"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>纠正理解</span>
                  </button>
                </div>

                {/* 直接展开各个来源标签 */}
                {msg.sourceRefs && msg.sourceRefs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                    <span>初读来源：</span>
                    {msg.sourceRefs.map((refId) => {
                      const ev = evidenceMap[refId];
                      return (
                        <button
                          key={refId}
                          type="button"
                          onClick={() => onInspectEvidence(refId)}
                          className="underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[#c27537] dark:hover:text-[#f1bb7c] transition-colors"
                        >
                          {ev ? ev.title : refId}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </article>
          );
        }

        // 3. 系统通知或取消记录
        if (isSystem) {
          return (
            <div
              key={msg.id}
              className="rounded-lg border border-[var(--border-subtle)] bg-black/[0.02] dark:bg-white/[0.02] px-4 py-2.5 text-xs text-[var(--text-muted)] flex items-center justify-between animate-hearth-fade-up"
            >
              <span>{msg.content}</span>
              <span className="font-mono tabular-nums text-[11px]">
                {msg.persistedAt.slice(11, 19)}
              </span>
            </div>
          );
        }

        // 4. 普通用户消息或 Assistant 回复（采用高审美杂志编辑流排版，减少冗余套娃）
        return (
          <article
            key={msg.id}
            data-testid={`message-${msg.id}`}
            className={`group space-y-3 animate-hearth-fade-up ${isUser ? "pl-6 sm:pl-20" : "pr-1"}`}
          >
            <div
              className={`rounded-[var(--corner-md)] transition-colors ${
                isUser
                  ? "bg-gradient-to-br from-[#e88e47]/[0.12] to-[#f1bb7c]/[0.06] dark:from-[#e88e47]/[0.16] dark:to-[#e88e47]/[0.07] border border-[#e88e47]/30 px-5 py-4 shadow-xs"
                  : "hearth-surface border border-[var(--border-subtle)] px-6 py-5"
              }`}
            >
              {/* 消息头信息 */}
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)] mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-semibold ${
                      isUser
                        ? "text-[#c27537] dark:text-[#f1bb7c]"
                        : "font-serif-narrative text-[var(--text-primary)]"
                    }`}
                  >
                    {isUser ? "你" : "Hark"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {msg.persistedAt.slice(11, 16)}
                  </span>

                </div>

                <button
                  type="button"
                  onClick={() => handleCopy(msg)}
                  aria-label="复制消息与引用"
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[var(--text-primary)] transition-opacity"
                >
                  {copiedId === msg.id ? (
                    <>
                      <Check className="w-3 h-3 text-[#3d8068]" />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span className="sr-only">复制</span>
                    </>
                  )}
                </button>
              </div>

              {/* 消息正文 */}
              <div className="text-[15px] text-[var(--text-primary)] whitespace-pre-wrap leading-[1.72]">
                {msg.content}
              </div>

              {/* 行内证据引用列表（区分只见摘要 / 原文 / 过期 / 移出当前范围） */}
              {msg.sourceRefs && msg.sourceRefs.length > 0 && (
                <details className="mt-3 text-xs text-[var(--text-muted)]">
                  <summary className="cursor-pointer py-1 hover:text-[var(--text-primary)]">依据 · {msg.sourceRefs.length} 条</summary>
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                  {msg.sourceRefs.map((refId) => {
                    const ev = evidenceMap[refId];
                    if (!ev) return null;
                    return (
                      <button
                        key={refId}
                        type="button"
                        onClick={() => onInspectEvidence(refId)}
                        data-testid={`evidence-ref-${msg.id}-${refId}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-solid)]/85 hover:border-[#e88e47] text-xs transition-all active:scale-[0.98]"
                      >
                        <FileText className="w-3 h-3 text-[#c27537] dark:text-[#f1bb7c] shrink-0" />
                        <span className="font-medium text-[var(--text-primary)]">
                          {ev.title}
                        </span>
                        <span className="text-[var(--text-muted)]">
                          ·{" "}
                          {ev.removedFromCurrentScope
                            ? "已移出当前范围"
                            : ev.availability === "stale"
                            ? "已过期"
                            : ev.availability === "unreadable"
                            ? "暂不可读"
                            : ev.verificationLevel === "snippet"
                            ? "只见搜索摘要"
                            : ev.verificationLevel === "full_text"
                            ? "已阅读原文"
                            : "已读片段"}
                        </span>
                      </button>
                    );
                  })}
                  </div>
                </details>
              )}

              {/* 持久记忆写入回执（PRD §4.3: 只有后端成功返回 memoryOperationId 才显示“已记下决策 · 查看 / 撤销”） */}
              {msg.memoryReceipt && (
                <div
                  data-testid={`memory-receipt-${msg.memoryReceipt.operationId}`}
                  className="mt-4 rounded-[var(--corner-sm)] border border-[#3d8068]/35 bg-[#3d8068]/[0.07] px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#3d8068] shrink-0" />
                      <span>
                        {msg.memoryReceipt.reverted
                          ? "已撤销该条记忆写入"
                          : `已记下决策 · ${msg.memoryReceipt.decisionTitle}`}
                      </span>
                      <span className="font-mono font-normal text-[11px] text-[var(--text-muted)]">
                        ({msg.memoryReceipt.operationId} · v{msg.memoryReceipt.revision})
                      </span>
                    </div>
                    <p className="text-[var(--text-muted)] leading-relaxed">
                      {msg.memoryReceipt.decisionSummary}
                    </p>
                  </div>

                  {!msg.memoryReceipt.reverted && (
                    <button
                      type="button"
                      disabled={revertingOpId === msg.memoryReceipt.operationId}
                      onClick={() => handleRevert(msg.memoryReceipt!)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-solid)] text-xs font-medium text-[var(--text-primary)] hover:border-[#b74a46] hover:text-[#b74a46] transition-all active:scale-[0.98] whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>
                        {revertingOpId === msg.memoryReceipt.operationId
                          ? "正在撤销…"
                          : "撤销写入"}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 行内结构化观点卡（PRD §3.3.D） */}
            {attachedOpinion && (
              <OpinionInlineCard
                opinion={attachedOpinion}
                evidenceMap={evidenceMap}
                onInspectEvidence={onInspectEvidence}
                onSubmitFeedback={onSubmitOpinionFeedback}
              />
            )}
          </article>
        );
      })}

      {/* 独立持久化观点不是伪造的聊天消息，也不依赖临时流事件。 */}
      {standaloneOpinions.length > 0 && <details className="text-xs text-[var(--text-muted)]">
        <summary className="cursor-pointer py-2 hover:text-[var(--text-primary)]">观点记录 · {standaloneOpinions.length}</summary>
        <div className="space-y-4 pt-3">{standaloneOpinions.map((opinion) => (
          <section key={opinion.id} aria-label="已保存的观点与修订">
            <OpinionInlineCard opinion={opinion} evidenceMap={evidenceMap}
              onInspectEvidence={onInspectEvidence} onSubmitFeedback={onSubmitOpinionFeedback} />
          </section>
        ))}</div>
      </details>}

      {/* 实时流式生成临时视图（仅属于当前 Workspace 与当前 RunId，PRD §4.2 & §7.6） */}
      {streamState && streamState.status === "streaming" && (
        <div
          aria-live="polite"
          data-testid="active-stream-bubble"
          className="rounded-[var(--corner-md)] border border-[#e88e47]/45 hearth-surface p-5 space-y-3 animate-hearth-fade-up"
        >
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 text-[#e88e47] animate-spin" />
              <span className="font-medium text-[var(--text-primary)]">
                Hark 正在思考
              </span>
            </div>
          </div>

          {streamState.activeToolLabel && (
            <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] px-3.5 py-2 text-xs text-[#c27537] dark:text-[#f1bb7c] font-mono">
              正在查看资料
            </div>
          )}

          {streamState.streamingText && (
            <div className="text-[15px] text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
              {streamState.streamingText}
            </div>
          )}
        </div>
      )}

      {/* 保存状态未知警告（PRD §7.6: 模型已返回但未拿到持久化 messageId 时，禁止当作成功，明确提示对账） */}
      {streamState && streamState.status === "completed_unverified" && (
        <div
          role="alert"
          className="rounded-[var(--corner-md)] border border-amber-500/50 bg-amber-500/10 p-4 text-xs space-y-1.5"
        >
          <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>回复已生成，保存状态尚未确认</span>
          </div>
          <p className="text-[var(--text-muted)]">
            正在检查对话记录，请稍等后再试。
          </p>
        </div>
      )}
    </div>
  );
};
