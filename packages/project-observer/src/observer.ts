import path from 'node:path';
import {
  RegisterProjectOptionsSchema,
  type EventType,
  type ObservationRun,
  type ObserverHealth,
  type PagedEvents,
  type ProjectSnapshot,
  type ProjectSummary,
  type RegisterProjectOptions,
  type RegisteredProject,
  type ReportSource,
  type ScanReason,
} from './contracts.js';
import { KeyedMutex, Semaphore } from './concurrency.js';
import { ObserverError } from './errors.js';
import { DirtyHintBuffer } from './fs/dirty.js';
import { watchProject, type WatchHandle } from './fs/watcher.js';
import { GitSource } from './git/source.js';
import type { GitRunner } from './git/run.js';
import { newId, projectIdForPath } from './ids.js';
import { canonicalizeProjectPath, resolveInsideRoot } from './paths.js';
import { TestReportSource } from './reports/source.js';
import { scanProject } from './scanner.js';
import { ObserverStore, type TxFault } from './state/store.js';
import type { Clock } from './time.js';
import { nowUtcIso } from './time.js';

export interface ProjectObserverOptions {
  dbPath: string;
  clock?: Clock;
  gitRunner?: GitRunner;
  watchEnabled?: boolean;
  debounceMs?: number;
  reconcileIntervalMs?: number;
  scanTimeoutMs?: number;
  maxConcurrentScans?: number;
  maxReportBytes?: number;
  gapThresholdMs?: number;
}

export class ProjectObserver {
  readonly store: ObserverStore;
  private readonly git: GitSource;
  private readonly reports: TestReportSource;
  private readonly clock: Clock;
  private readonly watchEnabled: boolean;
  private readonly defaultDebounceMs: number;
  private readonly reconcileIntervalMs: number;
  private readonly gapThresholdMs: number;
  private readonly semaphore: Semaphore;
  private readonly locks = new KeyedMutex();
  private readonly dirty: DirtyHintBuffer;
  private readonly watchers = new Map<string, WatchHandle>();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private readonly inflight = new Map<string, Promise<ObservationRun>>();

  constructor(options: ProjectObserverOptions) {
    this.store = new ObserverStore(options.dbPath);
    this.clock = options.clock ?? (() => new Date());
    this.git = new GitSource({ runner: options.gitRunner, timeoutMs: options.scanTimeoutMs });
    this.reports = new TestReportSource(options.maxReportBytes ?? 16 * 1024 * 1024);
    this.watchEnabled = options.watchEnabled ?? false;
    this.defaultDebounceMs = options.debounceMs ?? 1500;
    this.reconcileIntervalMs = options.reconcileIntervalMs ?? 5 * 60 * 1000;
    this.gapThresholdMs = options.gapThresholdMs ?? Math.floor(this.reconcileIntervalMs * 1.5);
    this.semaphore = new Semaphore(options.maxConcurrentScans ?? 2);
    this.dirty = new DirtyHintBuffer(this.defaultDebounceMs, (projectId) => {
      void this.scanProject(projectId, 'watch').catch(() => undefined);
    });
  }

  async registerProject(localPath: string, options: RegisterProjectOptions = {}): Promise<RegisteredProject> {
    const parsed = RegisterProjectOptionsSchema.parse(options);
    const canonicalPath = canonicalizeProjectPath(localPath);
    const existing = this.store.getProjectByPath(canonicalPath);
    if (existing !== null) {
      throw new ObserverError('DUPLICATE_PATH', `path already registered as ${existing.id}`);
    }
    const probe = await this.git.scan(canonicalPath);
    if (probe.accessibility !== 'OK') {
      throw new ObserverError(probe.errorCode ?? 'NOT_A_GIT_REPO', probe.errorMessage ?? 'not a git repository');
    }
    const id = projectIdForPath(canonicalPath);
    const createdAt = nowUtcIso(this.clock);
    const project: RegisteredProject = {
      id,
      name: parsed.name ?? path.basename(canonicalPath),
      canonicalPath,
      gitIdentity: probe.gitIdentity,
      enabled: true,
      createdAt,
      scanIntervalMs: parsed.scanIntervalMs ?? this.reconcileIntervalMs,
      debounceMs: parsed.debounceMs ?? this.defaultDebounceMs,
    };
    this.store.insertProject(project);
    for (const report of parsed.reports ?? []) {
      const relativePath = report.relativePath.replace(/\\/g, '/');
      resolveInsideRoot(canonicalPath, relativePath);
      this.store.addReportSource({
        id: newId('rpt'),
        projectId: id,
        format: report.format,
        relativePath,
        enabled: true,
      });
    }
    await this.scanProject(id, 'register');
    if (this.started && this.watchEnabled) {
      await this.startWatch(id);
    }
    const saved = this.store.getProject(id);
    if (saved === null) throw new ObserverError('INTERNAL', 'project missing after register');
    return saved;
  }

