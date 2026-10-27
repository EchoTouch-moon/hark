import { EmptyState, PageHeader } from '../components';

/**
 * U03 Projects（占位）：项目磁贴 / 列表在后续任务接入。
 */
export function ProjectsPage() {
  return (
    <section className="page">
      <PageHeader title="项目" subtitle="你授权给 Hearth 关注的项目" />
      <div className="page-section" aria-label="项目列表">
        <EmptyState
          title="还没有项目"
          hint="初始化演示数据后，会在这里看到 Project Atlas 与 Project Beacon"
        />
      </div>
    </section>
  );
}
