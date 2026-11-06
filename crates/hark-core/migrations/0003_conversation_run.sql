-- Hark R1 schema v3: ordinary conversation runs.
-- Does not rewrite 0001_init.sql or 0002_opening_run.sql.
-- SQLite cannot ALTER a CHECK. Rust inspects columns, outbound/inbound FKs,
-- indexes, triggers, and views before executing this file, and rolls the
-- transaction back if the copy count or first-message index does not survive.
-- No inbound FK to conversation_events exists in v1/v2, so the rebuild drops
-- only that table after the copy. onboarding_runs is not touched.

CREATE TABLE conversation_events_v3 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  kind TEXT NOT NULL CHECK (kind IN (
    'user_message',
    'local_scan_card',
    'agent_opening_message',
    'agent_message'
  )),
  generation INTEGER,
  body TEXT NOT NULL,
  presentation TEXT NOT NULL CHECK (presentation IN ('normal', 'expanded', 'folded_evidence')),
  source_ids_json TEXT NOT NULL,
  receipt_id TEXT,
  created_at TEXT NOT NULL,
  seq INTEGER NOT NULL
);

INSERT INTO conversation_events_v3 (
  id, workspace_id, conversation_id, kind, generation, body, presentation,
  source_ids_json, receipt_id, created_at, seq
)
SELECT
  id, workspace_id, conversation_id, kind, generation, body, presentation,
  source_ids_json, receipt_id, created_at,
  ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at, id)
FROM conversation_events;

DROP TABLE conversation_events;

ALTER TABLE conversation_events_v3 RENAME TO conversation_events;

CREATE UNIQUE INDEX conversation_first_message_idem
  ON conversation_events (workspace_id, generation, kind)
  WHERE kind IN ('local_scan_card', 'agent_opening_message') AND generation IS NOT NULL;

CREATE INDEX idx_events_workspace ON conversation_events (workspace_id);

-- One ordinary-turn table. Not an agent, session, permission, or queue platform.
-- request_id is the caller idempotency key. session_ref is a Pi SessionRef, not JSONL.
CREATE TABLE conversation_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_message_id TEXT NOT NULL UNIQUE REFERENCES conversation_events(id),
  request_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'committed', 'cancelled', 'failed')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  grant_updated_at TEXT NOT NULL,
  root_updated_at TEXT NOT NULL,
  session_ref TEXT,
  assistant_message_id TEXT REFERENCES conversation_events(id),
  receipt_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_conversation_runs_workspace ON conversation_runs (workspace_id);
