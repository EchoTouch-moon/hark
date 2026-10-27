import type { ActionSpec, Candidate, Event, Risk } from '@hearth/contracts';
import { deriveIdempotencyKey } from '@hearth/contracts';
import { ACTION_REGISTRY } from '../policy/action-registry.js';

export interface RuleTemplate {
  matches: (e: Event) => boolean;
  title: string;
  whyNow: (e: Event) => string;
  actionType: ActionSpec['actionType'];
  artifactPath: (e: Event) => string;
  params: (e: Event) => Record<string, unknown>;
  baseScore: number;
  ttlHours: number;
}

const RULES: RuleTemplate[] = [
  {
    matches: (e) => e.type === 'repo.ci_failed',
    title: '项目构建未通过',
    whyNow: (e) => `CI 失败会阻断下一步合入（${e.summary}）`,
    actionType: 'report.generate',
    artifactPath: (e) => `report/${e.source.sourceId}.json`,
    params: (e) => ({ runId: e.source.sourceId, uri: e.source.uri }),
    baseScore: 0.9,
    ttlHours: 24,
  },
  {
    matches: (e) => e.type === 'study.next_step_pending',
    title: '可以继续上次的研究',
    whyNow: (e) => `用户确认过的下一步还没有完成（${e.summary}）`,
    actionType: 'checklist.generate',
    artifactPath: (e) => `checklists/${e.projectId}-experiment.md`,
    params: (e) => ({ topic: e.tags[0] ?? 'experiment' }),
    baseScore: 0.7,
    ttlHours: 48,
  },
  {
    matches: (e) => e.type === 'calendar.conflict',
    title: '两场会议需要协调',
    whyNow: (e) => `两个时间段发生冲突，宜尽早给出调整草稿（${e.summary}）`,
    actionType: 'draft.generate',
    artifactPath: () => 'drafts/meeting-adjustment.md',
    params: (e) => ({ eventRef: e.source.sourceId }),
    baseScore: 0.8,
    ttlHours: 12,
  },
];

export function ruleFor(event: Event): RuleTemplate | null {
  return RULES.find((r) => r.matches(event)) ?? null;
}

export function isNoise(event: Event): boolean {
  return ruleFor(event) === null;
}

export function sourceVersionOf(event: Event): string {
  return event.source.contentHash ?? event.source.observedAt;
}

export function recencyFactor(event: Event, now: Date): number {
  const ageH = Math.max(0, (now.getTime() - new Date(event.observedAt).getTime()) / 3_600_000);
  return Math.max(0.5, 1 - ageH / 48);
}

export function buildCandidate(event: Event, nowIso: string): Candidate | null {
  const rule = ruleFor(event);
  if (!rule) return null;
  const reg = ACTION_REGISTRY[rule.actionType];
  const now = new Date(nowIso);
  const ttlMs = rule.ttlHours * 3_600_000;
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const sourceVersion = sourceVersionOf(event);
  const artifactPath = rule.artifactPath(event);
  const target = { resourceId: event.source.sourceId, path: artifactPath };
  const params = rule.params(event);
  const action: ActionSpec = {
    id: `act-${event.id}`,
    actionType: rule.actionType,
    projectId: event.projectId,
    target,
    params,
    allowedCapabilities: [...reg.requiredCapabilities],
    risk: reg.riskFloor,
    effect: reg.effect,
    maxSteps: 8,
    timeoutMs: 30_000,
    maxCostUsd: 0,
    idempotencyKey: deriveIdempotencyKey({ actionType: rule.actionType, projectId: event.projectId, target, params, sourceVersion }),
    expectedSourceVersion: sourceVersion,
    verification:
      rule.actionType === 'report.generate'
        ? { kind: 'json_schema', artifactPath }
        : { kind: 'artifact_sha256', artifactPath },
  };
  return {
    id: `cand-${event.id}`,
    projectId: event.projectId,
    eventIds: [event.id],
    title: rule.title,
    whyNow: rule.whyNow(event),
    evidence: [event.source],
    suggestedAction: action,
    score: rule.baseScore * recencyFactor(event, now),
    confidence: event.provenance === 'user_confirmed' ? 0.95 : 0.8,
    risk: reg.riskFloor as Risk,
    expiresAt,
    suppressionKey: event.dedupeKey,
    status: 'proposed',
  };
}
