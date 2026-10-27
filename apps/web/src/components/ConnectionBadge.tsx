import './ConnectionBadge.css';

/** 连接模式：demo=离线演示，live=已连接真实适配器，disconnected=连接断开 */
export type ConnectionMode = 'demo' | 'live' | 'disconnected';

const CONNECTION_LABELS: Record<ConnectionMode, string> = {
  demo: '离线演示',
  live: '已连接',
  disconnected: '连接已断开',
};

export interface ConnectionBadgeProps {
  /** 连接模式，默认 demo（M1 阶段整个前端均为离线演示） */
  mode?: ConnectionMode;
  /** 覆盖默认文案（如 Chat 页的「离线演示 · 不连接模型」） */
  label?: string;
}

/**
 * 连接状态徽标：明确告诉用户当前是演示还是真实连接，
 * 永不让 UI 假装已接入真实服务。
 */
export function ConnectionBadge({ mode = 'demo', label }: ConnectionBadgeProps) {
  const text = label ?? CONNECTION_LABELS[mode];
  return (
    <span
      className={`connection-badge connection-badge--${mode}`}
      role="status"
      aria-label={`连接状态：${text}`}
    >
      <span className="connection-badge-dot" aria-hidden="true" />
      {text}
    </span>
  );
}
