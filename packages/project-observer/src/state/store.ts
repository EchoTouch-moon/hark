/**
 * @fileoverview 观察者专用 SQLite 存储引擎（Observer Store）
 * 包含单写锁保护（WriterLock）、顺序事件流（Event Stream with Epoch & Monotonic Sequence）、
 * 快照留存与健康状态更新，并支持测试断言专用的事务注入（TxFault）。
 */

import { DatabaseSync } from 'node:sqlite';
import {
  ObserverEventSchema,
  ObserverHealthSchema,
  ProjectSnapshotSchema,
  ProjectSummarySchema,
  RegisteredProjectSchema,
  ReportSourceSchema,
  WorktreeSummarySchema,
  TestSummarySchema,
  type EventType,
  type ForwardEventPage,
  type ListEventsForwardQuery,
  type ObservationRun,
  type ObserverEvent,
  type ObserverHealth,
  type ProjectSnapshot,
  type ProjectSummary,
  type RegisteredProject,
  type ReportSource,
} from '../contracts.js';
import { ObserverError } from '../errors.js';
import { openObserverDatabase } from './schema.js';
import { WriterLock } from './lock.js';

type Row = Record<string, unknown>;

export interface EventStreamRow {
  projectId: string;
  epoch: number;
  createdAt: string;
  retiredAt: string | null;
  lastSeq: number | null;
}

