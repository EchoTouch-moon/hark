import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { InsightStore } from '@hearth/project-insight';
import type { ProjectObserver } from '@hearth/project-observer';
import type { AnalysisRunView, AnalysisTrigger } from '../contracts.js';
import { AnalysisError } from '../errors.js';
import { requireProjectContext } from '../context/assemble.js';
import { bindRecommendation } from './bind.js';
import type { AnalysisProvider } from '../providers/types.js';
import type { AnalysisStore } from '../store/store.js';

export interface StartAnalysisInput {
  projectId: string;
  insightId?: string;
  trigger: AnalysisTrigger;
  consentFingerprint?: string;
}

export class AnalysisService {
  private readonly inflight = new Map<string, { projectId: string; controller: AbortController; done: Promise<void> }>();

  constructor(
    private readonly deps: {
      observer: ProjectObserver;
      insight?: InsightStore;
      store: AnalysisStore;
      provider: AnalysisProvider;
      now?: () => string;
      maxConcurrent?: number;
      maxDailyRequests?: number;
    },
  ) {}

  close(): void {
    for (const entry of this.inflight.values()) entry.controller.abort();
    this.inflight.clear();
    this.deps.store.close();
  }

  async shutdown(): Promise<void> {
    for (const entry of this.inflight.values()) entry.controller.abort();
    await Promise.all([...this.inflight.values()].map(entry => entry.done));
    this.close();
  }

