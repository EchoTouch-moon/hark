/**
 * @fileoverview 用户人工授权凭证定义（Approval Grant）
 * 针对 L2/external_write 等高危或产生外部副作用的操作，记录持久化授权凭据。
 * 包含操作摘要、目标摘要、有效期限及授权能力集，严格防止权限漂移与越权重放。
 */

import { z } from 'zod';
import { RiskSchema } from './enums.js';
import { IdSchema, IsoDateTimeSchema } from './common.js';

/**
 * 授权凭证 Schema
 * 强绑定特定 ActionDigest 与 TargetDigest，若参数或目标被篡改则授权即刻失效
 */
export const ApprovalGrantSchema = z
  .object({
    /** 授权记录唯一 ID */
    id: IdSchema,
    /** 授权发起主体（用户或管理员标识） */
    principalId: IdSchema,
    /** 关联的动作卡片 ID */
    cardId: IdSchema,
    /** 语义动作规范的 SHA-256 摘要（强校验参数与效果，排除易变的时间戳） */
    actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    /** 动作目标的 SHA-256 摘要（目标变更即导致授权失效） */
    targetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    /** 授权时的风险等级确认 */
    risk: RiskSchema,
    /** 明确授权开启的能力白名单 */
    authorizedCapabilities: z.array(z.string().min(1).max(64)).max(16),
    /** 授权过期时间（ISO-8601，防止长期挂起凭据被滥用） */
    expiresAt: IsoDateTimeSchema,
    /** 授予时间（ISO-8601） */
    grantedAt: IsoDateTimeSchema,
    /** 实际消耗/使用时间（可选，已消耗的凭据不可重复使用） */
    consumedAt: IsoDateTimeSchema.optional(),
  })
  .strict();
export type ApprovalGrant = z.infer<typeof ApprovalGrantSchema>;
