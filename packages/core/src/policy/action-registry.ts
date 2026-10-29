/**
 * @fileoverview 服务端静态动作注册表（Action Registry）
 * 严格按照安全原则：风险底线（riskFloor）、副作用类型（effect）及所需能力（requiredCapabilities）
 * 必须在服务端静态注册表中权威定义，绝不信任前端传递的声明。
 */

import type { ActionType, EffectType, Risk } from '@hearth/contracts';

/** 已注册动作的静态配置契约 */
export interface RegisteredAction {
  /** 动作类型 */
  actionType: ActionType;
  /** 风险底线（实际风险取声明值与底线的最大值） */
  riskFloor: Risk;
  /** 副作用类型（服务端权威判定） */
  effect: EffectType;
  /** 执行该动作必须具备的权限能力列表 */
  requiredCapabilities: string[];
  /** 人类可读的操作描述 */
  description: string;
}

/**
 * 动作静态注册表
 * 集中管理系统所有被允许动作的安全元数据
 */
export const ACTION_REGISTRY: Readonly<Record<ActionType, RegisteredAction>> = {
  'report.generate': {
    actionType: 'report.generate',
    riskFloor: 'L1',
    effect: 'local_create',
    requiredCapabilities: ['fs.write_demo_artifact'],
    description: '在专用 demo-artifacts 目录生成诊断报告',
  },
  'checklist.generate': {
    actionType: 'checklist.generate',
    riskFloor: 'L1',
    effect: 'local_create',
    requiredCapabilities: ['fs.write_demo_artifact'],
    description: '生成实验/学习清单文件',
  },
  'draft.generate': {
    actionType: 'draft.generate',
    riskFloor: 'L1',
    effect: 'local_create',
    requiredCapabilities: ['fs.write_demo_artifact'],
    description: '生成草稿文件；绝不对外发送',
  },
  'repo.read_diagnose': {
    actionType: 'repo.read_diagnose',
    riskFloor: 'L0',
    effect: 'read',
    requiredCapabilities: ['fs.read_fixture'],
    description: '只读诊断 fixture 源',
  },
};

/** 风险等级数值映射（用于大小比较） */
const RISK_ORDER: Record<Risk, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

/**
 * 计算两个风险等级中的较高者
 * 用于将客户端传入风险与服务端注册表底线合并，确保风险等级只升不降
 */
export function maxRisk(a: Risk, b: Risk): Risk {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

/**
 * 检查风险等级 a 是否不低于基线 floor
 */
export function riskAtLeast(a: Risk, floor: Risk): boolean {
  return RISK_ORDER[a] >= RISK_ORDER[floor];
}

/**
 * 类型守卫：检查传入的字符串是否属于已注册的 ActionType
 */
export function isRegisteredActionType(t: string): t is ActionType {
  return Object.prototype.hasOwnProperty.call(ACTION_REGISTRY, t);
}
