use std::path::Path;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, ErrorCode, Result};
use crate::ids::RootId;
use crate::reader::{self, DirIdentity};
use crate::Core;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RootStatus {
    Active,
    Paused,
    Revoked,
}

impl RootStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paused => "paused",
            Self::Revoked => "revoked",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "active" => Ok(Self::Active),
            "paused" => Ok(Self::Paused),
            "revoked" => Ok(Self::Revoked),
            _ => Err(CoreError::new(ErrorCode::Sqlite, "unknown root status")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizedRoot {
    pub id: RootId,
    pub path: String,
    pub dev: String,
    pub ino: String,
    pub status: RootStatus,
    pub created_at: String,
    pub updated_at: String,
}

impl Core {
    pub fn authorize_directory(&self, path: &Path) -> Result<AuthorizedRoot> {
        let identity = reader::identify_directory(path)?;
        let stored = canonical_store_path(path)?;
        self.with_tx(|tx| {
            let existing = load_roots(tx)?;
            for root in &existing {
                if root.status == RootStatus::Revoked {
                    continue;
                }
                if root.dev == identity.dev && root.ino == identity.ino {
                    if root.path == stored {
                        return Err(CoreError::new(
                            ErrorCode::RootAlreadyAuthorized,
                            root.id.as_str(),
                        ));
                    }
                    return Err(CoreError::new(
                        ErrorCode::OverlapRefused,
                        "parent_child_exclusion_not_implemented: same inode as an existing grant",
                    ));
                }
                let other_id = DirIdentity {
                    dev: root.dev.clone(),
                    ino: root.ino.clone(),
                };
                refuse_if_scope_overlaps(
                    reader::scopes_overlap(
                        Path::new(&stored),
                        &identity,
                        "",
                        &identity,
                        Path::new(&root.path),
                        &other_id,
                        "",
                        &other_id,
                    ),
                    "parent_child_exclusion_not_implemented: overlapping authorized roots",
                )?;
                for scope in load_workspace_scopes(tx)?
                    .into_iter()
                    .filter(|scope| scope.root_id == root.id.as_str())
                {
                    let ws_id = DirIdentity {
                        dev: scope.dev,
                        ino: scope.ino,
                    };
                    refuse_if_scope_overlaps(
                        reader::scopes_overlap(
                            Path::new(&stored),
                            &identity,
                            "",
                            &identity,
                            Path::new(&root.path),
                            &other_id,
                            &scope.relative_path,
                            &ws_id,
                        ),
                        "parent_child_exclusion_not_implemented: overlaps an existing workspace",
                    )?;
                }
            }
            let id = RootId::new();
            let now = Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO authorized_roots (id, path, dev, ino, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)",
                params![id.as_str(), stored, identity.dev, identity.ino, now],
            )?;
            Ok(AuthorizedRoot {
                id,
                path: stored,
                dev: identity.dev,
                ino: identity.ino,
                status: RootStatus::Active,
                created_at: now.clone(),
                updated_at: now,
            })
        })
    }

    pub fn pause_directory(&self, id: &RootId) -> Result<AuthorizedRoot> {
        self.set_status(
            id,
            RootStatus::Paused,
            &[RootStatus::Active, RootStatus::Paused],
        )
    }

    pub fn resume_directory(&self, id: &RootId) -> Result<AuthorizedRoot> {
        self.set_status(
            id,
            RootStatus::Active,
            &[RootStatus::Paused, RootStatus::Active],
        )
    }

    pub fn revoke_directory(&self, id: &RootId) -> Result<AuthorizedRoot> {
        self.set_status(
            id,
            RootStatus::Revoked,
            &[RootStatus::Active, RootStatus::Paused, RootStatus::Revoked],
        )
    }

    pub fn get_root(&self, id: &RootId) -> Result<AuthorizedRoot> {
        self.with_conn(|conn| {
            load_root(conn, id)?.ok_or_else(|| CoreError::new(ErrorCode::NotFound, id.as_str()))
        })
    }

    pub fn list_roots(&self) -> Result<Vec<AuthorizedRoot>> {
        self.with_conn(load_roots)
    }

    fn set_status(
        &self,
        id: &RootId,
        next: RootStatus,
        allowed: &[RootStatus],
    ) -> Result<AuthorizedRoot> {
        self.with_immediate_tx(|tx| {
            let current = load_root(tx, id)?
                .ok_or_else(|| CoreError::new(ErrorCode::NotFound, id.as_str()))?;
            if current.status == RootStatus::Revoked && next != RootStatus::Revoked {
                return Err(CoreError::new(ErrorCode::RootRevoked, id.as_str()));
            }
            if !allowed.contains(&current.status) {
                return Err(CoreError::new(ErrorCode::RootRevoked, id.as_str()));
            }
            let now = Utc::now().to_rfc3339();
            tx.execute(
                "UPDATE authorized_roots SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![next.as_str(), now, id.as_str()],
            )?;
            let mut updated = current;
            updated.status = next;
            updated.updated_at = now;
            Ok(updated)
        })
    }
}

