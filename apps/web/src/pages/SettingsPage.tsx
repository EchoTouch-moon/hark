import { EmptyState, PageHeader } from '../components';

/**
 * U05 Settings（占位）：环境状态 / 数据源开关 / quiet hours /
 * max cards per day / 清空 Demo DB 在后续任务接入。
 */
export function SettingsPage() {
  return (
    <section className="page">
      <PageHeader title="设置" subtitle="运行环境、数据源与打扰边界" />
      <div className="page-section" aria-label="设置项">
        <EmptyState
          title="设置项尚未就绪"
          hint="环境状态、数据源开关与安静时段将在这里提供"
        />
      </div>
    </section>
  );
}
