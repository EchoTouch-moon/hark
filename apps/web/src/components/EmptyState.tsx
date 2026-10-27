import type { ReactNode } from 'react';
import './EmptyState.css';

export interface EmptyStateProps {
  /** 空态主文案；默认是「平和空态」文案 */
  title?: string;
  /** 补充说明，解释为什么是空的 / 接下来会发生什么 */
  hint?: string;
  /** 可选操作区（例如「重新扫描」按钮） */
  action?: ReactNode;
}

/**
 * 平和空态：不制造焦虑、不伪造任务。
 */
export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state-glyph" aria-hidden="true" />
      <p className="empty-state-title">
        {title ?? '目前没有值得打扰你的事情'}
      </p>
      {hint ? <p className="empty-state-hint">{hint}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
