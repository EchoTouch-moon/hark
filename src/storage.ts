import { DatabaseSync } from 'node:sqlite';
import { assertRunTransition } from './state-machine.js';
import { RunState } from './contracts.js';
import { evaluateAdmission, type PolicyDecision } from './policy.js';

// SQL is deliberately local and versioned; never use schema data as SQL.
const migrations = [
  `CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '');
   CREATE TABLE sources (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), scope TEXT NOT NULL, type TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), UNIQUE(id, project_id));
   CREATE TABLE observation_grants (id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), root_id TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), paused INTEGER NOT NULL CHECK(paused IN (0,1)), expires_at TEXT NOT NULL, revoked_at TEXT);
   CREATE TABLE events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), source_id TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, data_json TEXT NOT NULL, FOREIGN KEY(source_id, project_id) REFERENCES sources(id, project_id));
   CREATE TABLE candidates (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), suppression_key TEXT NOT NULL, status TEXT NOT NULL, data_json TEXT NOT NULL);
   CREATE TABLE cards (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id), status TEXT NOT NULL, data_json TEXT NOT NULL);
   CREATE TABLE runs (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), action_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(state IN ('queued','awaiting_approval','executing','verifying','completed','pending_verification','failed','blocked','cancelled')));
   CREATE TABLE run_steps (run_id TEXT NOT NULL REFERENCES runs(id), sequence INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY(run_id,sequence));
   CREATE TABLE evidence (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), source_ref TEXT NOT NULL, sha256 TEXT NOT NULL);
   CREATE TABLE approvals (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), principal_id TEXT NOT NULL, action_digest TEXT NOT NULL, target_digest TEXT NOT NULL, risk TEXT NOT NULL CHECK(risk IN ('L0','L1','L2','L3')), authorized_capabilities_json TEXT NOT NULL, granted_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE feedback (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data_json TEXT NOT NULL);
   CREATE TABLE audit_log (id TEXT PRIMARY KEY, at TEXT NOT NULL, event_type TEXT NOT NULL, actor TEXT NOT NULL, object_id TEXT NOT NULL, sanitized_details_json TEXT NOT NULL);
   CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'audit log is append-only'); END;
   CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'audit log is append-only'); END;`,
] as const;

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    migrate(db);
    return db;
  } catch (error) { db.close(); throw error; }
}

export function migrate(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    const versions = rows.map(row => Number(row.version));
    if (versions.some((version, index) => version !== index + 1 || version > migrations.length)) throw new Error('Unknown or non-contiguous database migration');
    for (let index = versions.length; index < migrations.length; index++) {
      db.exec(migrations[index]!);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(index + 1, new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/** Re-read the current grant for each check; filesystem containment is a separate future boundary. */
export function checkStoredObservation(db: DatabaseSync, grantId: string, request: unknown, now: Date = new Date()): PolicyDecision {
  const row = db.prepare('SELECT id, principal_id, project_id, root_id, enabled, paused, expires_at, revoked_at FROM observation_grants WHERE id = ?').get(grantId);
  if (!row) return { allowed: false, reason: 'missing_or_invalid_grant' };
  return evaluateAdmission(request, {
    id: row.id, principalId: row.principal_id, projectId: row.project_id, rootId: row.root_id,
    enabled: row.enabled === 1, paused: row.paused === 1, expiresAt: row.expires_at, revokedAt: row.revoked_at,
  }, now);
}

/** Transitions are atomic. Completion remains closed until an independent verifier exists. */
export function transitionRun(db: DatabaseSync, id: string, next: unknown): void {
  const target = RunState.parse(next);
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT state FROM runs WHERE id = ?').get(id);
    if (!row) throw new Error('Run not found');
    if (target === 'executing') throw new Error('Execution admission not implemented');
    if (target === 'completed') throw new Error('Verifier not implemented');
    assertRunTransition(row.state, target);
    db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(target, id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
