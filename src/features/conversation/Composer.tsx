import React, { useState } from "react";
import { ArrowUp, Square, Search } from "lucide-react";
import { ServicePermission } from "../../bridge/HarkBridge";

export interface QuickActionItem {
  id: string;
  label: string;
  getPrompt: (workspaceName: string) => string;
}

export const DEFAULT_QUICK_ACTIONS: QuickActionItem[] = [
  {
    id: "audit",
    label: "🔍 诊断项目不足与硬伤",
    getPrompt: (ws) =>
      `请结合当前项目文件（先调用 workspace.overview 再调用 workspace.read_file 读取入口与关键模块），像资深架构师一样主动排查「${ws}」当前代码与架构中存在的关键不足、性能隐患、数据结构冗余或未处理边界，直接分条指出硬伤所在，并给出笃定的重构改进意见。`,
  },
  {
    id: "evolution",
    label: "💡 架构演进与重构方案",
    getPrompt: (ws) =>
      `针对「${ws}」当前的工程实现与薄弱环节，分条给出最值得落地的 3 项架构重构与演进方案（每条加粗要点+具体实施动作），直接给出推荐方案，无需向我反问。`,
  },
  {
    id: "search",
    label: "🌐 联网方案检索与对标",
    getPrompt: (ws) =>
      `请使用 web_search 针对「${ws}」核心业务痛点检索业界同类优秀开源项目的最新架构实践与高分解决方案，对比后直接给出最适合本项目的升级建议。`,
  },
];

interface ComposerProps {
  workspaceName: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => Promise<void>;
  onCancelRun: () => Promise<void>;
  isRunning: boolean;
  sendBlocked?: boolean;
  sendStatus?: string;
  onCheckSendStatus?: () => void;
  onEndUnknownSend?: () => void;
  modelPermission: ServicePermission;
  stepFunConfigured: boolean;
  sidecarAvailable: boolean;
  modelTransportAvailable?: boolean;
  onOpenPermissions: () => void;
  onOpenSearch?: () => void;
  onFocusChange: (focused: boolean) => void;
  onQuickAction?: (prompt: string) => void;
}

/** Quiet composer. Capability checks and IME behavior are unchanged. */
export const Composer: React.FC<ComposerProps> = ({
  workspaceName, draft, onDraftChange, onSend, onCancelRun, isRunning, sendBlocked = false, sendStatus, onCheckSendStatus, onEndUnknownSend,
  modelPermission, stepFunConfigured, sidecarAvailable, modelTransportAvailable = true, onOpenPermissions, onOpenSearch, onFocusChange,
  onQuickAction,
}) => {
  const [isComposing, setIsComposing] = useState(false);
  const [focused, setFocused] = useState(false);
  const canSendRemote = stepFunConfigured && modelPermission === "enabled" && sidecarAvailable && modelTransportAvailable && !isRunning && !sendBlocked;
  const needsSetup = !stepFunConfigured || modelPermission !== "enabled" || !sidecarAvailable;
  const serviceUnavailable = stepFunConfigured && sidecarAvailable && !modelTransportAvailable;
  const setupLabel = !stepFunConfigured ? "配置模型后开始对话" : !sidecarAvailable ? "模型连接暂不可用" : "此项目尚未启用模型";
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      if (isComposing || event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (canSendRemote && draft.trim()) void onSend();
    }
  };
  return (
    <div data-testid="hearth-composer" className="sticky bottom-0 z-20 pt-3 pb-5 bg-transparent">
      {onQuickAction && (
        <div data-testid="composer-quick-actions" className="mb-2.5 flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
          {DEFAULT_QUICK_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={isRunning || sendBlocked}
              onClick={() => onQuickAction(action.getPrompt(workspaceName))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/85 backdrop-blur-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[#c27537]/60 hover:bg-[#c27537]/10 active:scale-95 transition-all whitespace-nowrap shadow-xs disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-[var(--border-strong)] hearth-composer-shell px-4 pt-4 pb-3 transition-all focus-within:border-[#d97736]/75 focus-within:shadow-[0_0_36px_-6px_rgba(232,142,71,0.32)]">
        <label htmlFor="hearth-composer-textarea" className="sr-only">在 {workspaceName} 中继续对话</label>
        <textarea id="hearth-composer-textarea" data-testid="composer-textarea" rows={2} value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onCompositionStart={() => setIsComposing(true)} onCompositionEnd={() => setIsComposing(false)}
          onFocus={() => { setFocused(true); onFocusChange(true); }}
          onBlur={() => { setFocused(false); onFocusChange(false); }}
          onKeyDown={handleKeyDown} placeholder="聊聊这个项目…"
          className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/65 focus:outline-none" />
        <div className="mt-1 flex min-h-8 items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
          {sendStatus ? (
            <span role="status">
              {sendStatus}
              {onCheckSendStatus && (
                <button type="button" onClick={onCheckSendStatus} data-testid="check-send-status" className="ml-2 font-medium text-[#c27537] hover:underline">
                  检查状态
                </button>
              )}
              {onEndUnknownSend && (
                <button type="button" onClick={onEndUnknownSend} data-testid="end-unknown-send" className="ml-2 font-medium text-[#c27537] hover:underline">
                  结束等待
                </button>
              )}
            </span>
          ) : serviceUnavailable ? (
            <span role="status" className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <span>AI 服务暂未就绪，已保存密钥无需重新输入。</span>
              <button type="button" onClick={onOpenPermissions} className="ml-1 underline underline-offset-2 hover:text-[#c27537]">
                查看设置
              </button>
            </span>
          ) : needsSetup ? (
            <button
              type="button"
              onClick={onOpenPermissions}
              aria-label="打开模型设置"
              className="rounded-md py-1 text-left font-medium text-[#c27537] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
            >
              {setupLabel}<span className="ml-1">→</span>
            </button>
          ) : (
            <span className={focused || draft ? "opacity-70 transition-opacity" : "opacity-0 transition-opacity"}>
              Enter 发送 · Shift+Enter 换行
            </span>
          )}
          <div className="flex items-center gap-2 shrink-0">
            {onOpenSearch && !isRunning && (
              <button
                type="button"
                onClick={onOpenSearch}
                title="检索项目历史、记忆与依据"
                aria-label="检索项目历史与记忆"
                className="hidden sm:inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
              >
                <Search className="h-3 w-3 text-[#c27537]" />
                <span>检索记忆</span>
              </button>
            )}
            {isRunning ? (
              <button
                type="button"
                onClick={onCancelRun}
                data-testid="stop-generation-button"
                aria-label="停止生成"
                title="停止生成"
                className="shrink-0 rounded-full bg-[#b74a46] p-2.5 text-white shadow-sm hover:bg-[#9e3e3a] active:scale-95 transition-all focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSendRemote || !draft.trim()}
                onClick={onSend}
                data-testid="send-message-button"
                aria-label="发送消息"
                title="发送消息"
                className="shrink-0 rounded-full bg-[#c27537] p-2.5 text-white shadow-sm hover:bg-[#b0672c] hover:shadow-md active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
