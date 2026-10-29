/**
 * @fileoverview 发现候选建议模型（Candidate）
 * 经过主动规则引擎匹配原始事件后产生的初步建议候选。
 * 包含事件依据、为何当下提示（whyNow）、推荐动作、置信度以及去重抑制键。
 */

import { z } from 'zod';
import { RiskSchema } from './enums.js';
import { IdSchema, IsoDateTimeSchema } from './common.js';
import { SourceRefSchema } from './source.js';
import { ActionSpecSchema } from './action.js';

/**
 * 候选建议生命周期状态
 * - candidate: 已生成候选但尚未向前端推送
 * - suppressed: 已被去重/静默/抑制规则过滤
 * - proposed: 已推送到卡片（ActionCard）向用户展示
 */
export const CandidateStatusSchema = z.enum(['candidate', 'suppressed', 'proposed']);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

/**
 * 候选建议规范 Schema
 */
export const CandidateSchema = z
  .object({
    /** 候选唯一 ID */
    id: IdSchema,
    /** 所属项目 ID */
    projectId: IdSchema,
    /** 触发该建议的源事件 ID 列表（支持聚合 1~16 个事件） */
    eventIds: z.array(IdSchema).min(1).max(16),
    /** 呈现给用户的卡片标题 */
    title: z.string().min(1).max(200),
    /** 解释性文案：为何在当前时间点主动向用户推荐此卡片 */
    whyNow: z.string().min(1).max(500),
    /** 关联的证据源引用列表（可溯源） */
    evidence: z.array(SourceRefSchema).min(1).max(16),
    /** 推荐执行的动作规范 */
    suggestedAction: ActionSpecSchema,
    /** 综合排序得分（0~1，基于时效性与重要度权重加权计算） */
    score: z.number().min(0).max(1),
    /** 证据置信度（0~1，根据来源可靠性判定） */
    confidence: z.number().min(0).max(1),
    /** 风险级别 */
    risk: RiskSchema,
    /** 过期时间（超时未处理则失效） */
    expiresAt: IsoDateTimeSchema,
    /** 去重抑制键（相同 suppressionKey 在生效期内不重复上屏） */
    suppressionKey: z.string().min(1).max(256),
    /** 当前状态 */
    status: CandidateStatusSchema,
  })
  .strict();
export type Candidate = z.infer<typeof CandidateSchema>;
