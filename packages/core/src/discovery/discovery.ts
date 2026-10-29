/**
 * @fileoverview 主动建议发现引擎服务（Discovery Service，R-02）
 * 规则驱动扫描已持久化的源事件，按规则匹配构建 Candidate 并上屏为 ActionCard。
 * 遵循严格的去重抑制、静默时段控制（quiet hours）与每日卡片配额预算（daily budget）。
 */

import type { ActionCard, Candidate, Event } from '@hearth/contracts';
import { sha256Hex } from '@hearth/contracts';
import type { Storage } from '@hearth/storage';
import { buildCandidate, isNoise } from './rules.js';
import {
  dailyBudgetRemaining,
  isWithinQuietHours,
  localDayKey,
  type SuppressionSettings,
} from './suppression.js';

/** 主动发现扫描结果报告 */
export interface DiscoverResult {
  /** 扫描的总事件数量 */
  scannedEvents: number;
  /** 判定为噪声并跳过的数量 */
  noiseSkipped: number;
  /** 成功生成的建议候选数量 */
  candidatesCreated: number;
  /** 因重复而被抑制的数量 */
  duplicatesSuppressed: number;
  /** 最终创建上屏的卡片数量 */
  cardsCreated: number;
  /** 遵循用户此前忽略操作而跳过的数量 */
  dismissedRespected: number;
  /** 扫描时是否处于静默时段 */
  quietHoursActive: boolean;
  /** 当日卡片配额是否已耗尽 */
  budgetExhausted: boolean;
}

/**
 * 主动发现服务
 * Rule-first discovery over persisted events (R-02).
 */
export class DiscoveryService {
  constructor(
    private readonly deps: {
      storage: Storage;
      clock: () => string;
      suppression?: SuppressionSettings;
    },
  ) {}

  /**
   * @param opts.userInitiated true when the scan was explicitly requested by
   * the user (UI button). Quiet hours never block a user-initiated scan —
   * silence rules govern *proactive* disturbance, not explicit commands.
   * The daily budget applies to both paths.
   */
  async discover(opts: { userInitiated?: boolean } = {}): Promise<DiscoverResult> {
    const now = this.deps.clock();
    const nowDate = new Date(now);
    const suppression = this.deps.suppression;
    const quietActive = suppression ? isWithinQuietHours(nowDate, suppression.quietHours) && !opts.userInitiated : false;
    const events = this.deps.storage.listEvents({ limit: 100 });
    const result: DiscoverResult = {
      scannedEvents: events.length,
      noiseSkipped: 0,
      candidatesCreated: 0,
      duplicatesSuppressed: 0,
      cardsCreated: 0,
      dismissedRespected: 0,
      quietHoursActive: quietActive,
      budgetExhausted: false,
    };

    const tz = suppression?.quietHours.timezone ?? 'Asia/Shanghai';
    const todayKey = localDayKey(nowDate, tz);
    const createdToday = this.deps.storage
      .listCards({ limit: 200 })
      .filter((c) => localDayKey(new Date(c.createdAt), tz) === todayKey).length;
    let budgetLeft = suppression ? dailyBudgetRemaining(createdToday, suppression.maxCardsPerDay) : Number.POSITIVE_INFINITY;

    for (const event of events) {
      if (isNoise(event)) {
        result.noiseSkipped += 1;
        continue;
      }
      const candidate = buildCandidate(event, now);
      if (!candidate) continue;

      const existingCards = this.existingCardsForSuppression(candidate.suppressionKey);
      const dismissed = existingCards.some((c) => c.status === 'dismissed');
      if (dismissed) {
        result.dismissedRespected += 1;
        this.deps.storage.upsertCandidate({ ...candidate, status: 'suppressed' });
        continue;
      }
      const active = existingCards.filter((c) => !['dismissed', 'expired', 'completed', 'failed', 'cancelled'].includes(c.status));
      if (active.length > 0) {
        result.duplicatesSuppressed += 1;
        continue;
      }
      if (existingCards.length > 0) {
        // terminal cards exist for this suppression key (completed/failed/expired):
        // already actioned — never re-nag the same deduped event
        result.duplicatesSuppressed += 1;
        continue;
      }

      this.deps.storage.upsertCandidate(candidate); // dedupes storage; deferred candidates pass through here later
      if (quietActive || budgetLeft <= 0) {
        // Keep the candidate record (audit) but defer surfacing a card.
        result.budgetExhausted = result.budgetExhausted || budgetLeft <= 0;
        continue;
      }
      result.candidatesCreated += 1;
      this.createCard(candidate, now);
      result.cardsCreated += 1;
      budgetLeft -= 1;
    }

    this.deps.storage.audit('discover.run', 'system', 'discovery', { ...result });
    return result;
  }

  private existingCardsForSuppression(suppressionKey: string): ActionCard[] {
    // suppressionKey === event dedupeKey === candidate key; find via candidates then cards
    const cards = this.deps.storage.listCards({ limit: 200 });
    return cards.filter((c) => c.action.target.resourceId !== undefined).filter((c) => {
      const cand = this.deps.storage.getCandidate(c.candidateId);
      return cand !== null && cand.suppressionKey === suppressionKey;
    });
  }

  private createCard(candidate: Candidate, nowIso: string): ActionCard {
    const id = `card-${sha256Hex(candidate.suppressionKey).slice(0, 12)}`;
    const card: ActionCard = {
      id,
      candidateId: candidate.id,
      projectId: candidate.projectId,
      title: candidate.title,
      whyNow: candidate.whyNow,
      evidence: candidate.evidence,
      action: candidate.suggestedAction,
      createdAt: nowIso,
      expiresAt: candidate.expiresAt,
      status: 'proposed',
    };
    this.deps.storage.insertCard(card);
    this.deps.storage.audit('card.created', 'discovery', id, {
      projectId: candidate.projectId,
      suppressionKey: candidate.suppressionKey,
    });
    return card;
  }
}

export type { Event };
