import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export interface Migration {
  version: number;
  name: string;
  up: string[];
}

/**
 * Explicit versioned migrations (docs/04). Each runs inside a transaction;
 * applied versions are recorded in schema_version. WAL + busy_timeout +
 * foreign_keys=ON are enforced on every connection.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'core-v1',
    up: [
      `CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'demo'
      )`,
      `CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        source_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        expires_at TEXT,
        summary TEXT NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        sensitivity TEXT NOT NULL,
        provenance TEXT NOT NULL,
        payload_ref TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        golden_action TEXT,
        golden_useful INTEGER
      )`,
      `CREATE INDEX idx_events_project ON events(project_id, observed_at DESC)`,
      `CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        event_ids_json TEXT NOT NULL,
        title TEXT NOT NULL,
        why_now TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        score REAL NOT NULL,
        confidence REAL NOT NULL,
        risk TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        suppression_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL
      )`,
      `CREATE TABLE cards (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL,
        why_now TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL,
        snoozed_until TEXT,
        user_feedback TEXT
      )`,
      `CREATE INDEX idx_cards_status ON cards(status, created_at DESC)`,
      `CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES cards(id),
        action_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        result_artifact_refs_json TEXT NOT NULL DEFAULT '[]',
        verification_verdict TEXT,
        failure_class TEXT,
        action_snapshot_json TEXT NOT NULL
      )`,
      `CREATE INDEX idx_runs_state ON runs(state)`,
      `CREATE TABLE run_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id),
        sequence INTEGER NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        detail TEXT,
        UNIQUE(run_id, sequence)
      )`,
      `CREATE TABLE evidence (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id),
        source_ref_json TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        kind TEXT NOT NULL,
        artifact_path TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        card_id TEXT NOT NULL REFERENCES cards(id),
        action_digest TEXT NOT NULL,
        target_digest TEXT NOT NULL,
        risk TEXT NOT NULL,
        authorized_capabilities_json TEXT NOT NULL DEFAULT '[]',
        expires_at TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        consumed_at TEXT
      )`,
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      )`,
      `CREATE TABLE feedback (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES cards(id),
        kind TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        run_id TEXT,
        adapter TEXT NOT NULL DEFAULT 'mock',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_chat_session ON chat_messages(session_id, created_at)`,
      `CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        object_id TEXT NOT NULL,
        sanitized_details_json TEXT NOT NULL DEFAULT '{}'
      )`,
      `CREATE INDEX idx_audit_object ON audit_log(object_id)`,
    ],
  },
];

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** Applies pending migrations; safe to call repeatedly (records versions). */
export function migrate(db: DatabaseSync): { applied: number[]; currentVersion: number } {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  const current = row?.v ?? 0;
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const tx = db.exec.bind(db);
    try {
      tx('BEGIN');
      for (const stmt of m.up) db.exec(stmt);
      db
        .prepare('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, new Date().toISOString());
      tx('COMMIT');
      applied.push(m.version);
    } catch (err) {
      try {
        tx('ROLLBACK');
      } catch (rollbackErr) {
        throw new Error(
          `migration v${m.version} (${m.name}) failed and rollback failed: ${String(rollbackErr)}`,
          { cause: rollbackErr },
        );
      }
      throw new Error(`migration v${m.version} (${m.name}) failed: ${String(err)}`, { cause: err });
    }
  }
  const cur = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  return { applied, currentVersion: cur?.v ?? 0 };
}
