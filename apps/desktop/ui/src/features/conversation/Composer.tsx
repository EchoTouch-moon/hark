import React, { useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { ServicePermission } from "../../bridge/HarkBridge";

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
  onOpenPermissions: () => void;
  onFocusChange: (focused: boolean) => void;
}

/** Quiet composer. Capability checks and IME behavior are unchanged. */
export const Composer: React.FC<ComposerProps> = ({
  workspaceName, draft, onDraftChange, onSend, onCancelRun, isRunning, sendBlocked = false, sendStatus, onCheckSendStatus, onEndUnknownSend,
  modelPermission, stepFunConfigured, sidecarAvailable, onOpenPermissions, onFocusChange,
}) => {
  const [isComposing, setIsComposing] = useState(false);
  const [focused, setFocused] = useState(false);
  const canSendRemote = stepFunConfigured && modelPermission === "enabled" && sidecarAvailable && !isRunning && !sendBlocked;
  const needsSetup = !stepFunConfigured || modelPermission !== "enabled" || !sidecarAvailable;
  const setupLabel = !stepFunConfigured ? "配置模型后开始对话" : !sidecarAvailable ? "模型连接暂不可用" : "此项目尚未启用模型";
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      if (isComposing || event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (canSendRemote && draft.trim()) void onSend();
    }
  };
  return (
    <div data-testid="hearth-composer" className="sticky bottom-0 z-20 pt-5 pb-5 bg-gradient-to-t from-[var(--canvas)] via-[var(--canvas)]/95 to-transparent">
      <div className="rounded-2xl border border-[var(--border-strong)] hearth-composer-shell px-4 pt-4 pb-3 transition-colors focus-within:border-[#c27537]/65">
        <label htmlFor="hearth-composer-textarea" className="sr-only">在 {workspaceName} 中继续对话</label>
        <textarea id="hearth-composer-textarea" data-testid="composer-textarea" rows={2} value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onCompositionStart={() => setIsComposing(true)} onCompositionEnd={() => setIsComposing(false)}
          onFocus={() => { setFocused(true); onFocusChange(true); }}
          onBlur={() => { setFocused(false); onFocusChange(false); }}
          onKeyDown={handleKeyDown} placeholder="聊聊这个项目…"
          className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/65 focus:outline-none" />
        <div className="mt-1 flex min-h-8 items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
          {sendStatus ? <span role="status">{sendStatus}{onCheckSendStatus && <button type="button" onClick={onCheckSendStatus} data-testid="check-send-status" className="ml-2 font-medium text-[#c27537] hover:underline">检查状态</button>}{onEndUnknownSend && <button type="button" onClick={onEndUnknownSend} data-testid="end-unknown-send" className="ml-2 font-medium text-[#c27537] hover:underline">结束等待</button>}</span> : needsSetup ? (
            <button type="button" onClick={onOpenPermissions} aria-label="打开模型设置"
              className="rounded-md py-1 text-left hover:text-[#c27537] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">
              {setupLabel}<span className="ml-1 text-[#c27537]"> →</span>
            </button>
          ) : (
            <span className={focused || draft ? "opacity-70" : "opacity-0"}>Enter 发送 · Shift+Enter 换行</span>
          )}
          {isRunning ? (
            <button type="button" onClick={onCancelRun} data-testid="stop-generation-button" aria-label="停止生成" title="停止生成"
              className="shrink-0 rounded-full bg-[#b74a46] p-2.5 text-white hover:bg-[#9e3e3a] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button type="button" disabled={!canSendRemote || !draft.trim()} onClick={onSend}
              data-testid="send-message-button" aria-label="发送消息" title="发送消息"
              className="shrink-0 rounded-full bg-[#c27537] p-2.5 text-white hover:bg-[#b0672c] disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
