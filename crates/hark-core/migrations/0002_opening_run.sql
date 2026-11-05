-- Hark R1 schema v2: trusted opening-run binding.
-- Does not rewrite or replace 0001_init.sql. Adds nullable columns only.

ALTER TABLE onboarding_runs ADD COLUMN active_run_id TEXT;
ALTER TABLE onboarding_runs ADD COLUMN auth_provider TEXT;
ALTER TABLE onboarding_runs ADD COLUMN auth_model TEXT;
ALTER TABLE onboarding_runs ADD COLUMN auth_grant_updated_at TEXT;
ALTER TABLE onboarding_runs ADD COLUMN auth_root_updated_at TEXT;
ALTER TABLE onboarding_runs ADD COLUMN initial_read_requested INTEGER NOT NULL DEFAULT 0
  CHECK (initial_read_requested IN (0, 1));

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_active_run
  ON onboarding_runs (active_run_id)
  WHERE active_run_id IS NOT NULL;
