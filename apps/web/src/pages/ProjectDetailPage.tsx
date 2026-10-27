import { useParams } from 'react-router-dom';
import { EmptyState, PageHeader } from '../components';

/**
 * U03 项目详情（占位）：项目目的 / milestone / 最近事件 / Artifacts
 * 在后续任务接入。
 */
export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <section className="page">
      <PageHeader
        title="项目详情"
        subtitle={id ? `项目 ${id}` : '未指定项目'}
      />
      <div className="page-section" aria-label="项目快照">
        <EmptyState title="项目快照尚未就绪" hint="目的、里程碑与最近事件将在这里展示" />
      </div>
    </section>
  );
}
