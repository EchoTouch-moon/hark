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
  `CREATE UNIQUE INDEX observation_grants_scope ON observation_grants(id, project_id, root_id);
   CREATE TABLE fixture_sources (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL, root_id TEXT NOT NULL, grant_id TEXT NOT NULL,
     epoch INTEGER NOT NULL DEFAULT 0 CHECK(epoch >= 0), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
     UNIQUE(id, project_id),
     FOREIGN KEY(grant_id, project_id, root_id) REFERENCES observation_grants(id, project_id, root_id)
   );
   CREATE TABLE fixture_facts (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_id TEXT NOT NULL, epoch INTEGER NOT NULL CHECK(epoch >= 0),
     dedupe_key TEXT NOT NULL, data_json TEXT NOT NULL,
     UNIQUE(project_id, source_id, epoch, dedupe_key),
     FOREIGN KEY(source_id, project_id) REFERENCES fixture_sources(id, project_id)
   );
   CREATE TRIGGER fixture_facts_no_update BEFORE UPDATE ON fixture_facts BEGIN SELECT RAISE(ABORT,'fixture facts are append-only'); END;
   CREATE TRIGGER fixture_facts_no_delete BEFORE DELETE ON fixture_facts BEGIN SELECT RAISE(ABORT,'fixture facts are append-only'); END;`,
  `CREATE TABLE fixture_project_profiles (
     project_id TEXT PRIMARY KEY REFERENCES projects(id),
     state TEXT NOT NULL CHECK(state IN ('active','deleting','deleted')), created_at TEXT NOT NULL
   );
   CREATE TABLE fixture_opinions (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES fixture_project_profiles(project_id),
     topic_key TEXT NOT NULL, current_revision INTEGER NOT NULL CHECK(current_revision >= 0),
     UNIQUE(project_id, topic_key), UNIQUE(id, project_id)
   );
   CREATE TABLE fixture_opinion_revisions (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL, opinion_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
     data_json TEXT NOT NULL, previous_revision_id TEXT, change_reason TEXT,
     UNIQUE(opinion_id, version), UNIQUE(id, project_id), UNIQUE(id, project_id, opinion_id),
     CHECK((version = 1 AND previous_revision_id IS NULL AND change_reason IS NULL) OR (version > 1 AND previous_revision_id IS NOT NULL AND change_reason IS NOT NULL AND length(trim(change_reason)) > 0)),
     FOREIGN KEY(opinion_id, project_id) REFERENCES fixture_opinions(id, project_id),
     FOREIGN KEY(previous_revision_id, project_id, opinion_id) REFERENCES fixture_opinion_revisions(id, project_id, opinion_id)
   );
   CREATE TABLE fixture_opinion_plans (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision_id TEXT NOT NULL UNIQUE,
     data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json,'$.executable') IS 'false'),
     FOREIGN KEY(revision_id, project_id) REFERENCES fixture_opinion_revisions(id, project_id)
   );
   CREATE TABLE fixture_opinion_feedback (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision_id TEXT NOT NULL, dedupe_key TEXT NOT NULL, data_json TEXT NOT NULL,
     UNIQUE(project_id, dedupe_key), FOREIGN KEY(revision_id, project_id) REFERENCES fixture_opinion_revisions(id, project_id)
   );
   CREATE TRIGGER fixture_revision_no_update BEFORE UPDATE ON fixture_opinion_revisions BEGIN SELECT RAISE(ABORT,'fixture revisions are append-only'); END;
   CREATE TRIGGER fixture_revision_no_delete BEFORE DELETE ON fixture_opinion_revisions BEGIN SELECT RAISE(ABORT,'fixture revisions are append-only'); END;
   CREATE TRIGGER fixture_plan_no_update BEFORE UPDATE ON fixture_opinion_plans BEGIN SELECT RAISE(ABORT,'fixture plans are append-only'); END;
   CREATE TRIGGER fixture_plan_no_delete BEFORE DELETE ON fixture_opinion_plans BEGIN SELECT RAISE(ABORT,'fixture plans are append-only'); END;
   CREATE TRIGGER fixture_feedback_no_update BEFORE UPDATE ON fixture_opinion_feedback BEGIN SELECT RAISE(ABORT,'fixture feedback is append-only'); END;
   CREATE TRIGGER fixture_feedback_no_delete BEFORE DELETE ON fixture_opinion_feedback BEGIN SELECT RAISE(ABORT,'fixture feedback is append-only'); END;`,
  `CREATE TABLE fixture_decisions (
     id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES fixture_project_profiles(project_id),
     root_id TEXT NOT NULL, grant_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
     statement TEXT NOT NULL, recorded_at TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','withdrawn')),
     PRIMARY KEY(id, project_id, revision),
     FOREIGN KEY(grant_id, project_id, root_id) REFERENCES observation_grants(id, project_id, root_id)
   );
   CREATE UNIQUE INDEX fixture_decisions_single_active ON fixture_decisions(id, project_id) WHERE status = 'active';
   CREATE TRIGGER fixture_decisions_no_delete BEFORE DELETE ON fixture_decisions BEGIN SELECT RAISE(ABORT,'fixture decisions are append-only'); END;
   CREATE TRIGGER fixture_decisions_status_only BEFORE UPDATE ON fixture_decisions
   WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.root_id IS NOT OLD.root_id OR NEW.grant_id IS NOT OLD.grant_id OR NEW.revision IS NOT OLD.revision OR NEW.statement IS NOT OLD.statement OR NEW.recorded_at IS NOT OLD.recorded_at OR OLD.status IS NOT 'active' OR NEW.status NOT IN ('superseded','withdrawn')
   BEGIN SELECT RAISE(ABORT,'fixture decision content is immutable'); END;`,
  `CREATE TABLE fixture_feedback_versions (
     feedback_id TEXT PRIMARY KEY REFERENCES fixture_opinion_feedback(id), version TEXT NOT NULL CHECK(version = '2')
   );
   CREATE TRIGGER fixture_feedback_version_no_update BEFORE UPDATE ON fixture_feedback_versions BEGIN SELECT RAISE(ABORT,'fixture feedback versions are append-only'); END;
   CREATE TRIGGER fixture_feedback_version_no_delete BEFORE DELETE ON fixture_feedback_versions BEGIN SELECT RAISE(ABORT,'fixture feedback versions are append-only'); END;`,
  `CREATE TABLE fixture_roots (
     root_id TEXT NOT NULL, root_epoch INTEGER NOT NULL CHECK(root_epoch > 0),
     owner TEXT NOT NULL CHECK(owner = 'hearth.fixture.internal'),
     binding_dev TEXT NOT NULL, binding_ino TEXT NOT NULL, locator TEXT NOT NULL,
     enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), paused INTEGER NOT NULL CHECK(paused IN (0,1)),
     expires_at TEXT NOT NULL, revoked_at TEXT, record_version INTEGER NOT NULL CHECK(record_version > 0),
     PRIMARY KEY(root_id, root_epoch)
   );
   CREATE TABLE fixture_discovery_candidates (
     candidate_id TEXT PRIMARY KEY, root_id TEXT NOT NULL, root_epoch INTEGER NOT NULL,
     relative_path TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('git_marker','non_git','unknown')),
     attribution TEXT NOT NULL CHECK(attribution IN ('confirmed','needs_confirmation')),
     inspected_at TEXT NOT NULL, binding_dev TEXT NOT NULL, binding_ino TEXT NOT NULL,
     status TEXT NOT NULL CHECK(status IN ('active','invalid')),
     UNIQUE(root_id, root_epoch, relative_path, binding_dev, binding_ino),
     FOREIGN KEY(root_id, root_epoch) REFERENCES fixture_roots(root_id, root_epoch)
   );
   CREATE TRIGGER fixture_roots_no_delete BEFORE DELETE ON fixture_roots BEGIN SELECT RAISE(ABORT,'fixture roots are append-only'); END;
   CREATE TRIGGER fixture_roots_identity_immutable BEFORE UPDATE ON fixture_roots
   WHEN NEW.root_id IS NOT OLD.root_id OR NEW.root_epoch IS NOT OLD.root_epoch OR NEW.owner IS NOT OLD.owner
     OR NEW.binding_dev IS NOT OLD.binding_dev OR NEW.binding_ino IS NOT OLD.binding_ino OR NEW.locator IS NOT OLD.locator
   BEGIN SELECT RAISE(ABORT,'fixture root identity is immutable'); END;
   CREATE TRIGGER fixture_candidates_no_delete BEFORE DELETE ON fixture_discovery_candidates BEGIN SELECT RAISE(ABORT,'fixture discovery candidates are append-only'); END;
   CREATE TRIGGER fixture_candidates_identity_immutable BEFORE UPDATE ON fixture_discovery_candidates
   WHEN NEW.candidate_id IS NOT OLD.candidate_id OR NEW.root_id IS NOT OLD.root_id OR NEW.root_epoch IS NOT OLD.root_epoch
     OR NEW.relative_path IS NOT OLD.relative_path OR NEW.binding_dev IS NOT OLD.binding_dev OR NEW.binding_ino IS NOT OLD.binding_ino
     OR OLD.status = 'invalid'
   BEGIN SELECT RAISE(ABORT,'fixture discovery candidate identity is immutable'); END;`,
  `DROP TRIGGER fixture_candidates_identity_immutable;
   CREATE TRIGGER fixture_candidates_identity_immutable BEFORE UPDATE ON fixture_discovery_candidates
   WHEN NEW.candidate_id IS NOT OLD.candidate_id OR NEW.root_id IS NOT OLD.root_id OR NEW.root_epoch IS NOT OLD.root_epoch
     OR NEW.relative_path IS NOT OLD.relative_path OR NEW.binding_dev IS NOT OLD.binding_dev OR NEW.binding_ino IS NOT OLD.binding_ino
   BEGIN SELECT RAISE(ABORT,'fixture discovery candidate identity is immutable'); END;
   CREATE TRIGGER fixture_roots_revoke_irreversible BEFORE UPDATE ON fixture_roots
   WHEN OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NULL OR NEW.enabled = 1)
   BEGIN SELECT RAISE(ABORT,'fixture root revocation is irreversible'); END;
   CREATE TABLE fixture_candidate_grants (
     candidate_id TEXT PRIMARY KEY REFERENCES fixture_discovery_candidates(candidate_id),
     project_id TEXT NOT NULL, grant_id TEXT NOT NULL, root_id TEXT NOT NULL,
     FOREIGN KEY(grant_id, project_id, root_id) REFERENCES observation_grants(id, project_id, root_id)
   );`,
  `CREATE TABLE model_conversations (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), created_at TEXT NOT NULL
   );
   CREATE TABLE model_messages (
     id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES model_conversations(id), project_id TEXT NOT NULL,
     role TEXT NOT NULL CHECK(role IN ('user','assistant')), body_json TEXT NOT NULL, created_at TEXT NOT NULL, run_id TEXT,
     UNIQUE(conversation_id, role, run_id)
   );
   CREATE TABLE model_previews (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES model_conversations(id),
     request_key TEXT NOT NULL, question TEXT NOT NULL, payload_json TEXT NOT NULL, payload_digest TEXT NOT NULL,
     provider_id TEXT NOT NULL, model_id TEXT NOT NULL, limits_json TEXT NOT NULL, sources_json TEXT NOT NULL,
     context_stamp TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
     status TEXT NOT NULL CHECK(status IN ('open','consumed','cancelled','superseded','expired')),
     UNIQUE(project_id, request_key)
   );
   CREATE TABLE model_runs (
     id TEXT PRIMARY KEY, preview_id TEXT NOT NULL UNIQUE REFERENCES model_previews(id), project_id TEXT NOT NULL,
     conversation_id TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
     state TEXT NOT NULL CHECK(state IN ('running','succeeded','failed','cancelled','unknown')),
     error_code TEXT, result_json TEXT, usage_json TEXT, started_at TEXT NOT NULL, finished_at TEXT
   );
   CREATE TABLE model_outbound_approvals (
     id TEXT PRIMARY KEY, preview_id TEXT NOT NULL UNIQUE REFERENCES model_previews(id), project_id TEXT NOT NULL,
     principal_id TEXT NOT NULL, payload_digest TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
     granted_at TEXT NOT NULL, consumed_at TEXT NOT NULL
   );
   CREATE TABLE model_opinion_links (
     run_id TEXT PRIMARY KEY REFERENCES model_runs(id), project_id TEXT NOT NULL, opinion_id TEXT NOT NULL, created_at TEXT NOT NULL
   );
   CREATE TRIGGER model_messages_no_update BEFORE UPDATE ON model_messages BEGIN SELECT RAISE(ABORT,'model messages are append-only'); END;
   CREATE TRIGGER model_messages_no_delete BEFORE DELETE ON model_messages BEGIN SELECT RAISE(ABORT,'model messages are append-only'); END;
   CREATE TRIGGER model_previews_no_delete BEFORE DELETE ON model_previews BEGIN SELECT RAISE(ABORT,'model previews are append-only'); END;
   CREATE TRIGGER model_previews_frozen BEFORE UPDATE ON model_previews
   WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.conversation_id IS NOT OLD.conversation_id
     OR NEW.request_key IS NOT OLD.request_key OR NEW.question IS NOT OLD.question OR NEW.payload_json IS NOT OLD.payload_json
     OR NEW.payload_digest IS NOT OLD.payload_digest OR NEW.provider_id IS NOT OLD.provider_id OR NEW.model_id IS NOT OLD.model_id
     OR NEW.limits_json IS NOT OLD.limits_json OR NEW.sources_json IS NOT OLD.sources_json OR NEW.context_stamp IS NOT OLD.context_stamp
     OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.status <> 'open'
   BEGIN SELECT RAISE(ABORT,'model preview is frozen'); END;
   CREATE TRIGGER model_runs_no_delete BEFORE DELETE ON model_runs BEGIN SELECT RAISE(ABORT,'model runs are append-only'); END;
   CREATE TRIGGER model_runs_frozen BEFORE UPDATE ON model_runs
   WHEN NEW.id IS NOT OLD.id OR NEW.preview_id IS NOT OLD.preview_id OR NEW.project_id IS NOT OLD.project_id
     OR NEW.conversation_id IS NOT OLD.conversation_id OR NEW.provider_id IS NOT OLD.provider_id OR NEW.model_id IS NOT OLD.model_id
     OR NEW.started_at IS NOT OLD.started_at OR OLD.state <> 'running'
   BEGIN SELECT RAISE(ABORT,'model run identity is immutable'); END;
   CREATE TRIGGER model_approvals_no_update BEFORE UPDATE ON model_outbound_approvals BEGIN SELECT RAISE(ABORT,'model approvals are immutable'); END;
   CREATE TRIGGER model_approvals_no_delete BEFORE DELETE ON model_outbound_approvals BEGIN SELECT RAISE(ABORT,'model approvals are append-only'); END;`,
] as const;

export const SCHEMA_VERSION = migrations.length;

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

/** Preserve uncertainty after a crash; recovery never starts or repeats work. */
export function recoverInterruptedRun(db: DatabaseSync, id: string): RunState {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT state FROM runs WHERE id = ?').get(id);
    if (!row) throw new Error('Run not found');
    const state = RunState.parse(row.state);
    const recovered = state === 'executing' ? 'pending_verification' : state;
    if (recovered !== state) {
      assertRunTransition(state, recovered);
      db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(recovered, id);
    }
    db.exec('COMMIT');
    return recovered;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
