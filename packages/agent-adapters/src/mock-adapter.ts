/**
 * @fileoverview 离线模拟 Agent 适配器（Mock Agent Adapter）
 * 
 * 遵守项目最高诚信准则（P-01 Zero false claims）：
 * 1. 绝对不发起任何外部模型网络调用
 * 2. 严禁假装在线或伪造已经与真实大模型/Hermes 集成
 * 3. 每一条回复显式附带 `[离线演示 · 不连接模型]` 标签
 * 4. 真实上报执行追踪步骤（ChatStep），供界面半透明审查
 */

export interface ChatMessageInput {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/** 对话步骤透明追踪信息 */
export interface ChatStep {
  name: string;
  detail: string;
}

/** 对话回复结构体 */
export interface ChatReply {
  content: string;
  steps: ChatStep[];
  adapter: 'mock';
  live: false;
}

/** 适配器元信息 */
export interface AgentAdapterInfo {
  id: string;
  live: boolean;
  label: string;
}

/**
 * 确定性离线模拟适配器
 */
export class MockAgentAdapter {
  readonly info: AgentAdapterInfo = { id: 'mock', live: false, label: '离线演示 · 不连接模型' };

  /**
   * 生成确定性的离线演示回复
   * @param input 当前消息与历史会话
   */
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

  /** 基于规则模板组合回复文案 */
  private compose(message: string, turn: number): string {
    const m = message.trim();
    if (/你好|hello|hi/i.test(m)) {
      return '你好。我是 Hearth 的**离线演示**助手：当前未连接任何真实模型，旧主动建议和执行操作暂不可用。';
    }
    if (/ci|构建|build|失败/i.test(m)) {
      return '关于构建失败：这是**离线演示**说明，当前未连接真实模型；旧模拟执行操作暂不可用。';
    }
    if (/会议|日程|calendar/i.test(m)) {
      return '这是离线演示，当前不会发送邮件，也不能执行会议调整。';
    }
    return `收到（第 ${turn} 轮）：「${m.slice(0, 80)}${m.length > 80 ? '…' : ''}」\n\n这是 Mock 适配器的确定性回复（离线演示 · 不连接模型）。旧主动建议和执行操作暂不可用。`;
  }
}

/**
 * 探测 Hermes 真实外部服务是否已配置
 * 默认关闭，未配置时诚实返回 false
 */
export function isHermesConfigured(): boolean {
  // P0: Hermes is optional and disabled by default; never fake a connection.
  return process.env['HEARTH_HERMES_URL'] !== undefined && process.env['HEARTH_HERMES_URL'] !== '';
}
