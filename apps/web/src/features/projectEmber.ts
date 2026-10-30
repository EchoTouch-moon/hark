export type ProjectFlameStage = 'spark' | 'sprout' | 'blaze' | 'golden' | 'dormant';

export interface ProjectFlameInfo {
  stage: ProjectFlameStage;
  heat: number;
  golden: number;
  dormant: number;
  stageLabel: string;
  stagePoetry: string;
  stageBadgeTone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  fuelHint: string;
}

export interface ProjectFlameInput {
  project?: {
    enabled?: boolean;
    createdAt?: string;
    lastObservedAt?: string | null;
    testStatus?: string;
    openInsightCount?: number;
    unborn?: boolean;
  } | null;
  confirmedUserMessages?: readonly { role: string; createdAt: string; id: string }[];
  cardsSummary?: {
    total: number;
    completed: number;
    active: number;
    failed: number;
  } | null;
  nowMs?: number;
}

/** No verified project-life projection is available yet. Keep the room neutral.
 * Legacy messages/cards/switches are accepted for compatibility, never as progress evidence.
 * The five shapes remain renderer assets for a future evidence-backed projection.
 */
export function deriveProjectFlame(_input: ProjectFlameInput): ProjectFlameInfo {
  return {
    stage: 'spark',
    heat: 0.3,
    golden: 0,
    dormant: 0,
    stageLabel: '炉边静候',
    stagePoetry: '火影是空间氛围，不表示项目进度。',
    stageBadgeTone: 'neutral',
    fuelHint: '从有来源的项目事实开始讨论。',
  };
}
