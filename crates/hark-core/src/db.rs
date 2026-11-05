use std::path::Path;

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, Transaction};

use crate::error::{CoreError, ErrorCode, Result};
use crate::limits::SCHEMA_VERSION;
use crate::Core;

const MIGRATION_V1: &str = include_str!("../migrations/0001_init.sql");
const MIGRATION_V1_NAME: &str = "0001_init";
const MIGRATION_V2: &str = include_str!("../migrations/0002_opening_run.sql");
const MIGRATION_V2_NAME: &str = "0002_opening_run";

pub(crate) fn open_path(path: &Path) -> Result<Core> {
    let conn = Connection::open(path)?;
    finish_open(conn)
}

pub(crate) fn open_memory() -> Result<Core> {
    let conn = Connection::open_in_memory()?;
    finish_open(conn)
}

fn finish_open(conn: Connection) -> Result<Core> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5_000)?;
    let core = Core {
        conn: std::sync::Mutex::new(conn),
    };
    migrate(&core)?;
    Ok(core)
}

pub(crate) fn migrate(core: &Core) -> Result<()> {
    core.with_tx(|tx| {
        let current = tx
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
                [],
                |_| Ok(1),
            )
            .optional()?;
        if current.is_none() {
            apply_fresh(tx)?;
            return Ok(());
        }
        let version: Option<i64> =
            tx.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })?;
        match version {
            None => apply_fresh(tx),
            Some(v) if v == SCHEMA_VERSION => Ok(()),
            Some(v) if v > SCHEMA_VERSION => Err(CoreError::new(
                ErrorCode::SchemaTooNew,
                format!("database schema {v} is newer than library {SCHEMA_VERSION}"),
            )),
            Some(1) => apply_version(tx, 2, MIGRATION_V2_NAME, MIGRATION_V2),
            Some(v) => Err(CoreError::new(
                ErrorCode::MigrationFailed,
                format!("unsupported schema version {v}; this library applies v1 then v2 only"),
            )),
        }
    })
}

fn apply_fresh(tx: &Transaction<'_>) -> Result<()> {
    apply_version(tx, 1, MIGRATION_V1_NAME, MIGRATION_V1)?;
    apply_version(tx, 2, MIGRATION_V2_NAME, MIGRATION_V2)?;
    Ok(())
}

fn apply_version(tx: &Transaction<'_>, version: i64, name: &str, sql: &str) -> Result<()> {
    tx.execute_batch(sql)?;
    tx.execute(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![version, name, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

/// Apply SQL and a version row in one transaction. Used by migration and rollback tests.
#[cfg(test)]
pub(crate) fn apply_sql_in_transaction(
    conn: &Connection,
    version: i64,
    name: &str,
    sql: &str,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    apply_version(&tx, version, name, sql)?;
    tx.commit()?;
    Ok(())
}

pub(crate) fn schema_version(core: &Core) -> Result<i64> {
    core.with_conn(|conn| {
        let v: i64 = conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })?;
        Ok(v)
    })
}

pub(crate) fn table_names(core: &Core) -> Result<Vec<String>> {
    core.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    })
}

impl Core {
    pub(crate) fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| CoreError::new(ErrorCode::LockPoisoned, "core lock poisoned"))?;
        f(&guard)
    }

    pub(crate) fn with_tx<T>(&self, f: impl FnOnce(&Transaction<'_>) -> Result<T>) -> Result<T> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| CoreError::new(ErrorCode::LockPoisoned, "core lock poisoned"))?;
        let tx = guard.unchecked_transaction()?;
        let value = f(&tx)?;
        tx.commit()?;
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_sql_transaction_rolls_back_ddl() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        let err = apply_sql_in_transaction(
            &conn,
            1,
            "broken",
            "CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY); INSERT INTO missing_table (id) VALUES (1);",
        );
        assert!(err.is_err());
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'rollback_probe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 0);
    }

    #[test]
    fn v1_database_upgrades_to_v2_without_rewriting_v1() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("v1.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(MIGRATION_V1).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, '0001_init', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        drop(conn);

        let core = open_path(&path).unwrap();
        assert_eq!(schema_version(&core).unwrap(), 2);
        let columns = core
            .with_conn(|conn| {
                let mut stmt = conn.prepare("PRAGMA table_info(onboarding_runs)")?;
                let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
                let mut names = Vec::new();
                for row in rows {
                    names.push(row?);
                }
                Ok(names)
            })
            .unwrap();
        for required in [
            "active_run_id",
            "auth_provider",
            "auth_model",
            "auth_grant_updated_at",
            "auth_root_updated_at",
            "initial_read_requested",
        ] {
            assert!(columns.iter().any(|name| name == required), "{required}");
        }
        let again = open_path(&path).unwrap();
        assert_eq!(schema_version(&again).unwrap(), 2);
    }
}
