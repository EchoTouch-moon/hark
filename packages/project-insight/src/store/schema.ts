import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { InsightError } from '../errors.js';

export interface InsightMigration {
  version: number;
  name: string;
  up: readonly string[] | ((db: DatabaseSync) => void);
}

export const INSIGHT_SCHEMA_VERSION = 1;

export const INSIGHT_MIGRATIONS: readonly InsightMigration[] = [
  {
    version: 1,
    name: 'insight-v1-inbox-checkpoint',
    up: [
      `CREATE TABLE signal_inbox (
        signal_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        stream_epoch INTEGER NOT NULL,
        source_event_id TEXT NOT NULL,
        append_seq INTEGER NOT NULL,
        extractor_version TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (project_id, stream_epoch, extractor_version, source_event_id, signal_type, subject)
      )`,
      `CREATE INDEX idx_inbox_project_seq ON signal_inbox(project_id, stream_epoch, append_seq)`,
      `CREATE TABLE consumer_checkpoints (
        project_id TEXT NOT NULL,
        stream_epoch INTEGER NOT NULL,
        extractor_version TEXT NOT NULL,
        after_seq INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, stream_epoch, extractor_version)
      )`,
      `CREATE TABLE source_interruptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        stream_epoch INTEGER NOT NULL,
        interruption_type TEXT NOT NULL,
        last_safe_cursor INTEGER NOT NULL,
        detected_at TEXT NOT NULL,
        resolution_status TEXT NOT NULL
      )`,
      `CREATE INDEX idx_interrupt_open ON source_interruptions(project_id, interruption_type, resolution_status)`,
    ],
  },
];

export function defaultInsightDbPath(repoRoot: string): string {
  return process.env['HEARTH_INSIGHT_DB'] ?? path.join(repoRoot, 'data', 'insights.sqlite');
}

export function sqliteAtLeast(actual: string, minimum: string): boolean {
  const a = actual.split('.').map((part) => Number.parseInt(part, 10));
  const m = minimum.split('.').map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < 3; i += 1) {
    const av = a[i] ?? 0;
    const mv = m[i] ?? 0;
    if (av > mv) return true;
    if (av < mv) return false;
  }
  return true;
}

export function openInsightDatabase(
  dbPath: string,
  options: { untilVersion?: number; migrations?: readonly InsightMigration[] } = {},
): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath);
  } catch (cause) {
    throw new InsightError('SOURCE_UNREADABLE', `unable to open insight database: ${String(cause)}`, { cause });
  }
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA synchronous = NORMAL');
    const versionRow = db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
    const walSafe = sqliteAtLeast(versionRow.v, '3.51.3');
    db.exec(walSafe ? 'PRAGMA journal_mode = WAL' : 'PRAGMA journal_mode = DELETE');
    migrateInsight(db, options);
    return db;
  } catch (cause) {
    try {
      db.close();
    } catch {
      // keep original
    }
    if (cause instanceof InsightError) throw cause;
    throw new InsightError('SOURCE_UNREADABLE', `insight database is not usable: ${String(cause)}`, { cause });
  }
}

export function migrateInsight(
  db: DatabaseSync,
  options: { untilVersion?: number; migrations?: readonly InsightMigration[] } = {},
): { applied: number[]; currentVersion: number } {
  const migrations = options.migrations ?? INSIGHT_MIGRATIONS;
  const untilVersion = options.untilVersion ?? Number.POSITIVE_INFINITY;
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  const current = row?.v ?? 0;
  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    if (migration.version > untilVersion) continue;
    try {
      db.exec('BEGIN');
      if (typeof migration.up === 'function') {
        migration.up(db);
      } else {
        for (const statement of migration.up) db.exec(statement);
      }
      db.prepare('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      applied.push(migration.version);
    } catch (cause) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // keep original
      }
      throw new InsightError(
        'MIGRATION_FAILED',
        `insight migration v${migration.version} failed: ${String(cause)}`,
        { cause },
      );
    }
  }
  const after = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  return { applied, currentVersion: after?.v ?? 0 };
}
