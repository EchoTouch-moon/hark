import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /** 页面主标题（渲染为唯一的 h1） */
  title: string;
  /** 副标题，一句话说明页面用途 */
  subtitle?: string;
  /** 标题右侧操作区（按钮/徽标等） */
  actions?: ReactNode;
}

/**
 * 页面统一头：每页只有一个 h1，保证可访问性与一致节奏。
 */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1 className="page-header-title">{title}</h1>
        {subtitle ? <p className="page-header-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}