  async start(input: StartAnalysisInput): Promise<AnalysisRunView> {
    if (this.deps.store.runningCount(input.projectId) > 0 || [...this.inflight.values()].some(entry => entry.projectId === input.projectId)) {
      throw new AnalysisError('IN_FLIGHT', 'an analysis is already running for this project');
    }
    if (this.deps.store.pendingDeletions().includes(input.projectId)) throw new AnalysisError('PROJECT_DELETING', '项目正在清除历史');
    if (this.inflight.size >= (this.deps.maxConcurrent ?? 1)) throw new AnalysisError('CAPACITY', '模型全局并发限额已满');
    if (input.trigger === 'insight' && !input.insightId) throw new AnalysisError('INVALID_INSIGHT', '洞察入口必须指定目标洞察');
    const now = this.now();
    if (this.deps.provider.id !== 'mock' && this.deps.store.requestsSince(now.slice(0, 10)) >= (this.deps.maxDailyRequests ?? 20)) {
      throw new AnalysisError('BUDGET', '模型每日请求预算已用完');
    }
    const context = this.context(input);
    if (this.deps.provider.id !== 'mock' && input.consentFingerprint !== context.contextFingerprint) {
      throw new AnalysisError('CONSENT_REQUIRED', '请先预览并确认本次发往外部模型的上下文；内容变化后需重新确认');
    }
    const id = `anl_${randomBytes(8).toString('hex')}`;
    this.deps.store.insertRunning({
      id,
      projectId: input.projectId,
      insightId: input.insightId ?? null,
      trigger: input.trigger,
      provider: this.deps.provider.id,
      model: this.deps.provider.model,
      snapshotId: context.snapshotId,
      headSha: context.headSha,
      streamEpoch: context.streamEpoch,
      contextFingerprint: context.contextFingerprint,
      startedAt: now,
    });
    const controller = new AbortController();
    let resolveDone!: () => void;
    const done = new Promise<void>(resolve => { resolveDone = resolve; });
    this.inflight.set(id, { projectId: input.projectId, controller, done });
    const started = Date.now();
    try {
      if (this.deps.provider.id !== 'mock') {
        const recipient = `${this.deps.provider.id}:${this.deps.provider.model ?? 'unknown'}`;
        this.deps.store.recordConsent(id, input.projectId, context.contextFingerprint, recipient, now);
        if (!this.deps.store.hasConsent(id, context.contextFingerprint, recipient)) throw new AnalysisError('CONSENT_REQUIRED', '缺少持久化发送确认');
      }
      const outcome = await this.deps.provider.analyze({
        context,
        insightId: input.insightId,
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw new AnalysisError('CANCELLED', 'analysis cancelled');
      const finishedAt = this.now();
      const usage = { latencyMs: Date.now() - started, inputChars: JSON.stringify(context).length };
      if (outcome.kind === 'unavailable') {
        this.deps.store.finish(id, {
          status: 'failed',
          errorCode: 'UNAVAILABLE',
          errorMessage: outcome.reason,
          usage,
          finishedAt,
        });
      } else if (outcome.kind === 'no_recommendation') {
        this.deps.store.finish(id, {
          status: 'no_recommendation',
          errorCode: 'NO_RECOMMENDATION',
          errorMessage: outcome.reason,
          usage,
          finishedAt,
        });
      } else {
        this.deps.store.finish(id, {
          status: 'succeeded',
          recommendation: bindRecommendation(context, outcome.recommendation),
          usage,
          finishedAt,
        });
      }
    } catch (cause) {
      const finishedAt = this.now();
      const code = cause instanceof AnalysisError ? cause.code : 'PROVIDER_FAILED';
      const status = code === 'CANCELLED' ? 'cancelled' : 'failed';
      this.deps.store.finish(id, {
        status,
        errorCode: code,
        errorMessage: cause instanceof Error ? cause.message : 'analysis failed',
        usage: { latencyMs: Date.now() - started },
        finishedAt,
      });
    } finally {
      this.inflight.delete(id);
      resolveDone();
    }
    const view = this.deps.store.get(id);
    if (view === null) throw new AnalysisError('NOT_FOUND', `run ${id} missing after persist`);
    return this.withStale(view, input.projectId);
  }

  private context(input: StartAnalysisInput) {
    return requireProjectContext(this.deps.observer, this.deps.insight, input.projectId, this.now(), input.insightId, this.deps.store.excludedPaths(input.projectId));
  }
  preview(input: StartAnalysisInput) {
    if (input.trigger === 'insight' && !input.insightId) throw new AnalysisError('INVALID_INSIGHT', '洞察入口必须指定目标洞察');
    return { ...this.identity(), context: this.context(input), excludedPaths: this.deps.store.excludedPaths(input.projectId) };
  }
  setPrivacy(projectId: string, paths: string[]): void {
    this.deps.observer.getProject(projectId);
    const parsed = z.array(z.string().min(1).max(256).refine(value => !value.startsWith('/') && !value.includes('\\') && !value.includes('\0') && !value.split('/').includes('..'))).max(32).parse(paths);
    this.deps.store.setExcludedPaths(projectId, [...new Set(parsed)]);
  }

  recoverInterrupted(): number { return this.deps.store.recoverInterrupted(this.now()); }

  cancel(runId: string): boolean {
    const entry = this.inflight.get(runId);
    if (!entry) return false;
    entry.controller.abort();
    return true;
  }

  async removeProject(projectId: string): Promise<void> {
    this.deps.store.requestDeletion(projectId, this.now());
    const running = [...this.inflight.values()].filter(entry => entry.projectId === projectId);
    for (const entry of running) entry.controller.abort();
    await Promise.all(running.map(entry => entry.done));
    try { await this.deps.observer.removeProject(projectId); }
    catch (cause) { if ((cause as {code?: string}).code !== 'PROJECT_NOT_FOUND') throw cause; }
    this.deps.insight?.purgeProject(projectId);
    this.deps.store.finishDeletion(projectId);
  }

  async recoverDeletions(): Promise<void> {
    for (const id of this.deps.store.pendingDeletions()) await this.removeProject(id);
  }

  identity(): {provider: string; model: string | null} {
    return { provider: this.deps.provider.id, model: this.deps.provider.model };
  }

  get(id: string): AnalysisRunView | null {
    const row = this.deps.store.get(id);
    return row ? this.withStale(row, row.projectId) : null;
  }

  list(projectId: string): AnalysisRunView[] {
    return this.deps.store.list(projectId).map((item) => this.withStale(item, projectId));
  }

  feedback(runId: string, kind: 'useful' | 'not_useful'): void {
    const run = this.deps.store.get(runId);
    if (run === null) throw new AnalysisError('NOT_FOUND', `run ${runId} not found`);
    this.deps.store.upsertFeedback(runId, kind, this.now());
  }

  private withStale(run: AnalysisRunView, projectId: string): AnalysisRunView {
    try {
      const snapshot = this.deps.observer.getLatestSnapshot(projectId);
      const headStale = (snapshot?.id ?? null) !== run.snapshotId || (snapshot?.headSha ?? null) !== run.headSha;
      const current = this.context({ projectId, trigger: run.trigger, ...(run.insightId ? {insightId: run.insightId} : {}) });
      const staleReason = headStale ? 'head' as const : current.contextFingerprint !== run.contextFingerprint ? 'context' as const : null;
      return { ...run, stale: staleReason !== null, staleReason };
    } catch {
      return { ...run, stale: true, staleReason: 'unavailable' };
    }
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))();
  }
}
