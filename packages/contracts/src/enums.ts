/**
 * @fileoverview 核心枚举与系统契约定义
 * 定义了风险级别、数据敏感度、证据溯源、事件源类型、动作类型、副作用分类及产物验证模式。
 */

import { z } from 'zod';

/** 契约版本常量 */
export const CONTRACT_VERSION = '1' as const;

/**
 * 风险等级枚举（L0 ~ L3）
 * - L0: 纯只读，无任何外部副作用，直接放行
 * - L1: 本地安全沙箱内创建产物（如 .hearth-demo-artifacts），由 Verifier 验证
 * - L2: 产生外部影响或非可逆本地变更，必须经由人工批准（ApprovalGrant）
 * - L3: 极高风险操作（禁止执行）
 */
export const RiskSchema = z.enum(['L0', 'L1', 'L2', 'L3']);
export type Risk = z.infer<typeof RiskSchema>;

/** 数据敏感度分级：public(公开), personal(个人), restricted(受限/机密) */
export const SensitivitySchema = z.enum(['public', 'personal', 'restricted']);
export type Sensitivity = z.infer<typeof SensitivitySchema>;

/** 证据/事件来源溯源分类：user_confirmed(用户明确确认), tool_observed(工具真实观察), model_inferred(模型推断) */
export const ProvenanceSchema = z.enum(['user_confirmed', 'tool_observed', 'model_inferred']);
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** 数据源类型：fixture(模拟数据源), vault(知识库), github(Git/代码仓), calendar(日历), mail(邮件) */
export const SourceTypeSchema = z.enum(['fixture', 'vault', 'github', 'calendar', 'mail']);
export type SourceType = z.infer<typeof SourceTypeSchema>;

/** 系统支持的标准动作类型 */
export const ActionTypeSchema = z.enum([
  'report.generate',       // 生成诊断报告
  'checklist.generate',    // 生成后续待办/实验清单
  'draft.generate',        // 生成草稿文本（不产生发送副作用）
  'repo.read_diagnose',    // 只读分析代码仓/事件
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

/**
 * 动作副作用分类
 * - read: 仅读取，无文件或外部状态改动
 * - local_create: 仅在受控的本地 demo-artifacts 目录创建产物
 * - external_write: 触发网络请求或外部系统写操作
 */
export const EffectTypeSchema = z.enum(['read', 'local_create', 'external_write']);
export type EffectType = z.infer<typeof EffectTypeSchema>;

/**
 * 产物验证模式
 * - artifact_sha256: 独立核验落盘文件的 SHA-256 哈希值
 * - json_schema: 校验落盘文件必须符合指定的 JSON 结构
 * - remote_readback: 远端回读确认
 */
export const VerificationKindSchema = z.enum(['artifact_sha256', 'json_schema', 'remote_readback']);
export type VerificationKind = z.infer<typeof VerificationKindSchema>;
