import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AnalysisError } from '../errors.js';

export const ANALYSIS_SCHEMA_VERSION = 4;

export function defaultAnalysisDbPath(repoRoot: string): string {
  return process.env['HEARTH_ANALYSIS_DB'] ?? path.join(repoRoot, 'data', 'analysis.sqlite');
}

export function openAnalysisDatabase(dbPath: string): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  const current = row?.v ?? 0;
  if (current < 1) {
    try {
      db.exec('BEGIN');
      db.exec(`CREATE TABLE analysis_runs (
        run_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        insight_id TEXT,
        trigger TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        status TEXT NOT NULL,
        snapshot_id TEXT,
        head_sha TEXT,
        stream_epoch INTEGER NOT NULL,
        context_fingerprint TEXT NOT NULL,
        recommendation_json TEXT,
        error_code TEXT,
        error_message TEXT,
        usage_json TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        created_at TEXT NOT NULL
      )`);
      db.exec('CREATE INDEX idx_analysis_project_created ON analysis_runs(project_id, created_at DESC)');
      db.exec(`CREATE TABLE analysis_feedback (
        run_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('useful', 'not_useful')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      db.prepare('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)').run(
        1,
        'analysis-v1',
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (cause) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // keep original
      }
      throw new AnalysisError('MIGRATION_FAILED', 'analysis schema v1 failed', { cause });
    }
  }
  if (current < 2) {
    db.exec(`BEGIN;
      CREATE TABLE analysis_deletions (project_id TEXT PRIMARY KEY, requested_at TEXT NOT NULL);
      INSERT INTO schema_version VALUES (2, 'analysis-deletion-journal', datetime('now'));
      COMMIT;`);
  }
  if (current < 3) {
    db.exec(`BEGIN;
      CREATE TABLE analysis_privacy (project_id TEXT PRIMARY KEY, excluded_paths_json TEXT NOT NULL);
      INSERT INTO schema_version VALUES (3, 'analysis-privacy-policy', datetime('now'));
      COMMIT;`);
  }
  if (current < 4) {
    db.exec(`BEGIN;
      CREATE TABLE analysis_consents (run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, context_fingerprint TEXT NOT NULL, recipient TEXT NOT NULL, accepted_at TEXT NOT NULL);
      INSERT INTO schema_version VALUES (4, 'analysis-explicit-disclosure-consent', datetime('now'));
      COMMIT;`);
  }
  return db;
}
