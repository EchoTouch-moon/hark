import React from "react";
import { Bell, ArrowUpRight, X } from "lucide-react";
import { AttentionItem, ID, WorkspaceId } from "../../bridge/HarkBridge";

interface AttentionNoticeProps {
  items: AttentionItem[];
  currentWorkspaceId?: WorkspaceId;
  onJumpToAttention: (item: AttentionItem) => void;
  onDismiss: (id: ID) => void;
}

/**
 * FE-14 · AttentionNotice
 * PRD §2.1, §4.6, §5:
 * - 发现值得关注的事：Agent 用一段短话说清“为什么现在值得讨论”，展开才看证据和观点。
 * - 低打扰通知与未处理发现入口，不连续刷卡、不抢输入焦点。
 */
export const AttentionNotice: React.FC<AttentionNoticeProps> = ({
  items,
  currentWorkspaceId,
  onJumpToAttention,
  onDismiss,
}) => {
  if (!items || items.length === 0) return null;

  const topItem = items[0];
  const isCrossWorkspace = currentWorkspaceId && topItem.workspaceId !== currentWorkspaceId;

  return (
    <div
      role="region"
      aria-label="值得关注的发现"
      data-testid="attention-notice"
      className="mb-5 rounded-[var(--corner-md)] border border-[#e88e47]/30 bg-gradient-to-r from-[#e88e47]/[0.07] via-[var(--surface)] to-[var(--surface)] px-5 py-3.5 hearth-surface animate-hearth-fade-up"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <Bell className="w-3.5 h-3.5 text-[#c27537] dark:text-[#f1bb7c] shrink-0" />
            <span className="font-semibold text-[var(--text-primary)]">{topItem.headline}</span>
            <span aria-hidden="true">·</span>
            <span>项目：{topItem.workspaceName}</span>
            {isCrossWorkspace && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[#c27537] dark:text-[#f1bb7c] font-medium">
                  点击将切回对应空间
                </span>
              </>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            为什么现在值得讨论：{topItem.whyNow}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <button
            type="button"
            onClick={() => onJumpToAttention(topItem)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#c27537] text-white hover:bg-[#b0672c] shadow-xs transition-all active:scale-[0.98] whitespace-nowrap shrink-0"
          >
            <span>查看依据与观点</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDismiss(topItem.id)}
            aria-label="忽略本条发现提醒"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
