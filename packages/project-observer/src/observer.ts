/**
 * @fileoverview 项目观察器核心服务（ProjectObserver）
 * 
 * 职责：
 * 1. 本地 Git 仓库注册、路径规范化与可访问性探针；
 * 2. 状态扫描调度：周期轮询（reconcile）、文件监听（watch）与按需手动触发（manual/startup）；
 * 3. 并发与限流控制：基于信号量限制最大全局并发扫描数，基于项目 ID 互斥锁（KeyedMutex）保证单项目串行；
 * 4. 快照比对与事件生成（Git 分支、HEAD 切换、工作区脏状态、测试报告解析与健康度变更）；
 * 5. 异常弹性与容错：CAS 冲突重试、进程崩溃未完成运行清理、文件系统监听异常自动降级为轮询模式。
 */

import path from 'node:path';
import {
  RegisterProjectOptionsSchema,
  type EventType,
  type ObservationRun,
  type ObserverHealth,
  type ForwardEventPage,
  type ListEventsForwardQuery,
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

/** 项目观察器配置选项 */
export interface ProjectObserverOptions {
  /** SQLite 数据库文件路径 */
  dbPath: string;
  /** 可注入时钟函数（测试用，默认真实系统时间） */
  clock?: Clock;
  /** Git 执行器函数（可注入模拟执行器） */
  gitRunner?: GitRunner;
  /** 是否启用文件系统监听（默认 false） */
  watchEnabled?: boolean;
  /** 防抖延迟毫秒数（默认 1500ms） */
  debounceMs?: number;
  /** 全局对齐扫描间隔毫秒数（默认 5 分钟） */
  reconcileIntervalMs?: number;
  /** 单次 Git 扫描超时毫秒数（默认 15s） */
  scanTimeoutMs?: number;
  /** 最大并发扫描任务数（默认 2） */
  maxConcurrentScans?: number;
  /** 测试报告单文件最大字节数（默认 16MB） */
  maxReportBytes?: number;
  /** 判定出现观察中断（gap）的超时阈值毫秒数 */
  gapThresholdMs?: number;
}

/**
 * 项目观察器服务类
 */
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

  /**
   * 注册本地 Git 仓库并执行首次初始扫描
   * 
   * @param localPath 本地仓库路径（自动转为绝对规范路径）
   * @param options 注册选项（名称、测试报告路径、自定义扫描间隔等）
   * @returns 注册成功的项目元信息
   */
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

  /** 列出所有已注册项目的摘要信息 */
  listProjects(): ProjectSummary[] {
    return this.store.listSummaries();
  }

  /** 获取指定项目的元数据配置，不存在则抛出 ObserverError('PROJECT_NOT_FOUND') */
  getProject(projectId: string): RegisteredProject {
    const project = this.store.getProject(projectId);
    if (project === null) throw new ObserverError('PROJECT_NOT_FOUND', `project ${projectId} not found`);
    return project;
  }

  /** 获取 Git 扫描统计指标（累计扫描次数与当前峰值并发数） */
  scanStats(): { scanCount: number; maxActiveScans: number } {
    return { scanCount: this.git.scanCount, maxActiveScans: this.git.maxActiveScans };
  }

  /**
   * 触发项目状态扫描
   * 
   * @param projectId 项目 ID
   * @param reason 触发原因（startup/reconcile/watch/manual/register/resume）
   * @param fault 事务故障注入（测试用）
   * @returns 本次扫描生成的 ObservationRun 记录
   */
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

  /** 获取指定项目的最新状态快照（包含 Git 与测试报告聚合状态） */
  getLatestSnapshot(projectId: string): ProjectSnapshot | null {
    this.getProject(projectId);
    return this.store.getLatestSnapshot(projectId);
  }

  /**
   * 分页逆序查询项目事件日志（适合 UI 时间线展示）
   * 
   * @param projectId 项目 ID
   * @param query 查询参数（游标、条数、事件类型筛选）
   */
  listEvents(
    projectId: string,
    query: { cursor?: string; limit?: number; types?: EventType[] } = {},
  ): PagedEvents {
    this.getProject(projectId);
    return this.store.listEvents(projectId, query);
  }

  /**
   * 按追加顺序正向拉取事件流（供 Insight 消费者递增消费与断点续传）
   * 
   * 无需项目必须处于活跃注册状态，使得调用方即便在项目硬删除后仍能感知到
   * PROJECT_REMOVED 与 STREAM_EPOCH_MISMATCH 等生命周期事件。
   */
  listEventsForward(projectId: string, query: ListEventsForwardQuery = {}): ForwardEventPage {
    return this.store.listEventsForward(projectId, query);
  }

  /** 获取指定项目的观察运行健康度（包含采集状态、监听模式与最近错误） */
  getObserverHealth(projectId: string): ObserverHealth {
    this.getProject(projectId);
    const health = this.store.getHealth(projectId);
    if (health === null) {
      throw new ObserverError('PROJECT_NOT_FOUND', `health missing for ${projectId}`);
    }
    return health;
  }

  /** 启用或暂停项目的观察扫描；暂停时会停止文件系统监听 */
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

  /** 添加测试报告文件监控源（例如 JUnit XML） */
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

  /** 列出项目配置的所有测试报告数据源 */
  listReportSources(projectId: string): ReportSource[] {
    this.getProject(projectId);
    return this.store.listReportSources(projectId);
  }

  /** 移除指定的测试报告数据源 */
  removeReportSource(projectId: string, sourceId: string): void {
    this.getProject(projectId);
    this.store.removeReportSource(projectId, sourceId);
  }

  /** 注销并删除项目，停止关联的文件监听并清理元数据 */
  async removeProject(projectId: string): Promise<void> {
    this.getProject(projectId);
    await this.stopWatch(projectId);
    this.store.deleteProject(projectId);
  }

  /** 启动观察器后台引擎：清理未完成异常运行、对已启用项目执行启动扫描、开启监听与定时对齐 */
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

  /** 停止后台轮询定时器与所有活跃的文件系统监听器，等待处理中任务收尾 */
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

  /** 关闭 SQLite 存储连接 */
  close(): void {
    this.store.close();
  }

  /** 收到文件系统变动提示，写入防抖缓冲区并调度延时扫描 */
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
