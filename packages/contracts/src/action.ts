/**
 * @fileoverview 动作规范定义（Action Specification）
 * 包含执行动作的目标、参数、安全限制（权限能力、风险等级、执行效果）以及产物验证规则。
 */

import { z } from 'zod';
import { ActionTypeSchema, EffectTypeSchema, RiskSchema, VerificationKindSchema } from './enums.js';
import { IdSchema } from './common.js';

/**
 * 动作产物验证规范
 * 定义动作执行完毕后，用于核验执行真实性与有效性的规则
 */
export const ActionVerificationSchema = z
  .object({
    /** 验证方式：产物哈希核验、JSON Schema 校验或远端回读 */
    kind: VerificationKindSchema,
    /** 期望生成的产物相对路径（限制在 demo-artifacts 根目录下） */
    artifactPath: z.string().max(512).optional(),
    /** 预期的产物 SHA-256 哈希值 */
    expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict();
export type ActionVerification = z.infer<typeof ActionVerificationSchema>;

/**
 * 动作作用目标
 * 标识动作影响的具体资源或文件路径
 */
export const ActionTargetSchema = z
  .object({
    /** 目标资源标识符 */
    resourceId: z.string().min(1).max(256),
    /** 目标相对路径（可选） */
    path: z.string().max(1024).optional(),
  })
  .strict();
export type ActionTarget = z.infer<typeof ActionTargetSchema>;

/**
 * 完整动作规范（ActionSpec）
 * 包含动作执行所需的全部上下文字段与安全边界约束
 */
export const ActionSpecSchema = z
  .object({
    /** 动作全局唯一 ID */
    id: IdSchema,
    /** 动作类型枚举，如 report.generate, checklist.generate 等 */
    actionType: ActionTypeSchema,
    /** 所属项目 ID（用于项目级数据与权限隔离） */
    projectId: IdSchema,
    /** 动作作用的目标资源 */
    target: ActionTargetSchema,
    /** 执行参数字典 */
    params: z.record(z.string(), z.unknown()),
    /** 允许调用的能力列表（最小特权原则） */
    allowedCapabilities: z.array(z.string().min(1).max(64)).max(16),
    /** 风险等级：L0(只读/无副作用) ~ L3(高危) */
    risk: RiskSchema,
    /** 副作用类型：read(纯读), local_create(本地受限创建), external_write(外部写入) */
    effect: EffectTypeSchema,
    /** 允许的最大执行步骤数 */
    maxSteps: z.number().int().min(1).max(64),
    /** 超时时间（毫秒） */
    timeoutMs: z.number().int().min(100).max(600_000),
    /** 最大允许花费 USD（P0 阶段严格为 0，禁止产生外部计费） */
    maxCostUsd: z.number().min(0).max(0), // P0: no paid model calls allowed
    /** 幂等键（64位十六进制哈希），防止重复执行 */
    idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
    /** 预期的数据源版本快照，用于检测数据是否在建议期间发生变更 */
    expectedSourceVersion: z.string().min(1).max(128).optional(),
    /** 执行完成后的独立验证规则 */
    verification: ActionVerificationSchema,
  })
  .strict();
export type ActionSpec = z.infer<typeof ActionSpecSchema>;
