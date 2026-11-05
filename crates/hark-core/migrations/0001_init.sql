-- Hark R1 business schema v1.
-- Only tables required by the current Core slice. No memory/FTS/observer tables.

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE authorized_roots (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  dev TEXT NOT NULL,
  ino TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scan_sessions (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL REFERENCES authorized_roots(id),
  status TEXT NOT NULL CHECK (status IN ('completed', 'limited', 'cancelled', 'failed')),
  coverage TEXT NOT NULL CHECK (coverage IN ('full', 'partial')),
  budget_json TEXT NOT NULL,
  limits_hit_json TEXT NOT NULL,
  ignored_json TEXT NOT NULL,
  files_seen INTEGER NOT NULL,
  dirs_seen INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);

CREATE TABLE scan_candidates (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scan_sessions(id),
  relative_path TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('single_root', 'independent_project', 'module_hint')),
  evidence_json TEXT NOT NULL,
  suggested INTEGER NOT NULL CHECK (suggested IN (0, 1)),
  workspace_id TEXT,
  UNIQUE (scan_id, relative_path)
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL REFERENCES authorized_roots(id),
  agent_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL,
  dev TEXT NOT NULL,
  ino TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active')),
  created_at TEXT NOT NULL
);

CREATE TABLE service_grants (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  service TEXT NOT NULL CHECK (service IN ('model', 'search', 'background_model', 'notification')),
  status TEXT NOT NULL CHECK (status IN ('enabled', 'paused', 'revoked', 'disabled')),
  provider TEXT,
  model TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, service)
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
  created_at TEXT NOT NULL
);

CREATE TABLE conversation_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  kind TEXT NOT NULL CHECK (kind IN ('user_message', 'local_scan_card', 'agent_opening_message')),
  generation INTEGER,
  body TEXT NOT NULL,
  presentation TEXT NOT NULL CHECK (presentation IN ('normal', 'expanded', 'folded_evidence')),
  source_ids_json TEXT NOT NULL,
  receipt_id TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX conversation_first_message_idem
  ON conversation_events (workspace_id, generation, kind)
  WHERE kind IN ('local_scan_card', 'agent_opening_message') AND generation IS NOT NULL;

CREATE TABLE onboarding_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  generation INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'workspace_created',
    'reading',
    'waiting_for_model_auth',
    'analyzing',
    'message_ready',
    'presented',
    'cancelled',
    'failed'
  )),
  scan_id TEXT NOT NULL REFERENCES scan_sessions(id),
  structure_scanned INTEGER NOT NULL CHECK (structure_scanned IN (0, 1)),
  selective_read_done INTEGER NOT NULL CHECK (selective_read_done IN (0, 1)),
  model_analyzed INTEGER NOT NULL CHECK (model_analyzed IN (0, 1)),
  opening_presented INTEGER NOT NULL CHECK (opening_presented IN (0, 1)),
  local_card_folded INTEGER NOT NULL CHECK (local_card_folded IN (0, 1)),
  model_status TEXT NOT NULL CHECK (model_status IN (
    'disabled',
    'enabled_awaiting_receipt',
    'unavailable',
    'receipt_rejected',
    'receipt_accepted'
  )),
  error_code TEXT,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, generation)
);

CREATE TABLE source_refs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  relative_path TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_len INTEGER NOT NULL,
  truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
  binary INTEGER NOT NULL CHECK (binary IN (0, 1)),
  excerpt TEXT,
  observed_at TEXT NOT NULL
);

CREATE UNIQUE INDEX source_refs_dedupe
  ON source_refs (workspace_id, relative_path, content_sha256);

CREATE INDEX idx_scan_candidates_scan ON scan_candidates (scan_id);
CREATE INDEX idx_source_refs_workspace ON source_refs (workspace_id);
CREATE INDEX idx_events_workspace ON conversation_events (workspace_id);
CREATE INDEX idx_workspaces_root ON workspaces (root_id);
