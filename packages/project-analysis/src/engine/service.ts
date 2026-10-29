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
}

export class AnalysisService {
  private readonly inflight = new Map<string, AbortController>();

  constructor(
    private readonly deps: {
      observer: ProjectObserver;
      insight?: InsightStore;
      store: AnalysisStore;
      provider: AnalysisProvider;
      now?: () => string;
    },
  ) {}

  close(): void {
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
    this.deps.store.close();
  }

  async start(input: StartAnalysisInput): Promise<AnalysisRunView> {
    if (this.deps.store.runningCount(input.projectId) > 0 || this.inflight.has(input.projectId)) {
      throw new AnalysisError('IN_FLIGHT', 'an analysis is already running for this project');
    }
    const now = this.now();
    const context = requireProjectContext(this.deps.observer, this.deps.insight, input.projectId, now);
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
    this.inflight.set(input.projectId, controller);
    const started = Date.now();
    try {
      const outcome = await this.deps.provider.analyze({
        context,
        insightId: input.insightId,
        signal: controller.signal,
      });
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
      this.inflight.delete(input.projectId);
    }
    const view = this.deps.store.get(id);
    if (view === null) throw new AnalysisError('NOT_FOUND', `run ${id} missing after persist`);
    return this.withStale(view, input.projectId);
  }

  cancel(projectId: string): boolean {
    const controller = this.inflight.get(projectId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
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
      const stale = (snapshot?.id ?? null) !== run.snapshotId || (snapshot?.headSha ?? null) !== run.headSha;
      return { ...run, stale };
    } catch {
      return { ...run, stale: true };
    }
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))();
  }
}
