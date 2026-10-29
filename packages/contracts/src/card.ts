/**
 * @fileoverview 动作卡片模型（ActionCard）
 * 用户在 Home 主动工作台或项目页直接可见的交互实体。
 * 承载了从 Candidate 转化而来的建议、上下文依据、关联动作及用户交互状态（如延后、忽略、执行状态等）。
 */

import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './common.js';
import { SourceRefSchema } from './source.js';
import { ActionSpecSchema } from './action.js';

/**
 * 卡片状态枚举
 * - proposed: 已推送到卡片列表，待用户操作
 * - dismissed: 用户主动忽略
 * - snoozed: 用户暂时延后（特定时间后恢复）
 * - expired: 已过有效期，自动失效
 * - ready: 准备执行
 * - awaiting_approval: 需要人工审批确认
 * - executing: 动作正在执行中
 * - verifying: 执行完毕，独立核验中
 * - completed: 执行并验证通过，成功闭环
 * - failed: 执行失败或验证未通过
 * - blocked: 因策略阻断（如超出每日预算、静默时段拦截、审批被拒）
 */
export const CardStatusSchema = z.enum([
  'proposed',
  'dismissed',
  'snoozed',
  'expired',
  'ready',
  'awaiting_approval',
  'executing',
  'verifying',
  'completed',
  'failed',
  'blocked',
]);
export type CardStatus = z.infer<typeof CardStatusSchema>;

/** 用户对卡片的主动反馈评价 */
export const UserFeedbackSchema = z.enum(['useful', 'not_useful', 'irrelevant']);
export type UserFeedback = z.infer<typeof UserFeedbackSchema>;

/**
 * 动作卡片 Schema
 */
export const ActionCardSchema = z
  .object({
    /** 卡片唯一 ID */
    id: IdSchema,
    /** 来源候选 ID */
    candidateId: IdSchema,
    /** 所属项目 ID */
    projectId: IdSchema,
    /** 展示标题 */
    title: z.string().min(1).max(200),
    /** 为何当下推荐（用户解释依据） */
    whyNow: z.string().min(1).max(500),
    /** 证据引用列表（供用户在抽屉中展开核验） */
    evidence: z.array(SourceRefSchema).min(1).max(16),
    /** 待执行的动作规范 */
    action: ActionSpecSchema,
    /** 创建时间（ISO-8601） */
    createdAt: IsoDateTimeSchema,
    /** 失效时间（ISO-8601） */
    expiresAt: IsoDateTimeSchema,
    /** 当前卡片状态 */
    status: CardStatusSchema,
    /** 延后截止时间（仅当 status === 'snoozed' 时有效） */
    snoozedUntil: IsoDateTimeSchema.optional(),
    /** 用户的反馈标记 */
    userFeedback: UserFeedbackSchema.optional(),
  })
  .strict();
export type ActionCard = z.infer<typeof ActionCardSchema>;