function asString(value: unknown): string {
  return String(value);
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function asInt(value: unknown): number {
  return Number(value);
}

export type TxFault = 'after-run' | 'after-snapshot' | 'after-events' | 'after-pointer';

/**
 * 观察者存储管理类
 */
export class ObserverStore {
  readonly db: DatabaseSync;
  readonly dbPath: string;
  private closed = false;
  private readonly lock: WriterLock | null;

  constructor(dbPath: string, options: { skipWriterLock?: boolean } = {}) {
    this.dbPath = dbPath;
    this.lock = options.skipWriterLock === true ? null : new WriterLock(`${dbPath}.writer.lock`);
    this.lock?.acquire();
    try {
      this.db = openObserverDatabase(dbPath);
    } catch (cause) {
      this.lock?.release();
      throw cause;
    }
  }

  close(): void {
    if (!this.closed) {
      this.db.close();
      this.lock?.release();
      this.closed = true;
    }
  }

  sqliteVersion(): string {
    const row = this.db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
    return row.v;
  }

  journalMode(): string {
    const row = this.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    return row.journal_mode;
  }

  integrity(): { integrityCheck: string; foreignKeyViolations: number } {
    const integrity = this.db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    const fk = this.db.prepare('PRAGMA foreign_key_check').all() as unknown[];
    return { integrityCheck: integrity.integrity_check, foreignKeyViolations: fk.length };
  }

  backupTo(destination: string): void {
    this.db.exec(`VACUUM INTO ${sqlQuote(destination)}`);
  }

  markInterruptedRuns(nowIso: string): number {
    const result = this.db
      .prepare(
        `UPDATE observation_runs
         SET status = 'error', error_code = 'INTERRUPTED', finished_at = ?
         WHERE finished_at IS NULL`,
      )
      .run(nowIso);
    return Number(result.changes);
  }

  transaction<T>(fn: () => T): T {
    let lastCause: unknown;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          const result = fn();
          this.db.exec('COMMIT');
          return result;
        } catch (cause) {
          try {
            this.db.exec('ROLLBACK');
          } catch {
            // keep original
          }
          throw cause;
        }
      } catch (cause) {
        lastCause = cause;
        if (isBusy(cause) && attempt < 5) {
          const delay = 20 * 2 ** attempt + Math.floor(Math.random() * 15);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
          continue;
        }
        if (cause instanceof ObserverError) throw cause;
        if (isBusy(cause)) {
          throw new ObserverError('DB_BUSY', 'sqlite writer was busy after bounded retries', { cause });
        }
        throw cause;
      }
    }
    throw new ObserverError('DB_BUSY', 'sqlite writer was busy after bounded retries', { cause: lastCause });
  }

  insertProject(project: RegisteredProject): void {
    this.db
      .prepare(
        `INSERT INTO observer_projects
         (id, name, canonical_path, git_identity, enabled, created_at, scan_interval_ms, debounce_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.canonicalPath,
        project.gitIdentity,
        project.enabled ? 1 : 0,
        project.createdAt,
        project.scanIntervalMs,
        project.debounceMs,
      );
    this.db
      .prepare(
        `INSERT INTO observer_health
         (project_id, last_success_at, last_error_code, last_error_message, watch_status, collection_status,
          last_reconcile_at, last_observed_at, last_snapshot_id, current_revision, last_gap_at)
         VALUES (?, NULL, NULL, NULL, ?, 'UNAVAILABLE', NULL, NULL, NULL, 0, NULL)`,
      )
      .run(project.id, project.enabled ? 'polling' : 'paused');
    this.ensureLiveStream(project.id, project.createdAt);
  }

  getProject(id: string): RegisteredProject | null {
    const row = this.db.prepare('SELECT * FROM observer_projects WHERE id = ?').get(id) as Row | undefined;
    return row ? this.rowToProject(row) : null;
  }

  getProjectByPath(canonicalPath: string): RegisteredProject | null {
    const row = this.db
      .prepare('SELECT * FROM observer_projects WHERE canonical_path = ?')
      .get(canonicalPath) as Row | undefined;
    return row ? this.rowToProject(row) : null;
  }

  listRegistered(): RegisteredProject[] {
    const rows = this.db.prepare('SELECT * FROM observer_projects ORDER BY created_at ASC').all() as Row[];
    return rows.map((row) => this.rowToProject(row));
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE observer_projects SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  }

  setGitIdentity(id: string, gitIdentity: string | null): void {
    this.db.prepare('UPDATE observer_projects SET git_identity = ? WHERE id = ?').run(gitIdentity, id);
  }

  deleteProject(id: string): void {
    this.transaction(() => {
      this.retireStream(id);
      this.db.prepare('DELETE FROM observer_events WHERE project_id = ?').run(id);
      this.db.prepare('DELETE FROM observer_snapshots WHERE project_id = ?').run(id);
      this.db.prepare('DELETE FROM observation_runs WHERE project_id = ?').run(id);
      this.db.prepare('DELETE FROM report_sources WHERE project_id = ?').run(id);
      this.db.prepare('DELETE FROM observer_health WHERE project_id = ?').run(id);
      this.db.prepare('DELETE FROM observer_projects WHERE id = ?').run(id);
    });
  }

  insertRun(run: ObservationRun): void {
    this.db
      .prepare(
        `INSERT INTO observation_runs
         (id, project_id, started_at, finished_at, status, source, error_code, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.projectId,
        run.startedAt,
        run.finishedAt,
        run.status,
        run.source,
        run.errorCode,
        run.errorMessage,
      );
  }

  finishRun(run: ObservationRun): void {
    this.db
      .prepare(
        `UPDATE observation_runs
         SET finished_at = ?, status = ?, error_code = ?, error_message = ?
         WHERE id = ?`,
      )
      .run(run.finishedAt, run.status, run.errorCode, run.errorMessage, run.id);
  }

  insertSnapshot(snapshot: ProjectSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO observer_snapshots
         (id, project_id, observed_at, fingerprint, head_sha, branch, detached, unborn, worktree_json, test_json, accessibility, git_identity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.id,
        snapshot.projectId,
        snapshot.observedAt,
        snapshot.fingerprint,
        snapshot.headSha,
        snapshot.branch,
        snapshot.detached ? 1 : 0,
        snapshot.unborn ? 1 : 0,
        JSON.stringify(snapshot.worktree),
        JSON.stringify(snapshot.test),
        snapshot.accessibility,
        snapshot.gitIdentity,
      );
  }

  getLatestSnapshot(projectId: string): ProjectSnapshot | null {
    const health = this.getHealth(projectId);
    if (health?.lastSnapshotId) {
      const pinned = this.getSnapshot(health.lastSnapshotId);
      if (pinned !== null) return pinned;
    }
    const row = this.db
      .prepare(
        'SELECT * FROM observer_snapshots WHERE project_id = ? ORDER BY observed_at DESC, rowid DESC LIMIT 1',
      )
      .get(projectId) as Row | undefined;
    return row ? this.rowToSnapshot(row) : null;
  }

  getLatestOkSnapshot(projectId: string): ProjectSnapshot | null {
    const row = this.db
      .prepare(
        `SELECT * FROM observer_snapshots
         WHERE project_id = ? AND accessibility = 'OK'
         ORDER BY observed_at DESC, rowid DESC LIMIT 1`,
      )
      .get(projectId) as Row | undefined;
    return row ? this.rowToSnapshot(row) : null;
  }

  getSnapshot(id: string): ProjectSnapshot | null {
    const row = this.db.prepare('SELECT * FROM observer_snapshots WHERE id = ?').get(id) as Row | undefined;
    return row ? this.rowToSnapshot(row) : null;
  }

  insertEvents(events: ObserverEvent[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO observer_events
       (id, project_id, run_id, type, before_snapshot_id, after_snapshot_id, occurred_at, payload_json, evidence_json, append_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const event of events) {
      const appendSeq = this.allocateAppendSeq();
      stmt.run(
        event.eventId,
        event.projectId,
        event.evidence.observationRunId,
        event.type,
        event.fromSnapshotId,
        event.toSnapshotId,
        event.observedAt,
        JSON.stringify(event.payload ?? {}),
        JSON.stringify(event.evidence),
        appendSeq,
      );
      event.appendSeq = appendSeq;
    }
  }

  countEvents(projectId: string, types?: EventType[]): number {
    if (types === undefined || types.length === 0) {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM observer_events WHERE project_id = ?').get(projectId) as {
        n: number;
      };
      return row.n;
    }
    const placeholders = types.map(() => '?').join(',');
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM observer_events WHERE project_id = ? AND type IN (${placeholders})`)
      .get(projectId, ...types) as { n: number };
    return row.n;
  }

  listEvents(
    projectId?: string,
    options: { cursor?: string; limit?: number; types?: EventType[] } = {},
  ): { events: ObserverEvent[]; nextCursor: string | null } {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const types = options.types ?? [];
    const params: Array<string | number> = [];
    let sql = 'SELECT * FROM observer_events WHERE 1=1';
    if (projectId !== undefined && projectId.trim() !== '') {
      sql += ' AND project_id = ?';
      params.push(projectId.trim());
    }
    if (types.length > 0) {
      sql += ` AND type IN (${types.map(() => '?').join(',')})`;
      params.push(...types);
    }
    if (options.cursor) {
      const [occurredAt, id] = splitCursor(options.cursor);
      sql += ' AND (occurred_at < ? OR (occurred_at = ? AND id < ?))';
      params.push(occurredAt, occurredAt, id);
    }
    sql += ' ORDER BY occurred_at DESC, id DESC LIMIT ?';
    params.push(limit + 1);
    const rows = this.db.prepare(sql).all(...params) as Row[];
    const page = rows.slice(0, limit).map((row) => this.rowToEvent(row));
    const extra = rows[limit];
    const last = page[page.length - 1];
    return {
      events: page,
      nextCursor: extra !== undefined && last !== undefined ? `${last.observedAt}|${last.eventId}` : null,
    };
  }

  listRecentEvents(limit: number = 10, projectId?: string): ObserverEvent[] {
    const bounded = Math.min(Math.max(limit, 1), 50);
    let sql = 'SELECT * FROM observer_events';
    const params: Array<string | number> = [];
    if (projectId !== undefined) {
      sql += ' WHERE project_id = ?';
      params.push(projectId);
    }
    sql += ' ORDER BY occurred_at DESC, id DESC LIMIT ?';
    params.push(bounded);
    const rows = this.db.prepare(sql).all(...params) as Row[];
    return rows.map((row) => this.rowToEvent(row));
  }

  allocatedAppendSeq(): number {
    const row = this.db.prepare(`SELECT value FROM observer_meta WHERE key = 'append_seq'`).get() as
      | { value: number }
      | undefined;
    if (row === undefined) {
      throw new ObserverError('INTERNAL', 'observer_meta append_seq counter is missing');
    }
    return asInt(row.value);
  }

  getEventStream(projectId: string): EventStreamRow | null {
    const row = this.db.prepare('SELECT * FROM observer_event_stream WHERE project_id = ?').get(projectId) as
      | Row
      | undefined;
    return row ? rowToStream(row) : null;
  }

  listEventsForward(projectId: string, options: ListEventsForwardQuery = {}): ForwardEventPage {
    const afterSeq = options.afterSeq ?? 0;
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      throw new ObserverError('INVALID_CURSOR', 'afterSeq must be a non-negative integer');
    }
    const requestedWatermark = options.highWatermark;
    if (requestedWatermark !== undefined && (!Number.isInteger(requestedWatermark) || requestedWatermark < 0)) {
      throw new ObserverError('INVALID_CURSOR', 'highWatermark must be a non-negative integer');
    }
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const allocated = this.allocatedAppendSeq();
    const highWatermark = Math.min(requestedWatermark ?? allocated, allocated);
    const stream = this.getEventStream(projectId);
    const project = this.getProject(projectId);

    if (afterSeq > allocated) {
      return emptyForwardPage(afterSeq, allocated, stream?.epoch ?? 0, 'CURSOR_AHEAD_OF_STREAM');
    }
    if (project === null && stream === null) {
      return emptyForwardPage(afterSeq, allocated, 0, 'PROJECT_NOT_FOUND');
    }
    if (project === null && stream !== null) {
      const status =
        options.expectedEpoch !== undefined && options.expectedEpoch !== stream.epoch
          ? 'STREAM_EPOCH_MISMATCH'
          : 'PROJECT_REMOVED';
      return emptyForwardPage(afterSeq, stream.lastSeq ?? allocated, stream.epoch, status);
    }
    if (stream !== null && options.expectedEpoch !== undefined && options.expectedEpoch !== stream.epoch) {
      return emptyForwardPage(afterSeq, highWatermark, stream.epoch, 'STREAM_EPOCH_MISMATCH');
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM observer_events
         WHERE project_id = ? AND append_seq > ? AND append_seq <= ?
         ORDER BY append_seq ASC LIMIT ?`,
      )
      .all(projectId, afterSeq, highWatermark, limit + 1) as Row[];
    const page = rows.slice(0, limit).map((row) => this.rowToEvent(row));
    const extra = rows[limit];
    const last = page[page.length - 1];
    return {
      events: page,
      nextCursor: last?.appendSeq ?? afterSeq,
      hasMore: extra !== undefined,
      highWatermark,
      streamEpoch: stream?.epoch ?? 1,
      status: 'OK',
    };
  }

  addReportSource(source: ReportSource): void {
    this.db
      .prepare(
        `INSERT INTO report_sources (id, project_id, format, relative_path, enabled)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, relative_path) DO UPDATE SET enabled = excluded.enabled`,
      )
      .run(source.id, source.projectId, source.format, source.relativePath, source.enabled ? 1 : 0);
  }

  listReportSources(projectId: string): ReportSource[] {
    const rows = this.db.prepare('SELECT * FROM report_sources WHERE project_id = ?').all(projectId) as Row[];
    return rows.map((row) => this.rowToReport(row));
  }

  removeReportSource(projectId: string, sourceId: string): void {
    this.db.prepare('DELETE FROM report_sources WHERE project_id = ? AND id = ?').run(projectId, sourceId);
  }

  upsertHealth(health: ObserverHealth): void {
    this.db
      .prepare(
        `INSERT INTO observer_health
         (project_id, last_success_at, last_error_code, last_error_message, watch_status, collection_status,
          last_reconcile_at, last_observed_at, last_snapshot_id, current_revision, last_gap_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           last_success_at = excluded.last_success_at,
           last_error_code = excluded.last_error_code,
           last_error_message = excluded.last_error_message,
           watch_status = excluded.watch_status,
           collection_status = excluded.collection_status,
           last_reconcile_at = excluded.last_reconcile_at,
           last_observed_at = excluded.last_observed_at,
           last_snapshot_id = excluded.last_snapshot_id,
           current_revision = excluded.current_revision,
           last_gap_at = excluded.last_gap_at`,
      )
      .run(
        health.projectId,
        health.lastSuccessAt,
        health.lastErrorCode,
        health.lastErrorMessage,
        health.watchStatus,
        health.collectionStatus,
        health.lastReconcileAt,
        health.lastObservedAt,
        health.lastSnapshotId,
        health.currentRevision,
        health.lastGapAt,
      );
  }

  /** CAS pointer update. Returns false when expectedRevision does not match. */
  commitHealth(health: ObserverHealth, expectedRevision: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE observer_health SET
           last_success_at = ?, last_error_code = ?, last_error_message = ?,
           watch_status = ?, collection_status = ?, last_reconcile_at = ?,
           last_observed_at = ?, last_snapshot_id = ?, last_gap_at = ?,
           current_revision = current_revision + 1
         WHERE project_id = ? AND current_revision = ?`,
      )
      .run(
        health.lastSuccessAt,
        health.lastErrorCode,
        health.lastErrorMessage,
        health.watchStatus,
        health.collectionStatus,
        health.lastReconcileAt,
        health.lastObservedAt,
        health.lastSnapshotId,
        health.lastGapAt,
        health.projectId,
        expectedRevision,
      );
    return Number(result.changes) === 1;
  }

  getHealth(projectId: string): ObserverHealth | null {
    const row = this.db.prepare('SELECT * FROM observer_health WHERE project_id = ?').get(projectId) as Row | undefined;
    return row ? this.rowToHealth(row) : null;
  }

  listSummaries(): ProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, h.collection_status, h.watch_status, h.last_success_at, h.last_observed_at,
                s.head_sha, s.branch, s.detached, s.unborn, s.worktree_json, s.test_json, s.fingerprint
         FROM observer_projects p
         LEFT JOIN observer_health h ON h.project_id = p.id
         LEFT JOIN observer_snapshots s ON s.id = h.last_snapshot_id
         ORDER BY p.created_at ASC`,
      )
      .all() as Row[];
    return rows.map((row) => this.rowToSummary(row));
  }

  pruneRuns(projectId: string, keep: number): void {
    this.db
      .prepare(
        `DELETE FROM observation_runs
         WHERE project_id = ?
           AND id NOT IN (
             SELECT id FROM observation_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?
           )
           AND id NOT IN (
             SELECT run_id FROM observer_events WHERE project_id = ?
           )`,
      )
      .run(projectId, projectId, keep, projectId);
  }

  private rowToProject(row: Row): RegisteredProject {
    return RegisteredProjectSchema.parse({
      id: asString(row['id']),
      name: asString(row['name']),
      canonicalPath: asString(row['canonical_path']),
      gitIdentity: asNullableString(row['git_identity']),
      enabled: asInt(row['enabled']) === 1,
      createdAt: asString(row['created_at']),
      scanIntervalMs: asInt(row['scan_interval_ms']),
      debounceMs: asInt(row['debounce_ms']),
    });
  }

  private rowToSnapshot(row: Row): ProjectSnapshot {
    return ProjectSnapshotSchema.parse({
      id: asString(row['id']),
      projectId: asString(row['project_id']),
      observedAt: asString(row['observed_at']),
      fingerprint: asString(row['fingerprint']),
      headSha: asNullableString(row['head_sha']),
      branch: asNullableString(row['branch']),
      detached: asInt(row['detached']) === 1,
      unborn: asInt(row['unborn']) === 1,
      worktree: WorktreeSummarySchema.parse(JSON.parse(asString(row['worktree_json']))),
      test: TestSummarySchema.parse(JSON.parse(asString(row['test_json']))),
      accessibility: asString(row['accessibility']),
      gitIdentity: asNullableString(row['git_identity']),
    });
  }

  private rowToEvent(row: Row): ObserverEvent {
    return ObserverEventSchema.parse({
      eventId: asString(row['id']),
      projectId: asString(row['project_id']),
      type: asString(row['type']),
      observedAt: asString(row['occurred_at']),
      fromSnapshotId: asNullableString(row['before_snapshot_id']),
      toSnapshotId: asNullableString(row['after_snapshot_id']),
      payload: JSON.parse(asString(row['payload_json'])),
      evidence: JSON.parse(asString(row['evidence_json'])),
      appendSeq: asInt(row['append_seq']),
    });
  }

  private allocateAppendSeq(): number {
    const result = this.db.prepare(`UPDATE observer_meta SET value = value + 1 WHERE key = 'append_seq'`).run();
    if (Number(result.changes) !== 1) {
      throw new ObserverError('INTERNAL', 'failed to allocate append_seq');
    }
    return this.allocatedAppendSeq();
  }

  private ensureLiveStream(projectId: string, createdAt: string): void {
    const existing = this.getEventStream(projectId);
    if (existing === null) {
      this.db
        .prepare(
          `INSERT INTO observer_event_stream (project_id, epoch, created_at, retired_at, last_seq)
           VALUES (?, 1, ?, NULL, NULL)`,
        )
        .run(projectId, createdAt);
      return;
    }
    if (existing.retiredAt !== null) {
      this.db
        .prepare(
          `UPDATE observer_event_stream
           SET epoch = epoch + 1, created_at = ?, retired_at = NULL, last_seq = NULL
           WHERE project_id = ?`,
        )
        .run(createdAt, projectId);
    }
  }

  private retireStream(projectId: string): void {
    const last = this.db
      .prepare('SELECT MAX(append_seq) AS seq FROM observer_events WHERE project_id = ?')
      .get(projectId) as { seq: number | null };
    const lastSeq = last.seq === null ? this.allocatedAppendSeq() : asInt(last.seq);
    const now = new Date().toISOString();
    const existing = this.getEventStream(projectId);
    if (existing === null) {
      this.db
        .prepare(
          `INSERT INTO observer_event_stream (project_id, epoch, created_at, retired_at, last_seq)
           VALUES (?, 1, ?, ?, ?)`,
        )
        .run(projectId, now, now, lastSeq);
      return;
    }
    this.db
      .prepare('UPDATE observer_event_stream SET retired_at = ?, last_seq = ? WHERE project_id = ?')
      .run(now, lastSeq, projectId);
  }

  private rowToReport(row: Row): ReportSource {
    return ReportSourceSchema.parse({
      id: asString(row['id']),
      projectId: asString(row['project_id']),
      format: asString(row['format']),
      relativePath: asString(row['relative_path']),
      enabled: asInt(row['enabled']) === 1,
    });
  }

  private rowToHealth(row: Row): ObserverHealth {
    return ObserverHealthSchema.parse({
      projectId: asString(row['project_id']),
      collectionStatus: asString(row['collection_status']),
      watchStatus: asString(row['watch_status']),
      lastSuccessAt: asNullableString(row['last_success_at']),
      lastErrorCode: asNullableString(row['last_error_code']),
      lastErrorMessage: asNullableString(row['last_error_message']),
      lastReconcileAt: asNullableString(row['last_reconcile_at']),
      lastObservedAt: asNullableString(row['last_observed_at']),
      lastSnapshotId: asNullableString(row['last_snapshot_id']),
      currentRevision: asInt(row['current_revision'] ?? 0),
      lastGapAt: asNullableString(row['last_gap_at']),
    });
  }

  private rowToSummary(row: Row): ProjectSummary {
    const headSha = asNullableString(row['head_sha']);
    const worktreeRaw = asNullableString(row['worktree_json']);
    const testRaw = asNullableString(row['test_json']);
    return ProjectSummarySchema.parse({
      id: asString(row['id']),
      name: asString(row['name']),
      canonicalPath: asString(row['canonical_path']),
      enabled: asInt(row['enabled']) === 1,
      createdAt: asString(row['created_at']),
      branch: asNullableString(row['branch']),
      headSha,
      shortSha: headSha === null ? null : headSha.slice(0, 7),
      detached: asInt(row['detached'] ?? 0) === 1,
      unborn: asInt(row['unborn'] ?? 0) === 1,
      worktree: worktreeRaw === null ? null : WorktreeSummarySchema.parse(JSON.parse(worktreeRaw)),
      test: testRaw === null ? null : TestSummarySchema.parse(JSON.parse(testRaw)),
      collectionStatus: asString(row['collection_status'] ?? 'UNAVAILABLE'),
      watchStatus: asString(row['watch_status'] ?? 'paused'),
      lastSuccessAt: asNullableString(row['last_success_at']),
      lastObservedAt: asNullableString(row['last_observed_at']),
      fingerprint: asNullableString(row['fingerprint']),
    });
  }
}

function rowToStream(row: Row): EventStreamRow {
  return {
    projectId: asString(row['project_id']),
    epoch: asInt(row['epoch']),
    createdAt: asString(row['created_at']),
    retiredAt: asNullableString(row['retired_at']),
    lastSeq: row['last_seq'] === null || row['last_seq'] === undefined ? null : asInt(row['last_seq']),
  };
}

function emptyForwardPage(
  afterSeq: number,
  highWatermark: number,
  streamEpoch: number,
  status: ForwardEventPage['status'],
): ForwardEventPage {
  return {
    events: [],
    nextCursor: afterSeq,
    hasMore: false,
    highWatermark,
    streamEpoch,
    status,
  };
}

function splitCursor(cursor: string): [string, string] {
  const sep = cursor.lastIndexOf('|');
  if (sep <= 0) return [cursor, ''];
  return [cursor.slice(0, sep), cursor.slice(sep + 1)];
}

function isBusy(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /busy|locked/i.test(message);
}

function sqlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
