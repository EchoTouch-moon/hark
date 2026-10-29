import { confirmedInteractionTimes, latestConfirmedInteraction } from './emberHeat';

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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derives the living flame state from the project and active thread lifecycle.
 * The flame is not a static score or gamified badge: it embodies the pulse,
 * nourishment and living continuity of the project.
 */
export function deriveProjectFlame(input: ProjectFlameInput): ProjectFlameInfo {
  const now = input.nowMs ?? Date.now();
  const messages = input.confirmedUserMessages ?? [];
  const validTimes = confirmedInteractionTimes(messages, now);
  const confirmedCount = validTimes.length;
  const latestMessageTime = latestConfirmedInteraction(messages, now);
  const latestMessageMs = latestMessageTime ? Date.parse(latestMessageTime) : null;
  const projectObservedMs = input.project?.lastObservedAt ? Date.parse(input.project.lastObservedAt) : null;

  // 1. Dormant (搁置 / 静卧余烬)
  // If the project is explicitly disabled/shelved, or both project observation
  // and thread messages are older than 7 days.
  const isExplicitlyDisabled = input.project?.enabled === false;
  const lastActiveMs = Math.max(latestMessageMs ?? 0, projectObservedMs ?? 0);
  const isStale = lastActiveMs > 0 && now - lastActiveMs > 7 * DAY_MS;

  if (isExplicitlyDisabled || (lastActiveMs > 0 && isStale && confirmedCount === 0)) {
    return {
      stage: 'dormant',
      heat: 0.10,
      golden: 0.0,
      dormant: 1.0,
      stageLabel: '静卧余烬',
      stagePoetry: '项目暂时搁置，暗火微温沉睡在炭底。添一把柴，便能随时复燃。',
      stageBadgeTone: 'neutral',
      fuelHint: '点击“添柴观测”唤醒余烬',
    };
  }

  // 2. Golden (常明金火 · 项目圆满完成)
  // When action cards exist and are all completed, or when tests pass with no open issues.
  const cards = input.cardsSummary;
  const hasCards = Boolean(cards && cards.total > 0);
  const allCardsCompleted = Boolean(hasCards && cards!.completed === cards!.total && cards!.failed === 0);

  if (allCardsCompleted) {
    return {
      stage: 'golden',
      heat: 0.72,
      golden: 1.0,
      dormant: 0.0,
      stageLabel: '常明金火',
      stagePoetry: '阶段成果圆满达成。炉火澄澈金黄，沉静守护每一份成果。',
      stageBadgeTone: 'success',
      fuelHint: '可开启下一阶段目标，或继续保持常明',
    };
  }

  // 3. Blaze (繁盛之火 · 正在做起来/活跃推进)
  // When there are 3+ confirmed messages, or recent activity within 24h with active cards/insights.
  const isRecent24h = latestMessageMs !== null && now - latestMessageMs <= DAY_MS;
  const hasActiveWork = Boolean((cards && cards.active > 0) || (input.project?.openInsightCount ?? 0) > 0);

  if (confirmedCount >= 3 || (confirmedCount >= 2 && isRecent24h && hasActiveWork)) {
    const steps = Math.max(1, Math.min(4, confirmedCount)) - 1;
    const intensity = 0.42 + steps * 0.11;
    return {
      stage: 'blaze',
      heat: intensity,
      golden: 0.0,
      dormant: 0.0,
      stageLabel: '繁盛之火',
      stagePoetry: '思路与代码正如火如荼地推进，炉火热烈翻腾、生机盎然。',
      stageBadgeTone: 'info',
      fuelHint: '持续交流与代码扫描，保持火势旺盛',
    };
  }

  // 4. Sprout (初生火苗 · 慢慢做起来)
  // When initial dialogue has started or project has initial observed activity.
  const hasInitialObservation = Boolean(projectObservedMs && now - projectObservedMs <= 7 * DAY_MS);
  if (confirmedCount >= 1 || (input.project && !input.project.unborn && hasInitialObservation)) {
    const steps = Math.max(1, Math.min(4, confirmedCount)) - 1;
    const intensity = 0.42 + steps * 0.11;
    return {
      stage: 'sprout',
      heat: intensity,
      golden: 0.0,
      dormant: 0.0,
      stageLabel: '初生火苗',
      stagePoetry: '想法已经抽芽，火苗轻轻摇曳。随着交流展开，它将逐渐壮大。',
      stageBadgeTone: 'warning',
      fuelHint: '聊聊接下来的构想，给它更多养分',
    };
  }

  // 5. Spark (初火星 · 刚创立)
  // Default fresh project or brand new empty conversation.
  return {
    stage: 'spark',
    heat: 0.12,
    golden: 0.0,
    dormant: 0.0,
    stageLabel: '初火星',
    stagePoetry: '项目刚创立，正如夜空初绽的一粒火星。从第一句话开始点燃。',
    stageBadgeTone: 'neutral',
    fuelHint: '输入你的第一个想法，点亮炉火',
  };
}
