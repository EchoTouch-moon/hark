/**
 * @fileoverview 核心安全策略评估引擎（Policy Gate）
 * 系统中任何动作在被执行器调度前必须通过的唯一安全关卡。
 * 
 * 强制执行的安全原则：
 * 1. 服务端权威判定：风险等级、副作用类型与所需能力来自 ACTION_REGISTRY，不信任前端传参
 * 2. L3 绝对禁止：任何 L3 级别操作无条件拒绝
 * 3. 项目级 ACL（S04）：禁止跨授权项目操作
 * 4. 零成本原则：P0 阶段禁止付费模型或外部 API 计费操作（maxCostUsd > 0 即拒绝）
 * 5. 数据源版本新鲜度校验（S10）：若底层数据在动作生成后被修改，阻断执行并要求重新扫描
 * 6. 人工授权强校验（S05/S06/S07）：L2 或 external_write 操作必须具备有效、未过期、未被篡改且未消耗的 ApprovalGrant
 * 7. 沙箱路径深度遏制（S03）：local_create 操作产物路径必须严格限制在 demoArtifactRoot 内部，防目录遍历与软链接逃逸
 */

import type { ActionSpec, ApprovalGrant, Risk } from '@hearth/contracts';
import { actionDigest, targetDigest } from '@hearth/contracts';
import { ACTION_REGISTRY, isRegisteredActionType, maxRisk, riskAtLeast } from './action-registry.js';
import { resolveArtifactPath, validateRealpathContainment } from './artifact-path.js';

/** 策略拒绝错误码定义 */
export type DenyCode =
  | 'UNKNOWN_ACTION'          // 未知动作类型
  | 'L3_FORBIDDEN'            // L3 高危操作绝对禁止
  | 'PROJECT_ACL'             // 项目超出访问控制范围（S04）
  | 'STALE_SOURCE'            // 基础数据源已发生变更，卡片陈旧（S10）
  | 'ARTIFACT_PATH'           // 产物路径非法或逃逸沙箱（S03）
  | 'GRANT_DIGEST_MISMATCH'   // 授权凭证摘要不匹配（动作或目标被篡改，S06）
  | 'GRANT_EXPIRED'           // 授权凭证已过期（S07）
  | 'GRANT_CONSUMED'          // 授权凭据已被使用，不可重复利用
  | 'GRANT_RISK'              // 授权风险等级不匹配
  | 'GRANT_CAPABILITY'        // 授权缺少所需能力权限
  | 'COST_FORBIDDEN';         // 产生了非零费用（P0 不允许）

/** 策略评估裁决结果 */
export type PolicyDecision =
  | { decision: 'permit'; effectiveRisk: Risk; effectiveEffect: string; reason: string }
  | { decision: 'await_approval'; effectiveRisk: Risk; reason: string }
  | { decision: 'deny'; effectiveRisk: Risk; code: DenyCode; reason: string };

/** 策略评估上下文 */
export interface PolicyContext {
  /** 当前标准时间戳（ISO-8601） */
  now: string;
  /** 当前用户/主体被允许访问的项目 ID 列表（服务端 ACL） */
  allowedProjectIds: readonly string[];
  /** 从数据库读取的与该卡片相关的已持久化授权记录列表 */
  grants: readonly ApprovalGrant[];
  /** 执行前重新从数据源读取的真实版本哈希（用于版本对比） */
  actualSourceVersion?: string;
  /** 专用 demo-artifacts 根目录绝对路径 */
  demoArtifactRoot: string;
  /** 可选的文件系统探测抽象（便于单测 Mock） */
  fs?: {
    realpath(p: string): Promise<string>;
    stat(p: string): Promise<{ isDirectory(): boolean } | null>;
  };
}

/**
 * 校验单张授权凭据（ApprovalGrant）是否适用于待执行的 ActionSpec
 * 包含：动作语义摘要一致性、目标摘要一致性、有效时间窗口、是否已被消耗、授权能力是否覆盖动作所需能力。
 */
export function validateGrant(
  grant: ApprovalGrant,
  spec: ActionSpec,
  ctx: Pick<PolicyContext, 'now'>,
): { ok: true } | { ok: false; code: DenyCode; reason: string } {
  // S06: 校验动作语义摘要
  if (grant.actionDigest !== actionDigest(spec)) {
    return { ok: false, code: 'GRANT_DIGEST_MISMATCH', reason: 'action digest mismatch (S06)' };
  }
  // S06: 校验目标摘要
  if (grant.targetDigest !== targetDigest(spec)) {
    return { ok: false, code: 'GRANT_DIGEST_MISMATCH', reason: 'target digest mismatch (S06)' };
  }
  // S07: 校验授权有效期
  if (grant.expiresAt <= ctx.now) {
    return { ok: false, code: 'GRANT_EXPIRED', reason: 'grant expired (S07)' };
  }
  // 单次使用：防止重放
  if (grant.consumedAt) {
    return { ok: false, code: 'GRANT_CONSUMED', reason: 'grant already consumed' };
  }
  // 授权风险等级底线
  if (!riskAtLeast(grant.risk, 'L2')) {
    return { ok: false, code: 'GRANT_RISK', reason: 'grant risk below L2' };
  }
  // 检查是否具备全部所需能力
  const missing = spec.allowedCapabilities.filter((c) => !grant.authorizedCapabilities.includes(c));
  if (missing.length > 0) {
    return { ok: false, code: 'GRANT_CAPABILITY', reason: `grant lacks capabilities: ${missing.join(',')}` };
  }
  return { ok: true };
}