pub(crate) fn require_active(root: &AuthorizedRoot) -> Result<()> {
    match root.status {
        RootStatus::Active => Ok(()),
        RootStatus::Paused => Err(CoreError::new(ErrorCode::RootPaused, root.id.as_str())),
        RootStatus::Revoked => Err(CoreError::new(ErrorCode::RootRevoked, root.id.as_str())),
    }
}

/// Reader admission callbacks. `check` returns with no Core/SQLite lock held.
/// `admit` rechecks and holds the short reservation across `op`.
pub(crate) struct IoGate<'a> {
    check_fn: &'a dyn Fn() -> Result<()>,
    admit_fn: &'a dyn Fn(&mut dyn FnMut() -> Result<()>) -> Result<()>,
}

impl<'a> IoGate<'a> {
    pub(crate) fn new(
        check_fn: &'a dyn Fn() -> Result<()>,
        admit_fn: &'a dyn Fn(&mut dyn FnMut() -> Result<()>) -> Result<()>,
    ) -> Self {
        Self { check_fn, admit_fn }
    }

    pub(crate) fn check(&self) -> Result<()> {
        (self.check_fn)()
    }

    pub(crate) fn admit(&self, op: &mut dyn FnMut() -> Result<()>) -> Result<()> {
        (self.admit_fn)(op)
    }
}

fn relaxed_check() -> Result<()> {
    Ok(())
}

fn relaxed_admit(op: &mut dyn FnMut() -> Result<()>) -> Result<()> {
    op()
}

/// Identity and overlap opens run inside `with_tx` and must not take `Core.conn` again.
pub(crate) fn relaxed_io_gate() -> IoGate<'static> {
    IoGate::new(&relaxed_check, &relaxed_admit)
}

impl Core {
    /// Short open/read admission.
    ///
    /// `get_root` / `with_conn` cannot be reused: they drop the mutex before the
    /// syscall, which is the race. `with_tx` cannot be reused either: it is a
    /// deferred business transaction that commits, it does not reserve the
    /// writer lock before the check, and calling it while it is already held
    /// deadlocks the non-reentrant mutex.
    ///
    /// This locks `Core.conn` and `BEGIN IMMEDIATE` only for `op` (one syscall).
    /// Same-Core revoke/pause waits on the mutex. Another connection waits on
    /// the rollback-journal reserved lock (`busy_timeout`). Do not enable WAL:
    /// WAL readers do not block writers. `op` must not re-enter Core. Rollback
    /// leaves no row and no migration. Fold into `db.rs` later as
    /// `Core::admit_active_io(root_id, op)` if a serial merge wants one helper.
    pub(crate) fn admit_active_io<T>(
        &self,
        root_id: &RootId,
        op: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| CoreError::new(ErrorCode::LockPoisoned, "core lock poisoned"))?;
        let tx = guard.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let current = load_root(&tx, root_id)?
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound, root_id.as_str()))?;
        require_active(&current)?;
        let value = op()?;
        tx.rollback()?;
        Ok(value)
    }

    /// Write transaction that reserves the writer lock before the callback.
    /// Used by pause/revoke and read-path source commits so they queue with
    /// `admit_active_io` instead of upgrading a deferred shared lock (that
    /// upgrade deadlocks against a waiting writer and returns SQLITE_BUSY).
    pub(crate) fn with_immediate_tx<T>(
        &self,
        f: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T>,
    ) -> Result<T> {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| CoreError::new(ErrorCode::LockPoisoned, "core lock poisoned"))?;
        let tx = guard.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let value = f(&tx)?;
        tx.commit()?;
        Ok(value)
    }
}