  listProjects(): ProjectSummary[] {
    return this.store.listSummaries();
  }

  getProject(projectId: string): RegisteredProject {
    const project = this.store.getProject(projectId);
    if (project === null) throw new ObserverError('PROJECT_NOT_FOUND', `project ${projectId} not found`);
    return project;
  }

  scanStats(): { scanCount: number; maxActiveScans: number } {
    return { scanCount: this.git.scanCount, maxActiveScans: this.git.maxActiveScans };
  }

  async scanProject(projectId: string, reason: ScanReason, fault?: TxFault): Promise<ObservationRun> {
    const project = this.getProject(projectId);
    if (!project.enabled && reason !== 'manual' && reason !== 'register' && reason !== 'resume') {
      throw new ObserverError('PROJECT_PAUSED', `project ${projectId} is paused`);
    }
    const existing = this.inflight.get(projectId);
    if (existing !== undefined && fault === undefined) {
      return existing;
    }
    const work = this.executeScan(projectId, reason, fault);
    this.inflight.set(projectId, work);
    try {
      return await work;
    } finally {
      if (this.inflight.get(projectId) === work) this.inflight.delete(projectId);
    }
  }

  private async executeScan(projectId: string, reason: ScanReason, fault?: TxFault): Promise<ObservationRun> {
    return this.locks.runExclusive(projectId, async () => {
      const release = await this.semaphore.acquire();
      try {
        let result = await this.scanOnce(projectId, reason, fault);
        let extra = 0;
        while (this.dirty.pending(projectId) && extra < 3 && fault === undefined) {
          this.dirty.take(projectId);
          result = await this.scanOnce(projectId, 'watch');
          extra += 1;
        }
        return result;
      } finally {
        release();
      }
    });
  }

