import React, { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, X, BookOpen } from "lucide-react";
import { MemoryFoldEntry, ID } from "../../bridge/HarkBridge";

interface MemoryFoldProps {
  fold?: MemoryFoldEntry;
  onInspectEvidence: (evidenceId: ID) => void;
}

/**
 * FE-10 · MemoryFold
 * PRD §2.4:
 * - 在已有项目的首次认识或回访顶部，显示一个很小的折页式记忆入口：一句过去的真实决定/旧念头 + 来源时间。
 * - 默认折叠，展开显示更详细原文和来源。
 * - 只有后端返回可信记录才出现；没有记录时不造假。
 */
export const MemoryFold: React.FC<MemoryFoldProps> = ({ fold, onInspectEvidence }) => {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!fold || dismissed) {
    return null;
  }

  const formattedDate = fold.recordedAt.slice(0, 10);
  const statusMap: Record<MemoryFoldEntry["validStatus"], string> = {
    active: "当前有效决定",
    superseded: "已被后续修订替代",
    review_needed: "待重新核验",
  };

  return (
    <section
      aria-label="历史记忆折页"
      data-testid="memory-fold"
      className="relative mb-7 overflow-hidden rounded-[var(--corner-md)] border border-[var(--border-subtle)] hearth-surface transition-all duration-200 hover:border-[#e88e47]/35 animate-hearth-fade-up"
    >
      {/* 右上角微妙的纸张折角装饰 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 right-0 w-7 h-7 bg-gradient-to-bl from-[#e88e47]/18 via-[#e88e47]/5 to-transparent rounded-bl-xl"
      />

      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="flex-1 text-left group focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] rounded-md"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)] mb-1.5">
            <BookOpen className="w-3.5 h-3.5 text-[#c27537] dark:text-[#f1bb7c] shrink-0" />
            <span className="font-serif-narrative font-semibold text-[var(--text-primary)] tracking-wide">
              记忆折页
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">记录于 {formattedDate}</span>
            <span aria-hidden="true">·</span>
            <span>有效期状态：{statusMap[fold.validStatus]}</span>
          </div>
          <p className="text-[15px] text-[var(--text-primary)] leading-relaxed font-serif-narrative group-hover:text-[#c27537] dark:group-hover:text-[#f1bb7c] transition-colors">
            「{fold.statement}」
          </p>
        </button>

        <div className="flex items-center gap-1 shrink-0 pt-0.5">
          <button
            type="button"
            data-testid="memory-fold-toggle"
            onClick={() => setExpanded((prev) => !prev)}
            aria-label={expanded ? "收起记忆折页详情" : "展开记忆折页详情"}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="关闭本条记忆折页"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-4 pt-3 border-t border-[var(--border-subtle)] bg-black/[0.015] dark:bg-white/[0.015] text-xs space-y-2.5 animate-hearth-pop">
          <p className="text-[var(--text-muted)] leading-relaxed">
            <span className="font-medium text-[var(--text-primary)]">当时背景摘录：</span>
            {fold.contextExcerpt}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <span>依据来源：{fold.sourceTitle}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">历史锚点 ID: {fold.id}</span>
            </div>
            <button
              type="button"
              onClick={() => onInspectEvidence(fold.sourceRefId)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#e88e47]/12 text-[#c27537] dark:text-[#f1bb7c] hover:bg-[#e88e47]/22 transition-colors whitespace-nowrap shrink-0"
            >
              <span>查看原始依据</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
