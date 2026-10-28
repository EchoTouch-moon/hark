import { DatabaseSync } from 'node:sqlite';
import { EXTRACTOR_VERSION, type ExtractedSignal, type SignalBatch } from '../contracts.js';
import { InsightError } from '../errors.js';
import { InsightWriterLock } from './lock.js';
import { openInsightDatabase } from './schema.js';

type Row = Record<string, unknown>;
export type CommitFault = 'after-signals' | 'after-cursor' | 'before-commit';
export type CheckpointStatus = 'ACTIVE' | 'FROZEN';

export interface ConsumerCheckpoint {
  projectId: string;
  streamEpoch: number;
  extractorVersion: string;
  afterSeq: number;
  revision: number;
  status: CheckpointStatus;
  updatedAt: string;
}

export interface SourceInterruption {
  id: number;
  projectId: string;
  streamEpoch: number;
  interruptionType: string;
  lastSafeCursor: number;
  detectedAt: string;
  resolutionStatus: 'OPEN' | 'ACKNOWLEDGED';
}

export interface InboxRow {
  signalId: string;
  projectId: string;
  streamEpoch: number;
  sourceEventId: string;
  appendSeq: number;
  extractorVersion: string;
  signalType: string;
  subject: string;
}

export type Clock = () => Date;

export class InsightStore {
  readonly db: DatabaseSync;
  readonly dbPath: string;
  private closed = false;
  private readonly lock: InsightWriterLock | null;
  private readonly clock: Clock;

  constructor(dbPath: string, options: { skipWriterLock?: boolean; clock?: Clock } = {}) {
    this.dbPath = dbPath;
    this.clock = options.clock ?? (() => new Date());
    this.lock = options.skipWriterLock === true ? null : new InsightWriterLock(`${dbPath}.writer.lock`);
    this.lock?.acquire();
    try {
      this.db = openInsightDatabase(dbPath);
    } catch (cause) {
      this.lock?.release();
      throw cause;
    }
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.lock?.release();
    this.closed = true;
  }

  nowIso(): string {
    return this.clock().toISOString();
  }

  transaction<T>(fn: () => T): T {
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
  }

  getCheckpoint(
    projectId: string,
    streamEpoch: number,
    extractorVersion: string = EXTRACTOR_VERSION,
  ): ConsumerCheckpoint | null {
    const row = this.db
      .prepare(
        `SELECT * FROM consumer_checkpoints
         WHERE project_id = ? AND stream_epoch = ? AND extractor_version = ?`,
      )
      .get(projectId, streamEpoch, extractorVersion) as Row | undefined;
    return row ? rowToCheckpoint(row) : null;
  }

  listCheckpoints(projectId: string, extractorVersion: string = EXTRACTOR_VERSION): ConsumerCheckpoint[] {
    const rows = this.db
      .prepare(`SELECT * FROM consumer_checkpoints WHERE project_id = ? AND extractor_version = ?`)
      .all(projectId, extractorVersion) as Row[];
    return rows.map((row) => rowToCheckpoint(row));
  }