  private async scanOnce(projectId: string, reason: ScanReason, fault?: TxFault): Promise<ObservationRun> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await scanProject(
          {
            store: this.store,
            git: this.git,
            reports: this.reports,
            clock: this.clock,
            gapThresholdMs: this.gapThresholdMs,
            fault,
          },
          projectId,
          reason,
        );
      } catch (cause) {
        last = cause;
        if (cause instanceof ObserverError && cause.code === 'CAS_CONFLICT' && attempt < 2) continue;
        if (cause instanceof ObserverError) throw cause;
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new ObserverError('SCAN_FAILED', message, { cause });
      }
    }
    throw last instanceof ObserverError ? last : new ObserverError('SCAN_FAILED', 'scan failed');
  }

  getLatestSnapshot(projectId: string): ProjectSnapshot | null {
    this.getProject(projectId);
    return this.store.getLatestSnapshot(projectId);
  }

  listEvents(
    projectId: string,
    query: { cursor?: string; limit?: number; types?: EventType[] } = {},
  ): PagedEvents {
    this.getProject(projectId);
    return this.store.listEvents(projectId, query);
  }

  getObserverHealth(projectId: string): ObserverHealth {
    this.getProject(projectId);
    const health = this.store.getHealth(projectId);
    if (health === null) {
      throw new ObserverError('PROJECT_NOT_FOUND', `health missing for ${projectId}`);
    }
    return health;
  }

  async setProjectEnabled(projectId: string, enabled: boolean): Promise<void> {
    this.getProject(projectId);
    this.store.setEnabled(projectId, enabled);
    const health = this.store.getHealth(projectId);
    if (health !== null) {
      this.store.upsertHealth({
        ...health,
        watchStatus: enabled ? (this.watchEnabled ? 'watching' : 'polling') : 'paused',
      });
    }
    if (!enabled) {
      await this.stopWatch(projectId);
      return;
    }
    if (this.started) {
      await this.scanProject(projectId, 'resume');
      if (this.watchEnabled) await this.startWatch(projectId);
    }
  }

  addReportSource(projectId: string, relativePath: string, format: 'junit-xml' = 'junit-xml'): ReportSource {
    const project = this.getProject(projectId);
    const normalized = relativePath.replace(/\\/g, '/');
    resolveInsideRoot(project.canonicalPath, normalized);
    const source: ReportSource = {
      id: newId('rpt'),
      projectId,
      format,
      relativePath: normalized,
      enabled: true,
    };
    this.store.addReportSource(source);
    if (this.started && this.watchEnabled && project.enabled) {
      void this.startWatch(projectId);
    }
    return source;
  }

  listReportSources(projectId: string): ReportSource[] {
    this.getProject(projectId);
    return this.store.listReportSources(projectId);
  }

  removeReportSource(projectId: string, sourceId: string): void {
    this.getProject(projectId);
    this.store.removeReportSource(projectId, sourceId);
  }

  async removeProject(projectId: string): Promise<void> {
    this.getProject(projectId);
    await this.stopWatch(projectId);
    this.store.deleteProject(projectId);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.store.markInterruptedRuns(nowUtcIso(this.clock));
    for (const project of this.store.listRegistered()) {
      if (!project.enabled) continue;
      try {
        await this.scanProject(project.id, 'startup');
      } catch {
        // isolation: one repo must not block others
      }
      if (this.watchEnabled) {
        try {
          await this.startWatch(project.id);
        } catch {
          const health = this.store.getHealth(project.id);
          if (health !== null) {
            this.store.upsertHealth({
              ...health,
              collectionStatus: health.collectionStatus === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'DEGRADED',
              watchStatus: 'polling',
              lastErrorCode: 'WATCH_FAILED',
              lastErrorMessage: 'filesystem watch failed; falling back to polling',
            });
          }
        }
      }
    }
    this.reconcileTimer = setInterval(() => {
      void this.reconcileAll();
    }, this.reconcileIntervalMs);
    this.reconcileTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.reconcileTimer !== null) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    this.dirty.clear();
    await Promise.all([...this.inflight.values()].map((work) => work.catch(() => undefined)));
    const ids = [...this.watchers.keys()];
    await Promise.all(ids.map((id) => this.stopWatch(id)));
  }

  close(): void {
    this.store.close();
  }

  hintDirty(projectId: string, relativePath: string): void {
    const project = this.store.getProject(projectId);
    if (project === null || !project.enabled) return;
    this.dirty.hint(projectId, relativePath, project.debounceMs);
  }

  private async reconcileAll(): Promise<void> {
    for (const project of this.store.listRegistered()) {
      if (!project.enabled) continue;
      try {
        await this.scanProject(project.id, 'reconcile');
      } catch {
        // isolate
      }
    }
  }

  private async startWatch(projectId: string): Promise<void> {
    await this.stopWatch(projectId);
    const project = this.store.getProject(projectId);
    if (project === null || !project.enabled) return;
    const reports: string[] = [];
    for (const source of this.store.listReportSources(projectId)) {
      try {
        reports.push(resolveInsideRoot(project.canonicalPath, source.relativePath));
      } catch {
        // skip paths that escape the worktree
      }
    }
    try {
      const handle = await watchProject({
        root: project.canonicalPath,
        reportAbsolutes: reports,
        onDirty: (relative) => this.hintDirty(projectId, relative),
        onError: () => {
          const health = this.store.getHealth(projectId);
          if (health !== null) {
            this.store.upsertHealth({
              ...health,
              collectionStatus: health.collectionStatus === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'DEGRADED',
              watchStatus: 'polling',
            });
          }
        },
      });
      this.watchers.set(projectId, handle);
      const health = this.store.getHealth(projectId);
      if (health !== null) {
        this.store.upsertHealth({ ...health, watchStatus: 'watching' });
      }
    } catch {
      const health = this.store.getHealth(projectId);
      if (health !== null) {
        this.store.upsertHealth({
          ...health,
          collectionStatus: health.collectionStatus === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'DEGRADED',
          watchStatus: 'polling',
          lastErrorCode: 'WATCH_FAILED',
          lastErrorMessage: 'filesystem watch failed; falling back to polling',
        });
      }
    }
  }

  private async stopWatch(projectId: string): Promise<void> {
    const handle = this.watchers.get(projectId);
    if (handle === undefined) return;
    this.watchers.delete(projectId);
    await handle.close();
  }
}
