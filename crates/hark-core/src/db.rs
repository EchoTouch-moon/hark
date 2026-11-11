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
const MIGRATION_V3: &str = include_str!("../migrations/0003_conversation_run.sql");
const MIGRATION_V3_NAME: &str = "0003_conversation_run";
const MIGRATION_V4: &str = include_str!("../migrations/0004_memory.sql");
const MIGRATION_V4_NAME: &str = "0004_memory";
#[cfg(feature = "outbound-review")]
const MIGRATION_V5: &str = include_str!("../migrations/0005_outbound_review.sql");

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
            Some(v) if (1..SCHEMA_VERSION).contains(&v) => apply_upgrades_from(tx, v),
            Some(v) => Err(CoreError::new(
                ErrorCode::MigrationFailed,
                format!("unsupported schema version {v}; this library applies v1 through v4"),
            )),
        }
    })
}

fn apply_fresh(tx: &Transaction<'_>) -> Result<()> {
    apply_version(tx, 1, MIGRATION_V1_NAME, MIGRATION_V1)?;
    apply_version(tx, 2, MIGRATION_V2_NAME, MIGRATION_V2)?;
    apply_conversation_v3(tx)?;
    apply_memory_v4(tx)?;
    #[cfg(feature = "outbound-review")]
    apply_version(tx, 5, "0005_outbound_review", MIGRATION_V5)?;
    Ok(())
}

fn apply_upgrades_from(tx: &Transaction<'_>, version: i64) -> Result<()> {
    if version < 2 {
        apply_version(tx, 2, MIGRATION_V2_NAME, MIGRATION_V2)?;
    }
    if version < 3 {
        apply_conversation_v3(tx)?;
    }
    if version < 4 {
        apply_memory_v4(tx)?;
    }
    #[cfg(feature = "outbound-review")]
    if version < 5 {
        apply_version(tx, 5, "0005_outbound_review", MIGRATION_V5)?;
    }
    Ok(())
}

