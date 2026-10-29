import type { InsightStatus } from '../contracts.js';
import type { RecoveryEvidence, RuleCandidate } from '../rules/types.js';
import { episodeKeyFor, insightIdFor, issueKeyFor } from './identity.js';

export interface StoredEpisode {
  insightId: string;
  issueKey: string;
  episodeKey: string;
  status: InsightStatus;
  subjectKey: string;
  issueFamily: string;
  openingSignalId: string;
  primaryRuleId: string;
  severity: RuleCandidate['severity'];
  confidence: RuleCandidate['confidence'];
  titleKey: string;
  detailKey: string;
  templateData: Record<string, string | number | boolean | null>;
  firstObservedAt: string;
  lastMaterialObservedAt: string;
  historical: boolean;
}

export interface IssueRecord {
  issueKey: string;
  activeEpisodeKey: string | null;
  lastVerifiedRecoverySignalId: string | null;
  dismissedEpisodeKeys: string[];
}

export type EpisodeMutation =
  | { kind: 'open'; episode: StoredEpisode }
  | { kind: 'resolve'; episodeKey: string; recovery: RecoveryEvidence }
  | { kind: 'ignore'; reasonCode: string; episodeKey?: string };

function fromCandidate(candidate: RuleCandidate, now: string): StoredEpisode {
  const issueKey = issueKeyFor(candidate);
  const episodeKey = episodeKeyFor(issueKey, candidate.openingSignalId);
  return {
    insightId: insightIdFor(episodeKey),
    issueKey,
    episodeKey,
    status: 'OPEN',
    subjectKey: candidate.subjectKey,
    issueFamily: candidate.issueFamily,
    openingSignalId: candidate.openingSignalId,
    primaryRuleId: candidate.ruleId,
    severity: candidate.severity,
    confidence: candidate.confidence,
    titleKey: candidate.titleKey,
    detailKey: candidate.detailKey,
    templateData: candidate.templateData,
    firstObservedAt: now,
    lastMaterialObservedAt: now,
    historical: candidate.historical,
  };
}

export function reduceCandidate(
  candidate: RuleCandidate,
  issue: IssueRecord | null,
  episodes: ReadonlyMap<string, StoredEpisode>,
  now: string,
): EpisodeMutation {
  const issueKey = issueKeyFor(candidate);
  if (issue === null || issue.activeEpisodeKey === null) {
    const dismissed = issue?.dismissedEpisodeKeys ?? [];
    const wouldBe = episodeKeyFor(issueKey, candidate.openingSignalId);
    if (dismissed.includes(wouldBe)) return { kind: 'ignore', reasonCode: 'DISMISSED', episodeKey: wouldBe };
    if (dismissed.length > 0 && issue?.lastVerifiedRecoverySignalId === null) {
      const lastDismissed = dismissed[dismissed.length - 1];
      if (lastDismissed !== undefined) {
        const prior = episodes.get(lastDismissed);
        if (prior !== undefined && prior.status === 'DISMISSED' && prior.subjectKey === candidate.subjectKey) {
          return { kind: 'ignore', reasonCode: 'DISMISSED', episodeKey: lastDismissed };
        }
      }
    }
    return { kind: 'open', episode: fromCandidate(candidate, now) };
  }
  const active = episodes.get(issue.activeEpisodeKey);
  if (active === undefined) return { kind: 'open', episode: fromCandidate(candidate, now) };
  if (active.status === 'DISMISSED') {
    return { kind: 'ignore', reasonCode: 'DISMISSED', episodeKey: active.episodeKey };
  }
  if (active.status === 'RESOLVED' || active.status === 'WITHDRAWN') {
    return { kind: 'open', episode: fromCandidate(candidate, now) };
  }
  return { kind: 'ignore', reasonCode: 'ONGOING', episodeKey: active.episodeKey };
}

export function reduceRecovery(
  recovery: RecoveryEvidence,
  issue: IssueRecord | null,
  episodes: ReadonlyMap<string, StoredEpisode>,
): EpisodeMutation {
  if (issue === null || issue === undefined || issue.activeEpisodeKey === null) {
    return { kind: 'ignore', reasonCode: 'NO_ACTIVE_ISSUE' };
  }
  const active = episodes.get(issue.activeEpisodeKey);
  if (active === undefined) return { kind: 'ignore', reasonCode: 'NO_ACTIVE_ISSUE' };
  if (active.status === 'DISMISSED' || active.status === 'RESOLVED' || active.status === 'WITHDRAWN') {
    return { kind: 'ignore', reasonCode: active.status };
  }
  if (active.subjectKey !== recovery.subjectKey) return { kind: 'ignore', reasonCode: 'SUBJECT_MISMATCH' };
  return { kind: 'resolve', episodeKey: active.episodeKey, recovery };
}

export function applyUserStatus(episode: StoredEpisode, status: 'ACKNOWLEDGED' | 'DISMISSED'): StoredEpisode {
  if (episode.status === 'RESOLVED' || episode.status === 'WITHDRAWN') return episode;
  if (status === 'ACKNOWLEDGED' && episode.status === 'DISMISSED') return episode;
  return { ...episode, status };
}
