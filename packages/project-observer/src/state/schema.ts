import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface ObserverMigration {
  version: number;
  name: string;
  up: readonly string[] | ((db: DatabaseSync) => void);
}

export const OBSERVER_SCHEMA_VERSION = 3;

export const OBSERVER_MIGRATIONS: readonly ObserverMigration[] = [
  {
    version: 1,
    name: 'observer-v1',
    up: [
      `CREATE TABLE observer_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        canonical_path TEXT NOT NULL UNIQUE,
        git_identity TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        scan_interval_ms INTEGER NOT NULL DEFAULT 300000,
        debounce_ms INTEGER NOT NULL DEFAULT 1500
      )`,
      `CREATE TABLE observation_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        FOREIGN KEY (project_id) REFERENCES observer_projects(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_obs_runs_project ON observation_runs(project_id, started_at DESC)`,
      `CREATE TABLE observer_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        head_sha TEXT,
        branch TEXT,
        detached INTEGER NOT NULL DEFAULT 0,
        unborn INTEGER NOT NULL DEFAULT 0,
        worktree_json TEXT NOT NULL,
        test_json TEXT NOT NULL,
        accessibility TEXT NOT NULL,
        git_identity TEXT,
        FOREIGN KEY (project_id) REFERENCES observer_projects(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_obs_snap_project ON observer_snapshots(project_id, observed_at DESC)`,
      `CREATE TABLE observer_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        before_snapshot_id TEXT,
        after_snapshot_id TEXT,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES observer_projects(id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES observation_runs(id)
      )`,
      `CREATE INDEX idx_obs_evt_project ON observer_events(project_id, occurred_at DESC, id DESC)`,
      `CREATE TABLE report_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        format TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (project_id) REFERENCES observer_projects(id) ON DELETE CASCADE,
        UNIQUE(project_id, relative_path)
      )`,
      `CREATE TABLE observer_health (
        project_id TEXT PRIMARY KEY,
        last_success_at TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        watch_status TEXT NOT NULL,
        collection_status TEXT NOT NULL,
        last_reconcile_at TEXT,
        last_observed_at TEXT,
        last_snapshot_id TEXT,
        FOREIGN KEY (project_id) REFERENCES observer_projects(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 2,
    name: 'observer-v2-revision-fk',
    up: [
      `ALTER TABLE observer_health ADD COLUMN current_revision INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE observer_health ADD COLUMN last_gap_at TEXT`,
      `CREATE TABLE observer_events_v2 (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        before_snapshot_id TEXT,
        after_snapshot_id TEXT,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES observer_projects(id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES observation_runs(id),
        FOREIGN KEY (before_snapshot_id) REFERENCES observer_snapshots(id),
        FOREIGN KEY (after_snapshot_id) REFERENCES observer_snapshots(id)
      )`,
      `INSERT INTO observer_events_v2 SELECT * FROM observer_events`,
      `DROP TABLE observer_events`,
      `ALTER TABLE observer_events_v2 RENAME TO observer_events`,
      `CREATE INDEX idx_obs_evt_project ON observer_events(project_id, occurred_at DESC, id DESC)`,
    ],
  },
  {
    version: 3,
    name: 'observer-v3-append-seq',
    up: migrateObserverV3,
  },
];

/**
 * Assigns durable append_seq from a dedicated counter, never from MAX(remaining).
 * Existing v2 rows are numbered by current rowid ASC. That reconstructed order is
 * not the original insert order (VACUUM / v2 rebuild may have changed rowids).
 */
function migrateObserverV3(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE observer_meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE observer_event_stream (
      project_id TEXT PRIMARY KEY,
      epoch INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      retired_at TEXT,
      last_seq INTEGER
    )
  `);
  db.exec(`
    CREATE TABLE observer_events_v3 (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      before_snapshot_id TEXT,
      after_snapshot_id TEXT,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      append_seq INTEGER NOT NULL UNIQUE,
      FOREIGN KEY (project_id) REFERENCES observer_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES observation_runs(id),
      FOREIGN KEY (before_snapshot_id) REFERENCES observer_snapshots(id),
      FOREIGN KEY (after_snapshot_id) REFERENCES observer_snapshots(id)
    )
  `);

  const legacy = db.prepare('SELECT * FROM observer_events ORDER BY rowid ASC').all() as Array<
    Record<string, unknown>
  >;
  const insert = db.prepare(
    `INSERT INTO observer_events_v3 (
       id, project_id, run_id, type, before_snapshot_id, after_snapshot_id,
       occurred_at, payload_json, evidence_json, append_seq
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let seq = 0;
  for (const row of legacy) {
    seq += 1;
    insert.run(
      sqlText(row['id']),
      sqlText(row['project_id']),
      sqlText(row['run_id']),
      sqlText(row['type']),
      sqlTextOrNull(row['before_snapshot_id']),
      sqlTextOrNull(row['after_snapshot_id']),
      sqlText(row['occurred_at']),
      sqlText(row['payload_json']),
      sqlText(row['evidence_json']),
      seq,
    );
  }

  db.exec('DROP TABLE observer_events');
  db.exec('ALTER TABLE observer_events_v3 RENAME TO observer_events');
  db.exec('CREATE INDEX idx_obs_evt_project ON observer_events(project_id, occurred_at DESC, id DESC)');
  db.exec('CREATE INDEX idx_obs_evt_forward ON observer_events(project_id, append_seq ASC)');

  db.prepare(`INSERT INTO observer_meta (key, value) VALUES ('append_seq', ?)`).run(seq);
  db.prepare(`INSERT INTO observer_meta (key, value) VALUES ('legacy_order_reconstructed', ?)`).run(
    legacy.length > 0 ? 1 : 0,
  );

  const projects = db.prepare('SELECT id, created_at FROM observer_projects').all() as Array<{
    id: string;
    created_at: string;
  }>;
  const stream = db.prepare(
    `INSERT INTO observer_event_stream (project_id, epoch, created_at, retired_at, last_seq)
     VALUES (?, 1, ?, NULL, NULL)`,
  );
  for (const project of projects) {
    stream.run(project.id, project.created_at);
  }
}

function sqlText(value: unknown): string {
  return String(value);
}

function sqlTextOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function openObserverDatabase(
  dbPath: string,
  options: { untilVersion?: number } = {},
): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
  const versionRow = db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
  const walSafe = sqliteAtLeast(versionRow.v, '3.51.3');
  db.exec(walSafe ? 'PRAGMA journal_mode = WAL' : 'PRAGMA journal_mode = DELETE');
  migrateObserver(db, options);
  return db;
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

export function migrateObserver(
  db: DatabaseSync,
  options: { untilVersion?: number; migrations?: readonly ObserverMigration[] } = {},
): { applied: number[]; currentVersion: number } {
  const migrations = options.migrations ?? OBSERVER_MIGRATIONS;
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
        // keep original error
      }
      throw new Error(`observer migration v${migration.version} failed: ${String(cause)}`, { cause });
    }
  }
  const after = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  return { applied, currentVersion: after?.v ?? 0 };
}
