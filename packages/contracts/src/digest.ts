/**
 * @fileoverview 确定性哈希与摘要派生工具
 * 包含幂等键派生（deriveIdempotencyKey）、动作语义摘要（actionDigest）、目标摘要（targetDigest）等。
 * 确保授权与执行绑定在语义内容上，不受非语义字段（如时间戳、自增 ID）影响。
 */

import type { ActionSpec, ActionTarget } from './action.js';
import { canonicalDigest, sha256Hex } from './canonical.js';

/**
 * 派生动作执行的幂等键（Idempotency Key）
 * 严格绑定以下 5 要素：
 * (actionType, projectId, canonical target, normalized params, sourceVersion)
 * 只要这 5 要素未变，重复触发执行将被拦截并返回已有任务记录
 */
export function deriveIdempotencyKey(input: {
  actionType: string;
  projectId: string;
  target: ActionTarget;
  params: Record<string, unknown>;
  sourceVersion?: string;
}): string {
  return canonicalDigest({
    actionType: input.actionType,
    projectId: input.projectId,
    target: input.target,
    params: input.params,
    sourceVersion: input.sourceVersion ?? null,
  });
}

/**
 * 计算动作语义内容的 SHA-256 摘要（ApprovalGrant 绑定的核心）
 * 刻意排除了易变字段（如 ID、创建时间戳），但涵盖了全部产生实质影响的字段：
 * 动作类型、所属项目、目标资源、执行参数、风险评级、副作用类型及验证规则。
 * 若用户批准后有任何字段被篡改，摘要核对将立即失败（S06 安全守卫）。
 */
export function actionDigest(spec: ActionSpec): string {
  return canonicalDigest({
    actionType: spec.actionType,
    projectId: spec.projectId,
    target: spec.target,
    params: spec.params,
    risk: spec.risk,
    effect: spec.effect,
    expectedSourceVersion: spec.expectedSourceVersion ?? null,
    verification: spec.verification,
  });
}

/**
 * 仅计算目标资源的确定性摘要
 * 安全规则 S06：如果目标发生变更，原先授予的批准立刻失效
 */
export function targetDigest(spec: ActionSpec): string {
  return canonicalDigest({
    actionType: spec.actionType,
    projectId: spec.projectId,
    target: spec.target,
  });
}

/**
 * 基于内容生成短而稳定的哈希 ID
 * 格式为 `${prefix}-${12位小写十六进制}`
 * @param prefix ID 前缀（如 run-, trace-）
 * @param parts 参与哈希计算的各个部分字符串
 */
export function digestId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${sha256Hex(parts.join('\u0000')).slice(0, 12)}`;
}
