import { EmptyState, PageHeader } from '../components';

/**
 * U01 Home（占位）：今天值得处理的事 / Action Card 列表在 M1-T05 接入。
 */
export function HomePage() {
  return (
    <section className="page">
      <PageHeader title="今天" subtitle="值得你注意的事，会安静地出现在这里" />
      <div className="page-section" aria-label="需要你决定">
        <p className="page-section-title">需要你决定</p>
        <EmptyState hint="Hearth 会在有把握、且确实值得的时候才打扰你" />
      </div>
    </section>
  );
}
