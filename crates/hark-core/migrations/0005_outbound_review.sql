-- This feature-gated migration is not enabled in the production desktop build.
-- It contains approval fingerprints and facts only, never request text or keys.
CREATE TABLE outbound_review_events (
  approval_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('approved', 'consumed')),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  -- Run IDs may be ordinary conversation runs or active opening runs.
  run_id TEXT NOT NULL,
  root_id TEXT NOT NULL REFERENCES authorized_roots(id),
  endpoint TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  source_snapshot_sha256 TEXT NOT NULL,
  limits_sha256 TEXT NOT NULL,
  grant_updated_at TEXT NOT NULL,
  root_updated_at TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (approval_id, phase)
);
-- Enforce workspace ownership for both run kinds without a polymorphic FK.
CREATE TRIGGER outbound_review_owned_run BEFORE INSERT ON outbound_review_events
WHEN NOT EXISTS (
  SELECT 1 FROM conversation_runs c
  WHERE c.id=NEW.run_id AND c.workspace_id=NEW.workspace_id
) AND NOT EXISTS (
  SELECT 1 FROM onboarding_runs o
  WHERE o.active_run_id=NEW.run_id AND o.workspace_id=NEW.workspace_id
)
BEGIN SELECT RAISE(ABORT, 'outbound review run is not owned by workspace'); END;
CREATE TRIGGER outbound_review_no_update BEFORE UPDATE ON outbound_review_events
BEGIN SELECT RAISE(ABORT, 'append only'); END;
CREATE TRIGGER outbound_review_no_delete BEFORE DELETE ON outbound_review_events
BEGIN SELECT RAISE(ABORT, 'append only'); END;
