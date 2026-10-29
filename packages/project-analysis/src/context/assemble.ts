import { createHash } from 'node:crypto';
import type { InsightStore } from '@hearth/project-insight';
import { listInsights } from '@hearth/project-insight';
import type { ProjectObserver } from '@hearth/project-observer';
import { AnalysisError } from '../errors.js';
import type { AnalysisEvidenceRef, ProjectContext } from '../contracts.js';
import { collectProjectFiles } from './files.js';
import { redactSecrets } from './redact.js';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function testDisclaimer(result: string, quality: string): string {
  if (result === 'UNKNOWN' || quality === 'UNKNOWN') {
    return '测试证据为 UNKNOWN，不能当作测试通过，也不能据此判断任务完成。';
  }
  if (quality === 'STALE') {
    return '测试证据已过期，不能代表当前工作区。';
  }
  if (result === 'PASS') {
    return '测试通过仅覆盖已声明报告，不代表项目进度或 HEAD 绑定。';
  }
  return '测试结论来自已声明报告，提交绑定未确定。';
}

function eventSummary(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const bits = ['branch', 'head', 'relativePath', 'errorCode']
    .map((key) => (typeof record[key] === 'string' ? String(record[key]) : null))
    .filter((item): item is string => item !== null);
  return redactSecrets(bits.join(' · ')).slice(0, 400);
}

export function assembleProjectContext(
  observer: ProjectObserver,
  insight: InsightStore | undefined,
  projectId: string,
  nowIso: string,
): ProjectContext {
  const project = observer.getProject(projectId);
  const snapshot = observer.getLatestSnapshot(projectId);
  const health = observer.getObserverHealth(projectId);
  const events = observer.listEvents(projectId, { limit: 12 }).events;
  const forward = observer.listEventsForward(projectId, { limit: 1 });
  const insights = insight
    ? listInsights(insight, {
        projectId,
        statuses: ['OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'RESOLVED', 'WITHDRAWN'],
        limit: 8,
      }).items
    : [];
  const test = snapshot?.test;
  const testResult = test?.result ?? 'UNKNOWN';
  const testQuality = test?.evidenceQuality ?? 'UNKNOWN';
  const files = collectProjectFiles(project.canonicalPath);
  const streamEpoch = forward.streamEpoch || insights[0]?.streamEpoch || 1;
  const availableEvidence: AnalysisEvidenceRef[] = [];
  if (snapshot) {
    availableEvidence.push({
      kind: 'snapshot',
      id: snapshot.id,
      label: `snapshot ${snapshot.headSha?.slice(0, 12) ?? snapshot.id}`,
      verified: true,
    });
  }
  availableEvidence.push({
    kind: 'health',
    id: projectId,
    label: `collection ${health.collectionStatus}`,
    verified: true,
  });
  for (const event of events) {
    availableEvidence.push({
      kind: 'observer_event',
      id: event.eventId,
      label: event.type,
      verified: true,
    });
  }
  for (const item of insights) {
    availableEvidence.push({ kind: 'insight', id: item.id, label: item.title.slice(0, 80), verified: true });
  }
  for (const file of files) {
    availableEvidence.push({
      kind: 'file',
      id: file.relativePath,
      label: file.relativePath,
      verified: true,
    });
  }

  const body = {
    projectId: project.id,
    projectName: project.name,
    gitIdentity: project.gitIdentity,
    snapshotId: snapshot?.id ?? null,
    headSha: snapshot?.headSha ?? null,
    branch: snapshot?.branch ?? null,
    detached: snapshot?.detached ?? false,
    unborn: snapshot?.unborn ?? false,
    streamEpoch,
    collectionStatus: health.collectionStatus,
    testResult,
    testEvidenceQuality: testQuality,
    testDisclaimer: testDisclaimer(testResult, testQuality),
    worktree: {
      clean: snapshot?.worktree.clean ?? true,
      conflicted: snapshot?.worktree.conflicted ?? false,
      staged: snapshot?.worktree.staged ?? 0,
      unstaged: snapshot?.worktree.unstaged ?? 0,
      untracked: snapshot?.worktree.untracked ?? 0,
    },
    events: events.map((event) => ({
      eventId: event.eventId,
      type: event.type,
      observedAt: event.observedAt,
      summary: eventSummary(event.payload),
    })),
    insights: insights.map((item) => ({
      id: item.id,
      status: item.status,
      title: item.title,
      summary: item.summary,
    })),
    files,
    availableEvidence,
    assembledAt: nowIso,
  };
  return { ...body, contextFingerprint: fingerprint(body) };
}

export function requireProjectContext(
  observer: ProjectObserver,
  insight: InsightStore | undefined,
  projectId: string,
  nowIso: string,
): ProjectContext {
  try {
    return assembleProjectContext(observer, insight, projectId, nowIso);
  } catch (cause) {
    if (cause instanceof AnalysisError) throw cause;
    throw new AnalysisError('CONTEXT_FAILED', cause instanceof Error ? cause.message : 'context assembly failed', {
      cause,
    });
  }
}
