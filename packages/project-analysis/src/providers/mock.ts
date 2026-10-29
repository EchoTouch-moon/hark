import type { Recommendation } from '../contracts.js';
import type { AnalysisProvider, AnalyzeInput } from './types.js';

export class MockAnalysisProvider implements AnalysisProvider {
  readonly id = 'mock';
  readonly model: string = 'mock-deterministic/1';

  async analyze(input: AnalyzeInput): Promise<import('../contracts.js').ProviderOutcome> {
    if (input.signal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    const context = input.context;
    const evidence = context.availableEvidence.slice(0, 3);
    if (evidence.length === 0) {
      return { kind: 'no_recommendation', reason: 'context has no verifiable evidence' };
    }
    const dirty = !context.worktree.clean;
    const testUnknown = context.testResult === 'UNKNOWN';
    const recommendation: Recommendation = {
      target: `只读分析项目 ${context.projectName}`,
      scope: '观察快照、最近事件与白名单文档，不执行命令或修改代码。',
      statusSummary: [
        context.branch ? `当前分支 ${context.branch}` : '分支未知',
        context.headSha ? `HEAD ${context.headSha.slice(0, 12)}` : 'HEAD 未记录',
        context.testDisclaimer,
        dirty ? '工作区有未提交改动。' : '工作区干净。',
      ].join(' '),
      findings: [
        {
          title: testUnknown ? '测试证据不足' : `测试状态 ${context.testResult}`,
          detail: context.testDisclaimer,
          evidenceRefs: evidence.filter((item) => item.kind === 'snapshot' || item.kind === 'health').slice(0, 2),
          verified: true,
        },
        {
          title: dirty ? '工作区不干净' : '最近观察事件',
          detail: context.events[0]
            ? `最近事件 ${context.events[0].type}。不能用提交次数推断任务完成。`
            : '还没有足够的变化事件。',
          evidenceRefs: evidence.filter((item) => item.kind === 'observer_event' || item.kind === 'file').slice(0, 2),
          verified: evidence.some((item) => item.kind === 'observer_event' || item.kind === 'file'),
        },
      ],
      confidence: testUnknown ? 'low' : 'medium',
      uncertainties: [
        'HEAD 绑定未确定时，不能声称当前提交失败或通过。',
        ...(context.files.length === 0 ? ['未读到项目文档，建议范围仅限观察事实。'] : []),
      ],
      nextActions: [
        {
          title: dirty ? '先确认未提交改动是否有意保留' : '补充可观察的测试报告',
          detail: dirty
            ? '只读分析不会帮你提交或丢弃改动。请在仓库里自行决定。'
            : '若需要测试结论，请声明 JUnit 报告路径后再扫描。',
          requiresConfirmation: true,
        },
      ],
      risks: ['此结果来自 Mock Provider，不是真实模型。'],
    };
    return { kind: 'recommendation', recommendation };
  }
}
