import React from "react";
import { AlertTriangle, RefreshCw, Settings } from "lucide-react";
import { HarkUIError } from "../../bridge/HarkBridge";
import { resolveErrorDescriptor } from "../../bridge/schemas";

interface OfflineErrorBannerProps {
  error?: HarkUIError | null;
  onRetry?: () => void;
  onOpenAppSettings?: () => void;
  onDismiss?: () => void;
}

/**
 * FE-15 · ErrorBoundary / OfflineState
 * PRD §5, §7.7, §9.2:
 * - Backend/Sidecar 失联或模型/权限错误时，显示明确的机器可判别错误语义与可恢复操作。
 * - 故障不伪装正常，绝不自动静默转 Demo / Mock。
 */
export const OfflineErrorBanner: React.FC<OfflineErrorBannerProps> = ({
  error,
  onRetry,
  onOpenAppSettings,
  onDismiss,
}) => {
  if (!error) return null;

  const descriptor = resolveErrorDescriptor(error.code);

  return (
    <div
      role="alert"
      data-testid={`hark-error-banner-${error.code}`}
      className="mb-5 rounded-[var(--corner-md)] border border-[#b74a46]/45 bg-[#b74a46]/[0.09] px-4 py-3.5 text-xs space-y-2 backdrop-blur-md"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-semibold text-[#b74a46] dark:text-[#f28b87]">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{descriptor.title}</span>
            <span className="font-mono font-normal text-[11px] opacity-80">
              [{error.code}]
            </span>
          </div>
          <p className="text-[var(--text-primary)] leading-relaxed">{error.message}</p>
          <p className="text-[11px] text-[var(--text-muted)]">{descriptor.explanation}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onRetry && descriptor.retryable && (
            <button
              type="button"
              onClick={onRetry}
              data-testid="error-retry-button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium bg-[#b74a46] text-white hover:bg-[#9e3e3a] transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{error.recoveryActionLabel || descriptor.actionLabel}</span>
            </button>
          )}
          {onOpenAppSettings && (
            <button
              type="button"
              onClick={onOpenAppSettings}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-medium border border-[var(--border-strong)] bg-[var(--surface-solid)] text-[var(--text-primary)] hover:border-[#e88e47] transition-colors whitespace-nowrap shrink-0"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>运行设置</span>
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="px-2 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              关闭提示
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