/**
 * 在上下文授权列表中检索与当前动作匹配且有效的授权凭证
 */
function findUsableGrant(spec: ActionSpec, ctx: PolicyContext) {
  const digest = actionDigest(spec);
  let boundInvalidReason: string | null = null;
  for (const grant of ctx.grants) {
    const v = validateGrant(grant, spec, ctx);
    if (v.ok) return { grant, invalidReasons: null as string | null };
    // 记录绑定到该动作但失效的原因，供可解释性诊断输出
    if (grant.actionDigest === digest && boundInvalidReason === null) {
      boundInvalidReason = v.reason;
    }
  }
  return { grant: null, invalidReasons: boundInvalidReason };
}

/**
 * 策略门禁综合评估函数
 * 服务端在执行任何动作前必须调用此函数进行权限、安全与合规裁决。
 * 
 * @param spec 待执行动作规范
 * @param ctx 策略上下文信息（含项目白名单、授权记录、数据源版本等）
 * @returns 裁决结果：permit(放行), await_approval(待用户批准), deny(直接阻断)
 */
export async function evaluatePolicy(spec: ActionSpec, ctx: PolicyContext): Promise<PolicyDecision> {
  // 1. 验证动作类型是否已在服务端静态注册
  if (!isRegisteredActionType(spec.actionType)) {
    return {
      decision: 'deny',
      effectiveRisk: spec.risk,
      code: 'UNKNOWN_ACTION',
      reason: `actionType ${spec.actionType} not in registry`,
    };
  }
  const reg = ACTION_REGISTRY[spec.actionType];
  // 风险底线对齐：取声明值与服务端基线的最大值
  const effectiveRisk = maxRisk(spec.risk, reg.riskFloor);
  const effectiveEffect = reg.effect; // 服务端注册表权威决定副作用类型

  // 2. L3 操作绝对禁止
  if (effectiveRisk === 'L3') {
    return { decision: 'deny', effectiveRisk, code: 'L3_FORBIDDEN', reason: 'L3 forbidden unconditionally' };
  }
  // 3. 项目访问控制 ACL 隔离（S04）
  if (!ctx.allowedProjectIds.includes(spec.projectId)) {
    return {
      decision: 'deny',
      effectiveRisk,
      code: 'PROJECT_ACL',
      reason: `project ${spec.projectId} outside allowed scope (S04)`,
    };
  }
  // 4. 计费拦截：P0 阶段禁止非零成本
  if (spec.maxCostUsd > 0) {
    return { decision: 'deny', effectiveRisk, code: 'COST_FORBIDDEN', reason: 'nonzero cost not allowed in P0' };
  }
  // 5. 数据源新鲜度校验（S10）：检测源数据是否在卡片生成后被修改
  if (spec.expectedSourceVersion !== undefined) {
    if (ctx.actualSourceVersion === undefined) {
      return {
        decision: 'deny',
        effectiveRisk,
        code: 'STALE_SOURCE',
        reason: 'source version unavailable; rescan required (S10)',
      };
    }
    if (ctx.actualSourceVersion !== spec.expectedSourceVersion) {
      return {
        decision: 'deny',
        effectiveRisk,
        code: 'STALE_SOURCE',
        reason: `source moved from ${spec.expectedSourceVersion} to ${ctx.actualSourceVersion}; rescan required (S10)`,
      };
    }
  }

  // 6. 人工批准校验（S05）：针对 L2 风险或外部写入
  const needsApproval = effectiveRisk === 'L2' || effectiveEffect === 'external_write';
  if (needsApproval) {
    const { grant, invalidReasons } = findUsableGrant(spec, ctx);
    if (!grant) {
      return {
        decision: 'await_approval',
        effectiveRisk,
        reason: 'L2/external_write requires human approval (S05)',
      };
    }
    if (invalidReasons) {
      // 存在曾绑定的授权但已失效，需重新请求批准
      return { decision: 'await_approval', effectiveRisk, reason: invalidReasons };
    }
  }

  // 7. 本地创建产物路径沙箱遏制检查（S03）
  if (effectiveEffect === 'local_create') {
    const rel = spec.verification.artifactPath;
    if (!rel) {
      return { decision: 'deny', effectiveRisk, code: 'ARTIFACT_PATH', reason: 'local_create needs verification.artifactPath' };
    }
    const resolved = resolveArtifactPath(ctx.demoArtifactRoot, rel);
    if (!resolved.ok) {
      return { decision: 'deny', effectiveRisk, code: 'ARTIFACT_PATH', reason: resolved.reason };
    }
    if (ctx.fs) {
      const real = await validateRealpathContainment(resolved.absPath, ctx.demoArtifactRoot, ctx.fs.realpath, ctx.fs.stat);
      if (!real.ok) {
        return { decision: 'deny', effectiveRisk, code: 'ARTIFACT_PATH', reason: real.reason };
      }
    }
  }

  // 全部检查通过，予以放行
  return {
    decision: 'permit',
    effectiveRisk,
    effectiveEffect,
    reason: needsApproval
      ? 'approved grant validated (digest+expiry+capabilities)'
      : `within ${effectiveRisk} bounds for ${spec.actionType}`,
  };
}
