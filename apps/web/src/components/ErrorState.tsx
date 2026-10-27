import './ErrorState.css';

export interface ErrorStateProps {
  /** 真实错误信息（来自 ApiError.message 等），不做遮掩 */
  message: string;
  /** 提供时展示「重试」按钮 */
  onRetry?: () => void;
}

/**
 * 错误态：如实展示错误原因，并提供安全的重试入口。
 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <p className="error-state-title">出了点问题</p>
      <p className="error-state-message">{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn-ghost error-state-retry" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}