/// Overlap, or an error that does not prove the scopes are disjoint, both refuse.
/// A missing or replaced grant is not treated as disjoint.
pub(crate) fn refuse_if_scope_overlaps(result: Result<bool>, detail: &str) -> Result<()> {
    match result {
        Ok(false) => Ok(()),
        Ok(true) => Err(CoreError::new(ErrorCode::OverlapRefused, detail)),
        Err(err) if unproven_scope(&err) => Err(CoreError::new(
            ErrorCode::OverlapRefused,
            format!(
                "parent_child_exclusion_not_implemented: cannot prove disjoint ({}); {detail}",
                err.code_str()
            ),
        )),
        Err(err) => Err(err),
    }
}

fn unproven_scope(err: &CoreError) -> bool {
    matches!(
        err.code,
        ErrorCode::NotFound
            | ErrorCode::GrantIdentityMismatch
            | ErrorCode::SymlinkRejected
            | ErrorCode::AccessDenied
            | ErrorCode::AliasRejected
            | ErrorCode::AliasCheckFailed
            | ErrorCode::NotADirectory
            | ErrorCode::PathEscape
            | ErrorCode::InvalidPath
            | ErrorCode::CrossDeviceRejected
            | ErrorCode::SpecialFileRejected
    )
}

struct WorkspaceScope {
    root_id: String,
    relative_path: String,
    dev: String,
    ino: String,
}

fn load_workspace_scopes(conn: &rusqlite::Connection) -> Result<Vec<WorkspaceScope>> {
    let mut stmt = conn.prepare("SELECT root_id, relative_path, dev, ino FROM workspaces")?;
    let rows = stmt.query_map([], |row| {
        Ok(WorkspaceScope {
            root_id: row.get(0)?,
            relative_path: row.get(1)?,
            dev: row.get(2)?,
            ino: row.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub(crate) fn load_root(
    conn: &rusqlite::Connection,
    id: &RootId,
) -> Result<Option<AuthorizedRoot>> {
    conn.query_row(
        "SELECT id, path, dev, ino, status, created_at, updated_at FROM authorized_roots WHERE id = ?1",
        params![id.as_str()],
        map_root,
    )
    .optional()
    .map_err(CoreError::from)
}

pub(crate) fn load_roots(conn: &rusqlite::Connection) -> Result<Vec<AuthorizedRoot>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, dev, ino, status, created_at, updated_at FROM authorized_roots ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([], map_root)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn map_root(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuthorizedRoot> {
    let status: String = row.get(4)?;
    Ok(AuthorizedRoot {
        id: RootId::from_trusted(row.get(0)?),
        path: row.get(1)?,
        dev: row.get(2)?,
        ino: row.get(3)?,
        status: RootStatus::parse(&status).map_err(|err| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(
                err.to_string(),
            )))
        })?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn canonical_store_path(path: &Path) -> Result<String> {
    let text = path
        .to_str()
        .ok_or_else(|| CoreError::new(ErrorCode::InvalidPath, "path is not utf-8"))?;
    let trimmed = text.trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(CoreError::new(
            ErrorCode::InvalidPath,
            "refusing filesystem root",
        ));
    }
    Ok(trimmed.to_string())
}