fn apply_memory_v4(tx: &Transaction<'_>) -> Result<()> {
    let events_before = scalar_count(tx, "SELECT COUNT(*) FROM conversation_events")?;
    let sources_before = scalar_count(tx, "SELECT COUNT(*) FROM source_refs")?;
    tx.execute_batch(MIGRATION_V4)?;
    crate::search::backfill_existing(tx)?;
    let events_after = scalar_count(tx, "SELECT COUNT(*) FROM conversation_events")?;
    let sources_after = scalar_count(tx, "SELECT COUNT(*) FROM source_refs")?;
    if events_before != events_after || sources_before != sources_after {
        return Err(CoreError::new(
            ErrorCode::MigrationFailed,
            format!(
                "refusing memory migration: events {events_before}->{events_after}, sources {sources_before}->{sources_after}"
            ),
        ));
    }
    let fts = scalar_count(
        tx,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'memory_search_fts'",
    )?;
    if fts != 1 {
        return Err(CoreError::new(
            ErrorCode::MigrationFailed,
            "memory_search_fts missing after v4",
        ));
    }
    tx.execute(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![4_i64, MIGRATION_V4_NAME, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

fn apply_conversation_v3(tx: &Transaction<'_>) -> Result<()> {
    ensure_conversation_events_rebuild_safe(tx)?;
    let before = scalar_count(tx, "SELECT COUNT(*) FROM conversation_events")?;
    tx.execute_batch(MIGRATION_V3)?;
    let after = scalar_count(tx, "SELECT COUNT(*) FROM conversation_events")?;
    if before != after {
        return Err(CoreError::new(
            ErrorCode::MigrationFailed,
            format!("refusing conversation_events rebuild: {before} rows before, {after} after"),
        ));
    }
    let index_left = scalar_count(
        tx,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'conversation_first_message_idem'",
    )?;
    if index_left != 1 {
        return Err(CoreError::new(
            ErrorCode::MigrationFailed,
            "conversation_first_message_idem missing after rebuild",
        ));
    }
    let leftover = scalar_count(
        tx,
        "SELECT COUNT(*) FROM sqlite_master WHERE name = 'conversation_events_v3'",
    )?;
    if leftover != 0 {
        return Err(CoreError::new(
            ErrorCode::MigrationFailed,
            "conversation_events_v3 still present after rebuild",
        ));
    }
    let runs = scalar_count(
        tx,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'conversation_runs'",
    )?;
    if runs != 1 {
        return Err(CoreError::new(
            ErrorCode::MigrationFailed,
            "conversation_runs missing after v3",
        ));
    }
    tx.execute(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![3_i64, MIGRATION_V3_NAME, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

fn ensure_conversation_events_rebuild_safe(tx: &Transaction<'_>) -> Result<()> {
    let columns = table_columns(tx, "conversation_events")?;
    let expected_columns = [
        "id",
        "workspace_id",
        "conversation_id",
        "kind",
        "generation",
        "body",
        "presentation",
        "source_ids_json",
        "receipt_id",
        "created_at",
    ];
    if columns != expected_columns {
        return Err(CoreError::new(
            ErrorCode::MigrationFailed,
            format!("refusing conversation_events rebuild; columns are {columns:?}"),
        ));
    }
    let mut indexes = index_names(tx, "conversation_events")?;
    indexes.sort();
    let expected_indexes = ["conversation_first_message_idem", "idx_events_workspace"];
    if indexes != expected_indexes {
        return Err(CoreError::new(
            ErrorCode::MigrationFailed,
            format!("refusing conversation_events rebuild; indexes are {indexes:?}"),
        ));
    }
    let fks = outbound_fks(tx, "conversation_events")?;
    let mut fk_pairs: Vec<(String, String)> = fks
        .into_iter()
        .map(|(from, table, _to)| (from, table))
        .collect();
    fk_pairs.sort();
    let expected_fks = [
        ("conversation_id".to_string(), "conversations".to_string()),
        ("workspace_id".to_string(), "workspaces".to_string()),
    ];
    if fk_pairs != expected_fks {
        return Err(CoreError::new(
            ErrorCode::MigrationFailed,
            format!("refusing conversation_events rebuild; outbound fks are {fk_pairs:?}"),
        ));
    }
    let inbound = inbound_refs(tx, "conversation_events")?;
    if !inbound.is_empty() {
        return Err(CoreError::new(
            ErrorCode::MigrationFailed,
            format!("refusing conversation_events rebuild; inbound fks from {inbound:?}"),
        ));
    }
    let triggers = scalar_count(
        tx,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'conversation_events'",
    )?;
    if triggers != 0 {
        return Err(CoreError::new(
            ErrorCode::MigrationFailed,
            "refusing conversation_events rebuild; triggers exist",
        ));
    }
    let views = scalar_count(
        tx,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'view' AND instr(sql, 'conversation_events') > 0",
    )?;
    if views != 0 {
        return Err(CoreError::new(
            ErrorCode::MigrationFailed,
            "refusing conversation_events rebuild; a view references it",
        ));
    }
    Ok(())
}

fn scalar_count(tx: &Transaction<'_>, sql: &str) -> Result<i64> {
    tx.query_row(sql, [], |row| row.get(0))
        .map_err(CoreError::from)
}

fn table_columns(tx: &Transaction<'_>, table: &str) -> Result<Vec<String>> {
    let mut stmt = tx.prepare(&format!("PRAGMA table_info({})", quote_ident(table)))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let mut names = Vec::new();
    for row in rows {
        names.push(row?);
    }
    Ok(names)
}

fn index_names(tx: &Transaction<'_>, table: &str) -> Result<Vec<String>> {
    let mut stmt = tx.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1 AND name NOT LIKE 'sqlite_%'",
    )?;
    let rows = stmt.query_map(rusqlite::params![table], |row| row.get(0))?;
    let mut names = Vec::new();
    for row in rows {
        names.push(row?);
    }
    Ok(names)
}

fn outbound_fks(tx: &Transaction<'_>, table: &str) -> Result<Vec<(String, String, String)>> {
    let mut stmt = tx.prepare(&format!("PRAGMA foreign_key_list({})", quote_ident(table)))?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(3)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(4)?,
        ))
    })?;
    let mut pairs = Vec::new();
    for row in rows {
        pairs.push(row?);
    }
    Ok(pairs)
}

fn inbound_refs(tx: &Transaction<'_>, target: &str) -> Result<Vec<String>> {
    let mut stmt = tx.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )?;
    let names: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    drop(stmt);
    let mut inbound = Vec::new();
    for name in names {
        if name.eq_ignore_ascii_case(target) {
            continue;
        }
        for (_from, table, _to) in outbound_fks(tx, &name)? {
            if table.eq_ignore_ascii_case(target) {
                inbound.push(name);
                break;
            }
        }
    }
    Ok(inbound)
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
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
        assert_eq!(schema_version(&core).unwrap(), 4);
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
        assert_eq!(schema_version(&again).unwrap(), 4);
        let runs: i64 = again
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'conversation_runs'",
                    [],
                    |row| row.get(0),
                )
                .map_err(CoreError::from)
            })
            .unwrap();
        assert_eq!(runs, 1);
    }

    #[test]
    fn v3_refuses_unknown_event_index_without_dropping_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("extra-index.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(MIGRATION_V1).unwrap();
        conn.execute_batch(MIGRATION_V2).unwrap();
        conn.execute_batch(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, '0001_init', '2026-01-01T00:00:00Z');
             INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, '0002_opening_run', '2026-01-01T00:00:01Z');
             CREATE INDEX extra_events_idx ON conversation_events (created_at);",
        )
        .unwrap();
        drop(conn);

        let err = match open_path(&path) {
            Err(err) => err,
            Ok(_) => panic!("unknown index must refuse the v3 rebuild"),
        };
        assert_eq!(err.code, ErrorCode::MigrationFailed, "{err}");
        let conn = Connection::open(&path).unwrap();
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 2);
        let extra: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'extra_events_idx'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(extra, 1);
        let runs: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'conversation_runs'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(runs, 0);
    }
}