  countSignals(projectId: string, streamEpoch?: number): number {
    if (streamEpoch === undefined) {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM signal_inbox WHERE project_id = ?').get(projectId) as {
        n: number;
      };
      return Number(row.n);
    }
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM signal_inbox WHERE project_id = ? AND stream_epoch = ?')
      .get(projectId, streamEpoch) as { n: number };
    return Number(row.n);
  }

  listSignalIds(projectId: string): string[] {
    const rows = this.db
      .prepare('SELECT signal_id AS id FROM signal_inbox WHERE project_id = ? ORDER BY append_seq ASC, signal_id ASC')
      .all(projectId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  listInterruptions(projectId: string): SourceInterruption[] {
    const rows = this.db
      .prepare('SELECT * FROM source_interruptions WHERE project_id = ? ORDER BY detected_at ASC, id ASC')
      .all(projectId) as Row[];
    return rows.map((row) => rowToInterruption(row));
  }

  recordInterruption(input: {
    projectId: string;
    streamEpoch: number;
    interruptionType: string;
    lastSafeCursor: number;
  }): void {
    const open = this.db
      .prepare(
        `SELECT id FROM source_interruptions
         WHERE project_id = ? AND stream_epoch = ? AND interruption_type = ? AND resolution_status = 'OPEN'`,
      )
      .get(input.projectId, input.streamEpoch, input.interruptionType) as { id: number } | undefined;
    if (open !== undefined) return;
    this.db
      .prepare(
        `INSERT INTO source_interruptions
         (project_id, stream_epoch, interruption_type, last_safe_cursor, detected_at, resolution_status)
         VALUES (?, ?, ?, ?, ?, 'OPEN')`,
      )
      .run(input.projectId, input.streamEpoch, input.interruptionType, input.lastSafeCursor, this.nowIso());
  }

  freezeCheckpoint(projectId: string, streamEpoch: number, extractorVersion: string = EXTRACTOR_VERSION): void {
    const now = this.nowIso();
    const existing = this.getCheckpoint(projectId, streamEpoch, extractorVersion);
    if (existing === null) {
      this.db
        .prepare(
          `INSERT INTO consumer_checkpoints
           (project_id, stream_epoch, extractor_version, after_seq, revision, status, updated_at)
           VALUES (?, ?, ?, 0, 0, 'FROZEN', ?)`,
        )
        .run(projectId, streamEpoch, extractorVersion, now);
      return;
    }
    this.db
      .prepare(
        `UPDATE consumer_checkpoints SET status = 'FROZEN', updated_at = ?
         WHERE project_id = ? AND stream_epoch = ? AND extractor_version = ?`,
      )
      .run(now, projectId, streamEpoch, extractorVersion);
  }

  freezeOtherEpochs(projectId: string, liveEpoch: number, extractorVersion: string = EXTRACTOR_VERSION): number {
    const rows = this.listCheckpoints(projectId, extractorVersion).filter(
      (item) => item.status === 'ACTIVE' && item.streamEpoch !== liveEpoch,
    );
    for (const row of rows) {
      this.freezeCheckpoint(projectId, row.streamEpoch, extractorVersion);
      this.recordInterruption({
        projectId,
        streamEpoch: row.streamEpoch,
        interruptionType: 'STREAM_EPOCH_MISMATCH',
        lastSafeCursor: row.afterSeq,
      });
    }
    return rows.length;
  }

  purgeInbox(projectId: string): number {
    const result = this.db.prepare('DELETE FROM signal_inbox WHERE project_id = ?').run(projectId);
    return Number(result.changes);
  }

  /** Explicit P1 data removal for a project. Does not touch observer.sqlite. */
  purgeProject(projectId: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM signal_inbox WHERE project_id = ?').run(projectId);
      this.db.prepare('DELETE FROM consumer_checkpoints WHERE project_id = ?').run(projectId);
      this.db.prepare('DELETE FROM source_interruptions WHERE project_id = ?').run(projectId);
    });
  }

  commitSignalBatch(input: {
    projectId: string;
    streamEpoch: number;
    extractorVersion?: string;
    expectedRevision: number;
    batch: SignalBatch;
    fault?: CommitFault;
  }): { inserted: number; duplicates: number; checkpoint: ConsumerCheckpoint } {
    if (input.batch.outcome !== 'OK' && input.batch.outcome !== 'NO_SIGNAL') {
      throw new InsightError('INVALID_BATCH', `cannot commit batch outcome ${input.batch.outcome}`);
    }
    if (input.batch.proposedCursor.streamEpoch !== input.streamEpoch) {
      throw new InsightError('INVALID_BATCH', 'proposed cursor epoch does not match commit epoch');
    }
    const extractorVersion = input.extractorVersion ?? EXTRACTOR_VERSION;
    return this.transaction(() => {
      const existing = this.getCheckpoint(input.projectId, input.streamEpoch, extractorVersion);
      if (existing !== null && existing.status === 'FROZEN') {
        throw new InsightError('FROZEN', `checkpoint is frozen for ${input.projectId} epoch ${input.streamEpoch}`);
      }
      if (existing !== null && existing.revision !== input.expectedRevision) {
        throw new InsightError('CAS_CONFLICT', 'checkpoint revision moved concurrently');
      }
      if (existing !== null && input.batch.proposedCursor.afterSeq < existing.afterSeq) {
        throw new InsightError('CURSOR_REGRESS', 'checkpoint after_seq cannot move backwards');
      }
      let inserted = 0;
      let duplicates = 0;
      for (const signal of input.batch.signals) {
        const result = this.insertSignal(signal, extractorVersion);
        if (result === 'inserted') inserted += 1;
        else duplicates += 1;
      }
      injectFault(input.fault, 'after-signals');
      const now = this.nowIso();
      if (existing === null) {
        this.db
          .prepare(
            `INSERT INTO consumer_checkpoints
             (project_id, stream_epoch, extractor_version, after_seq, revision, status, updated_at)
             VALUES (?, ?, ?, ?, 1, 'ACTIVE', ?)`,
          )
          .run(input.projectId, input.streamEpoch, extractorVersion, input.batch.proposedCursor.afterSeq, now);
      } else if (input.batch.proposedCursor.afterSeq > existing.afterSeq) {
        const updated = this.db
          .prepare(
            `UPDATE consumer_checkpoints
             SET after_seq = ?, revision = revision + 1, updated_at = ?
             WHERE project_id = ? AND stream_epoch = ? AND extractor_version = ?
               AND revision = ? AND status = 'ACTIVE'`,
          )
          .run(
            input.batch.proposedCursor.afterSeq,
            now,
            input.projectId,
            input.streamEpoch,
            extractorVersion,
            input.expectedRevision,
          );
        if (Number(updated.changes) !== 1) {
          throw new InsightError('CAS_CONFLICT', 'checkpoint revision moved concurrently');
        }
      }
      injectFault(input.fault, 'after-cursor');
      injectFault(input.fault, 'before-commit');
      const checkpoint = this.getCheckpoint(input.projectId, input.streamEpoch, extractorVersion);
      if (checkpoint === null) throw new InsightError('INTERNAL', 'checkpoint missing after commit');
      return { inserted, duplicates, checkpoint };
    });
  }

  private insertSignal(signal: ExtractedSignal | SignalBatch['signals'][number], extractorVersion: string): 'inserted' | 'duplicate' {
    const streamEpoch = signal.streamEpoch;
    const appendSeq = signal.appendSeq;
    const subject = signal.subject;
    const sourceEventId = signal.sourceEventIds[0];
    if (streamEpoch === undefined || appendSeq === undefined || subject === undefined || sourceEventId === undefined) {
      throw new InsightError('INVALID_BATCH', 'signal is missing identity fields');
    }
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO signal_inbox
         (signal_id, project_id, stream_epoch, source_event_id, append_seq, extractor_version,
          signal_type, subject, payload_json, evidence_refs_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        signal.signalKey,
        signal.projectId,
        streamEpoch,
        sourceEventId,
        appendSeq,
        signal.extractorVersion ?? extractorVersion,
        signal.kind,
        subject,
        JSON.stringify(signal),
        JSON.stringify(signal.evidenceRefs ?? []),
        this.nowIso(),
      );
    return Number(result.changes) === 1 ? 'inserted' : 'duplicate';
  }
}

function injectFault(fault: CommitFault | undefined, at: CommitFault): void {
  if (fault === at) throw new InsightError('INJECTED_FAULT', at);
}

function rowToCheckpoint(row: Row): ConsumerCheckpoint {
  return {
    projectId: String(row['project_id']),
    streamEpoch: Number(row['stream_epoch']),
    extractorVersion: String(row['extractor_version']),
    afterSeq: Number(row['after_seq']),
    revision: Number(row['revision']),
    status: String(row['status']) as CheckpointStatus,
    updatedAt: String(row['updated_at']),
  };
}

function rowToInterruption(row: Row): SourceInterruption {
  return {
    id: Number(row['id']),
    projectId: String(row['project_id']),
    streamEpoch: Number(row['stream_epoch']),
    interruptionType: String(row['interruption_type']),
    lastSafeCursor: Number(row['last_safe_cursor']),
    detectedAt: String(row['detected_at']),
    resolutionStatus: String(row['resolution_status']) as 'OPEN' | 'ACKNOWLEDGED',
  };
}
