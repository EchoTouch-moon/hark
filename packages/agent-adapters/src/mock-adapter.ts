export interface ChatMessageInput {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ChatStep {
  name: string;
  detail: string;
}

export interface ChatReply {
  content: string;
  steps: ChatStep[];
  adapter: 'mock';
  live: false;
}

export interface AgentAdapterInfo {
  id: string;
  live: boolean;
  label: string;
}

/**
 * Deterministic offline mock. It performs NO network calls and NEVER claims
 * to be a real model: every reply is labeled as demo output. The steps it
 * reports are recorded as run trace for transparency.
 */
export class MockAgentAdapter {
  readonly info: AgentAdapterInfo = { id: 'mock', live: false, label: '离线演示 · 不连接模型' };

  async reply(input: { message: string; history: ChatMessageInput[] }): Promise<ChatReply> {
    const { message } = input;
    const turn = input.history.filter((m) => m.role === 'user').length + 1;
    const steps: ChatStep[] = [
      { name: 'mock.understand', detail: `解析输入（${message.length} 字）` },
      { name: 'mock.plan', detail: '基于规则选择回复模板' },
    ];
    const content = this.compose(message, turn);
    steps.push({ name: 'mock.compose', detail: '生成离线演示回复' });
    return { content, steps, adapter: 'mock', live: false };
  }

  private compose(message: string, turn: number): string {
    const m = message.trim();
    if (/你好|hello|hi/i.test(m)) {
      return '你好！我是 Hearth 的**离线演示**助手：当前未连接任何真实模型（Hermes 未配置）。我可以陪你看卡片、解释证据来源，但不会假装已经接入真模型。';
    }
    if (/ci|构建|build|失败/i.test(m)) {
      return '关于 CI 失败：Home 里的「项目构建未通过」卡片就是这条合成事件（`fixture://github/project-atlas/runs/42`）。点击「开始诊断」后，MockExecutor 会在 `.hearth-demo-artifacts/report/` 写入诊断 JSON，并由独立 Verifier 校验 SHA-256 后才算完成。当前为**离线演示模式**。';
    }
    if (/会议|日程|calendar/i.test(m)) {
      return '会议冲突这条是合成日历事件。对应卡片只会生成**本地草稿文件**（drafts/meeting-adjustment.md），不会发送任何邮件——发送属于 L2 外部副作用，需要你在场批准，且本演示不提供该通道。';
    }
    return `收到（第 ${turn} 轮）：「${m.slice(0, 80)}${m.length > 80 ? '…' : ''}」\n\n这是 Mock 适配器的确定性回复，用于演示聊天流与运行轨迹。要体验真实闭环，可以去 Home 执行一张动作卡片。`;
  }
}

export function isHermesConfigured(): boolean {
  // P0: Hermes is optional and disabled by default; never fake a connection.
  return process.env['HEARTH_HERMES_URL'] !== undefined && process.env['HEARTH_HERMES_URL'] !== '';
}
