/**
 * @fileoverview 任务执行生命周期与有限状态机（TaskRun State Machine）
 * 严格按照 docs/04-CONTRACTS.md 规范实现任务运行模型、单步追踪（RunStep）与状态流转规则。
 * 结构性禁止任何状态越级（如 queued→completed、executing→completed），保证每一个成功必须经由验证环节。
 */

import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './common.js';

/**
 * 任务执行状态枚举
 * - queued: 已入队，等待策略检查或调度
 * - awaiting_approval: 等待人工授权（L2 动作或高危操作）
 * - executing: 执行器正在运行具体步骤
 * - verifying: 执行完毕，独立核验器检查产物有效性
 * - completed: 执行成功且核验通过（终态）
 * - pending_verification: 遇到异常挂起（如系统中断恢复），待重新验证
 * - failed: 运行出错或核验未通过（终态）
 * - blocked: 被安全策略阻断（终态）
 * - cancelled: 用户主动取消（终态）
 */
export const RunStateSchema = z.enum([
  'queued',
  'awaiting_approval',
  'executing',
  'verifying',
  'completed',
  'pending_verification',
  'failed',
  'blocked',
  'cancelled',
]);
export type RunState = z.infer<typeof RunStateSchema>;

/** 验证裁决结果：pass(通过), fail(失败), unknown(未知/无法确认) */
export const VerificationVerdictSchema = z.enum(['pass', 'fail', 'unknown']);
export type VerificationVerdict = z.infer<typeof VerificationVerdictSchema>;

/**
 * 失败归类
 * 用于统计与排错定位根因
 */
export const FailureClassSchema = z.enum([
  'timeout',        // 超时
  'policy',         // 安全/策略拒绝
  'dependency',     // 外部依赖失败
  'executor',       // 执行器内部错误
  'verification',   // 产物验证失败
  'unknown',        // 未知错误
]);
export type FailureClass = z.infer<typeof FailureClassSchema>;

/**
 * 任务运行实例模型（TaskRun）
 */
export const TaskRunSchema = z
  .object({
    /** 任务运行全局唯一 ID */
    id: IdSchema,
    /** 触发该运行的卡片 ID */
    cardId: IdSchema,
    /** 关联的动作规范 ID */
    actionId: IdSchema,
    /** 幂等键（64位十六进制哈希），数据库层唯一约束 */
    idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
    /** 当前运行状态 */
    state: RunStateSchema,
    /** 创建时间（ISO-8601） */
    createdAt: IsoDateTimeSchema,
    /** 开始执行时间 */
    startedAt: IsoDateTimeSchema.optional(),
    /** 结束时间 */
    endedAt: IsoDateTimeSchema.optional(),
    /** 产出的产物引用路径列表 */
    resultArtifactRefs: z.array(z.string().min(1).max(1024)).max(32),
    /** 最终验证裁决 */
    verificationVerdict: VerificationVerdictSchema.optional(),
    /** 失败归因 */
    failureClass: FailureClassSchema.optional(),
  })
  .strict();
export type TaskRun = z.infer<typeof TaskRunSchema>;

/**
 * 单个执行步骤记录（RunStep）
 * 用于前端时间线渲染和证据追踪
 */
export const RunStepSchema = z
  .object({
    /** 步骤 ID */
    id: IdSchema,
    /** 关联的任务运行 ID */
    runId: IdSchema,
    /** 步骤执行序号（从 0 开始升序） */
    sequence: z.number().int().min(0).max(999),
    /** 步骤名称（如 diagnose.read_event, report.write_json） */
    name: z.string().min(1).max(128),
    /** 步骤状态 */
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
    /** 步骤开始时间 */
    startedAt: IsoDateTimeSchema.optional(),
    /** 步骤结束时间 */
    endedAt: IsoDateTimeSchema.optional(),
    /** 详细描述或执行证据摘要 */
    detail: z.string().max(4000).optional(),
  })
  .strict();
export type RunStep = z.infer<typeof RunStepSchema>;

/**
 * 状态机合法流转图（系统唯一事实来源）
 * 严格禁止跳过验证步骤直接标记为 completed
 */
export const RUN_STATE_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  queued: ['awaiting_approval', 'executing', 'cancelled', 'blocked'],
  awaiting_approval: ['executing', 'blocked', 'cancelled'],
  executing: ['verifying', 'failed', 'cancelled', 'pending_verification'],
  verifying: ['completed', 'failed', 'pending_verification'],
  pending_verification: ['verifying', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  blocked: [],
  cancelled: [],
};

/** 终态列表（不可再向其他状态流转） */
export const TERMINAL_RUN_STATES: readonly RunState[] = [
  'completed',
  'failed',
  'blocked',
  'cancelled',
];

/** 判断状态是否为终态 */
export function isTerminalRunState(state: RunState): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

/** 校验状态流转是否合法 */
export function canTransitionRun(from: RunState, to: RunState): boolean {
  return RUN_STATE_TRANSITIONS[from].includes(to);
}

/** 非法状态流转异常 */
export class InvalidRunTransitionError extends Error {
  constructor(
    public readonly from: RunState,
    public readonly to: RunState,
  ) {
    super(`illegal run state transition ${from} -> ${to}`);
    this.name = 'InvalidRunTransitionError';
  }
}

/**
 * 断言状态流转合法性
 * @throws {InvalidRunTransitionError} 如果状态转换不合法
 */
export function assertRunTransition(from: RunState, to: RunState): void {
  if (!canTransitionRun(from, to)) throw new InvalidRunTransitionError(from, to);
}
