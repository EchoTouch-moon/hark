import { ConnectionBadge, EmptyState, PageHeader } from '../components';

/**
 * U02 Chat（占位）：消息区 / 输入框 / Run Timeline 在后续任务接入。
 * 页面必须标注「离线演示 · 不连接模型」。
 */
export function ChatPage() {
  return (
    <section className="page">
      <PageHeader
        title="对话"
        subtitle="和 Hearth 讨论，或让它替你跑一个小任务"
        actions={<ConnectionBadge mode="demo" label="离线演示 · 不连接模型" />}
      />
      <div className="page-section" aria-label="消息">
        <EmptyState
          title="开始一段对话"
          hint="回复由本机 Mock Adapter 生成，不连接任何模型"
        />
      </div>
    </section>
  );
}
