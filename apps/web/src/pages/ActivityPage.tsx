import { useParams } from 'react-router-dom';
import { EmptyState, PageHeader } from '../components';

/**
 * U04 Activity（占位）：
 * - /activity           → 执行记录列表（缺少 runId 时的落点）
 * - /activity/:runId    → 单条执行的详情（状态时间线 / 步骤 / 证据）
 */
export function ActivityPage() {
  const { runId } = useParams<{ runId: string }>();

  if (runId !== undefined) {
    return (
      <section className="page">
        <PageHeader title="执行记录" subtitle={`Run ${runId}`} />
        <div className="page-section" aria-label="执行时间线">
          <EmptyState
            title="执行详情尚未就绪"
            hint="状态时间线、每一步工具调用与验证证据将在这里展示"
          />
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <PageHeader title="执行记录" subtitle="最近的任务执行与验证结果" />
      <div className="page-section" aria-label="执行列表">
        <EmptyState
          title="还没有执行记录"
          hint="从 Home 的行动卡片发起执行后，记录会出现在这里"
        />
      </div>
    </section>
  );
}
