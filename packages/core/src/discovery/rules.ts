/**
 * @fileoverview 主动发现规则引擎与候选构造（Discovery Rules）
 * 包含事件匹配模板（RuleTemplate）、噪声过滤（isNoise）、时效衰减因子计算（recencyFactor）
 * 以及从底层 Event 转换为具有可解释性（whyNow）和确定性 ActionSpec 的 Candidate。
 */

import type { ActionSpec, Candidate, Event, Risk } from '@hearth/contracts';
import { deriveIdempotencyKey } from '@hearth/contracts';
import { ACTION_REGISTRY } from '../policy/action-registry.js';

/**
 * 规则模板契约
 * 声明针对特定事件的匹配逻辑与建议卡片生成参数
 */
export interface RuleTemplate {
  /** 匹配函数：判定该事件是否适用于此规则 */
  matches: (e: Event) => boolean;
  /** 卡片展示标题 */
  title: string;
  /** 为何当下提示用户（whyNow 解释） */
  whyNow: (e: Event) => string;
  /** 建议动作类型 */
  actionType: ActionSpec['actionType'];
  /** 产物生成路径映射函数 */
  artifactPath: (e: Event) => string;
  /** 提取动作参数字典 */
  params: (e: Event) => Record<string, unknown>;
  /** 规则基础打分（0~1） */
  baseScore: number;
  /** 建议有效存活时间（小时） */
  ttlHours: number;
}

/**
 * 内置主动发现规则库
 * 包含：
 * 1. CI 构建失败诊断（repo.ci_failed）
 * 2. 学习/研究下一步待办（study.next_step_pending）
 * 3. 会议时间冲突协调草稿（calendar.conflict）
 */
const RULES: RuleTemplate[] = [
  {
    matches: (e) => e.type === 'repo.ci_failed',
    title: '项目构建未通过',
    whyNow: (e) => `CI 失败会阻断下一步合入（${e.summary}）`,
    actionType: 'report.generate',
    artifactPath: (e) => `report/${e.source.sourceId}.json`,
    params: (e) => ({ runId: e.source.sourceId, uri: e.source.uri }),
    baseScore: 0.9,
    ttlHours: 24,
  },
  {
    matches: (e) => e.type === 'study.next_step_pending',
    title: '可以继续上次的研究',
    whyNow: (e) => `用户确认过的下一步还没有完成（${e.summary}）`,
    actionType: 'checklist.generate',
    artifactPath: (e) => `checklists/${e.projectId}-experiment.md`,
    params: (e) => ({ topic: e.tags[0] ?? 'experiment' }),
    baseScore: 0.7,
    ttlHours: 48,
  },
  {
    matches: (e) => e.type === 'calendar.conflict',
    title: '两场会议需要协调',
    whyNow: (e) => `两个时间段发生冲突，宜尽早给出调整草稿（${e.summary}）`,
    actionType: 'draft.generate',
    artifactPath: () => 'drafts/meeting-adjustment.md',
    params: (e) => ({ eventRef: e.source.sourceId }),
    baseScore: 0.8,
    ttlHours: 12,
  },
];

/**
 * 为指定事件查找首个匹配的规则模板
 */
export function ruleFor(event: Event): RuleTemplate | null {
  return RULES.find((r) => r.matches(event)) ?? null;
}

/**
 * 判断事件是否属于无关噪声（无任何规则匹配的事件视为噪声并予以跳过）
 */
export function isNoise(event: Event): boolean {
  return ruleFor(event) === null;
}

/**
 * 提取事件数据源的版本指纹（优先使用 contentHash，降级为 observedAt）
 */
export function sourceVersionOf(event: Event): string {
  return event.source.contentHash ?? event.source.observedAt;
}

/**
 * 计算事件的时效性衰减因子
 * 48 小时内从 1.0 线性衰减至 0.5（底线），越新的事件权重越高
 */
export function recencyFactor(event: Event, now: Date): number {
  const ageH = Math.max(0, (now.getTime() - new Date(event.observedAt).getTime()) / 3_600_000);
  return Math.max(0.5, 1 - ageH / 48);
}

/**
 * 依据匹配规则为事件构造候选建议（Candidate）
 * 组装动作规范（ActionSpec）、计算幂等键与初始评分，并填充为什么现在（whyNow）与证据链
 * 
 * @param event 原始源事件
 * @param nowIso 当前时钟时间戳
 * @returns 构造好的 Candidate 对象，若无匹配规则则返回 null
 */
export function buildCandidate(event: Event, nowIso: string): Candidate | null {
  const rule = ruleFor(event);
  if (!rule) return null;
  const reg = ACTION_REGISTRY[rule.actionType];
  const now = new Date(nowIso);
  const ttlMs = rule.ttlHours * 3_600_000;
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const sourceVersion = sourceVersionOf(event);
  const artifactPath = rule.artifactPath(event);
  const target = { resourceId: event.source.sourceId, path: artifactPath };
  const params = rule.params(event);
  const action: ActionSpec = {
    id: `act-${event.id}`,
    actionType: rule.actionType,
    projectId: event.projectId,
    target,
    params,
    allowedCapabilities: [...reg.requiredCapabilities],
    risk: reg.riskFloor,
    effect: reg.effect,
    maxSteps: 8,
    timeoutMs: 30_000,
    maxCostUsd: 0,
    idempotencyKey: deriveIdempotencyKey({ actionType: rule.actionType, projectId: event.projectId, target, params, sourceVersion }),
    expectedSourceVersion: sourceVersion,
    verification:
      rule.actionType === 'report.generate'
        ? { kind: 'json_schema', artifactPath }
        : { kind: 'artifact_sha256', artifactPath },
  };
  return {
    id: `cand-${event.id}`,
    projectId: event.projectId,
    eventIds: [event.id],
    title: rule.title,
    whyNow: rule.whyNow(event),
    evidence: [event.source],
    suggestedAction: action,
    score: rule.baseScore * recencyFactor(event, now),
    confidence: event.provenance === 'user_confirmed' ? 0.95 : 0.8,
    risk: reg.riskFloor as Risk,
    expiresAt,
    suppressionKey: event.dedupeKey,
    status: 'proposed',
  };
}
