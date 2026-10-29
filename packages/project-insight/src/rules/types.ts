import type { EvidenceRef, HeadBinding, InsightStatus, Signal } from '../contracts.js';

export const RULESET_VERSION = 's2-rules/1';

export const ISSUE_FAMILY = {
  TEST: 'test-report-failure',
  GAP: 'observation-gap',
  HEALTH: 'observer-health',
  REPO: 'repository-access',
} as const;
export type IssueFamily = (typeof ISSUE_FAMILY)[keyof typeof ISSUE_FAMILY];

export interface InsightPolicy {
  enabledRuleIds: ReadonlySet<string>;
  adapterErrorCount: number;
  adapterErrorDurationMs: number;
  unavailableCount: number;
  unavailableDurationMs: number;
}

export interface StreakState {
  subject: string;
  count: number;
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface ActiveIssue {
  issueKey: string;
  episodeKey: string;
  status: InsightStatus;
  subjectKey: string;
  primaryRuleId: string;
}

export interface RuleStateSnapshot {
  streamEpoch: number;
  sourceFrozen: boolean;
  legacyOrderReconstructed: boolean;
  adapterStreak: StreakState | null;
  unavailableStreak: StreakState | null;
  activeByFamily: Readonly<Record<string, ActiveIssue>>;
}

export interface RuleClock {
  now: string;
}

export interface RuleInput {
  signal: Readonly<Signal>;
  state: Readonly<RuleStateSnapshot>;
  policy: Readonly<InsightPolicy>;
  clock: Readonly<RuleClock>;
}

export interface RuleCandidate {
  projectId: string;
  streamEpoch: number;
  ruleId: string;
  ruleVersion: number;
  issueFamily: IssueFamily;
  subjectKey: string;
  openingSignalId: string;
  severity: 'info' | 'attention' | 'important';
  confidence: 'low' | 'medium' | 'high';
  headBinding: HeadBinding;
  reasonCodes: string[];
  evidenceRefs: EvidenceRef[];
  titleKey: string;
  detailKey: string;
  templateData: Record<string, string | number | boolean | null>;
  historical: boolean;
}

export interface RecoveryEvidence {
  issueFamily: IssueFamily;
  subjectKey: string;
  signalId: string;
  observedAt: string;
  evidenceRefs: EvidenceRef[];
  reasonCodes: string[];
}

export type RuleDecision =
  | { kind: 'NO_INSIGHT'; reasonCode: string }
  | { kind: 'CANDIDATE'; candidate: RuleCandidate }
  | { kind: 'RECOVERY'; recovery: RecoveryEvidence };

export interface InsightRule {
  id: string;
  version: number;
  issueFamily: IssueFamily;
  evaluate(input: RuleInput): readonly RuleDecision[];
}
