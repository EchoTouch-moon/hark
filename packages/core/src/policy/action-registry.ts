import type { ActionType, EffectType, Risk } from '@hearth/contracts';

/**
 * Server-side static action registry (docs/04: risk floors and effect types
 * are derived here, never trusted from the client).
 */
export interface RegisteredAction {
  actionType: ActionType;
  riskFloor: Risk;
  effect: EffectType;
  requiredCapabilities: string[];
  description: string;
}

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

const RISK_ORDER: Record<Risk, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

export function maxRisk(a: Risk, b: Risk): Risk {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export function riskAtLeast(a: Risk, floor: Risk): boolean {
  return RISK_ORDER[a] >= RISK_ORDER[floor];
}

export function isRegisteredActionType(t: string): t is ActionType {
  return Object.prototype.hasOwnProperty.call(ACTION_REGISTRY, t);
}
