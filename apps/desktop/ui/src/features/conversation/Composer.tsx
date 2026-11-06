import React, { useState } from "react";
import { ArrowUp, Square, Lock, Settings } from "lucide-react";
import { ServicePermission } from "../../bridge/HarkBridge";

interface ComposerProps {
  workspaceName: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => Promise<void>;
  onCancelRun: () => Promise<void>;
  isRunning: boolean;
  modelPermission: ServicePermission;
  stepFunConfigured: boolean;
  sidecarAvailable: boolean;
  onOpenPermissions: () => void;
  onFocusChange: (focused: boolean) => void;
}

/**
 * FE-06 · Composer
 * PRD §3.3.C, §4.2, §11.1, §13 FE-O7:
 * - 固定/稳定停靠于底部；多行编辑；Enter 发送、Shift+Enter 换行。
 * - 中文输入法 IME 合成期间（isComposing / keyCode 229）Enter 绝不误发送。
 * - 停止生成只停止当前模型 Run，不删除已有会话。
 * - 在线模型未启用时允许用户输入草稿并清晰说明模型不可用原因，提供直接开启入口，不发远程请求。
 */
export const Composer: React.FC<ComposerProps> = ({
  workspaceName,
  draft,
  onDraftChange,
  onSend,
  onCancelRun,
  isRunning,
  modelPermission,
  stepFunConfigured,
  sidecarAvailable,
  onOpenPermissions,
  onFocusChange,
}) => {
  const [isComposing, setIsComposing] = useState(false);

  const canSendRemote =
    stepFunConfigured && modelPermission === "enabled" && sidecarAvailable && !isRunning;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (isComposing || e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      e.preventDefault();
      if (canSendRemote && draft.trim()) {
        onSend();
      }
    }
  };

  return (
    <div
      data-testid="hearth-composer"
      className="sticky bottom-0 z-20 pt-3 pb-5 bg-gradient-to-t from-[var(--canvas)] via-[var(--canvas)]/92 to-transparent"
    >
      <div className="max-w-[800px] mx-auto">
        {/* 模型未启用或未配置时的诚实提示条（FE-O7） */}
        {(!stepFunConfigured || modelPermission !== "enabled" || !sidecarAvailable) && (
          <div className="mb-2.5 rounded-xl border border-amber-500/35 hearth-surface px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 animate-hearth-pop">
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>
                {!sidecarAvailable
                  ? "Pi Agent Host 暂不可用：草稿已在当前项目本地安全保留，恢复连接后可发送。"
                  : !stepFunConfigured
                  ? "模型未配置，普通聊天本轮没有 Native 接口。草稿留在本地，不会伪造回复或 runCompleted。"
                  : `当前项目「${workspaceName}」尚未启用模型对话授权：草稿已隔离保存，开启授权后即可发送。`}
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenPermissions}
              className="inline-flex items-center gap-1 font-medium text-[#c27537] dark:text-[#f1bb7c] hover:underline whitespace-nowrap shrink-0"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>配置模型与授权</span>
            </button>
          </div>
        )}

        <div className="rounded-[20px] border border-[var(--border-strong)] hearth-composer-shell p-4 transition-all duration-200 focus-within:border-[#c27537]">
          <label htmlFor="hearth-composer-textarea" className="sr-only">
            在 {workspaceName} 中继续聊聊这个项目
          </label>
          <textarea
            id="hearth-composer-textarea"
            data-testid="composer-textarea"
            rows={2}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onFocus={() => onFocusChange(true)}
            onBlur={() => onFocusChange(false)}
            onKeyDown={handleKeyDown}
            placeholder={`继续聊聊「${workspaceName}」…（例如：我们决定采用 SQLite WAL 存储记忆，请记下这条规范）`}
            className="w-full resize-none bg-transparent text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/75 focus:outline-none leading-relaxed"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 mt-1 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)]">
            <div className="flex flex-wrap items-center gap-2">
              <span>Enter 发送 · Shift+Enter 换行</span>
              <span aria-hidden="true">·</span>
              <span>草稿仅绑定「{workspaceName}」</span>
            </div>

            <div className="flex items-center gap-2">
              {isRunning ? (
                <button
                  type="button"
                  onClick={onCancelRun}
                  data-testid="stop-generation-button"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium bg-[#b74a46] text-white hover:bg-[#9e3e3a] transition-all active:scale-[0.97] whitespace-nowrap shrink-0"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>停止生成</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!canSendRemote || !draft.trim()}
                  onClick={onSend}
                  aria-label="发送消息"
                  data-testid="send-message-button"
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-medium bg-[#c27537] text-white hover:bg-[#b0672c] disabled:opacity-35 shadow-xs transition-all active:scale-[0.97] whitespace-nowrap shrink-0"
                >
                  <span>发送</span>
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
