import type { RunStep } from '@hearth/contracts';
import { formatDateTime } from '../features/runs';

/**
 * TaskTimeline（docs/02-U04）：按 sequence 渲染 RunStep。
 * - 失败步骤红色强调；
 * - 运行中步骤显示转圈指示（prefers-reduced-motion 时降级为静态标记）；
 * - 不展示任何 secret 参数（服务端投影已保证，前端只渲染 name/detail）。
 */

export interface TaskTimelineProps {
  steps: RunStep[];
}

type StepStatus = RunStep['status'];

const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  pending: '等待中',
  running: '进行中',
  succeeded: '成功',
  failed: '失败',
  skipped: '跳过',
};

function stepStatusTone(status: StepStatus): string {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'danger';
    case 'running':
      return 'info';
    default:
      return 'neutral'; // pending / skipped
  }
}

export function TaskTimeline({ steps }: TaskTimelineProps) {
  if (steps.length === 0) {
    return (
      <p className="timeline-empty" role="status">
        还没有记录到任何步骤
      </p>
    );
  }

  const ordered = [...steps].sort((a, b) => a.sequence - b.sequence);

  return (
    <ol className="task-timeline" aria-label="执行步骤时间线">
      {ordered.map((step) => {
        const tone = stepStatusTone(step.status);
        return (
          <li key={step.id} className={`timeline-step is-${step.status}`}>
            <span className={`timeline-marker is-${tone}`} aria-hidden="true">
              {step.status === 'running' ? <span className="timeline-spinner" /> : null}
            </span>
            <div className="timeline-step-body">
              <div className="timeline-step-head">
                <span className="timeline-step-sequence">#{step.sequence}</span>
                <span className="timeline-step-name">{step.name}</span>
                <span className={`status-badge is-${tone}`}>{STEP_STATUS_LABELS[step.status]}</span>
              </div>
              {step.detail ? <p className="timeline-step-detail">{step.detail}</p> : null}
              <p className="timeline-step-times">
                开始 {formatDateTime(step.startedAt)} · 结束 {formatDateTime(step.endedAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
