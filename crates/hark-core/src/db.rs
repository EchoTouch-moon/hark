use std::path::Path;

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, Transaction};

use crate::error::{CoreError, ErrorCode, Result};
use crate::limits::SCHEMA_VERSION;
use crate::Core;

const MIGRATION_V1: &str = include_str!("../migrations/0001_init.sql");
const MIGRATION_V1_NAME: &str = "0001_init";

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
            apply_version(tx, SCHEMA_VERSION, MIGRATION_V1_NAME, MIGRATION_V1)?;
            return Ok(());
        }
        let version: Option<i64> =
            tx.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })?;
        match version {
            None => apply_version(tx, SCHEMA_VERSION, MIGRATION_V1_NAME, MIGRATION_V1),
            Some(v) if v == SCHEMA_VERSION => Ok(()),
            Some(v) if v > SCHEMA_VERSION => Err(CoreError::new(
                ErrorCode::SchemaTooNew,
                format!("database schema {v} is newer than library {SCHEMA_VERSION}"),
            )),
            Some(v) => Err(CoreError::new(
                ErrorCode::MigrationFailed,
                format!("unsupported schema version {v}; this slice only applies v1"),
            )),
        }
    })
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
}
