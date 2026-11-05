use std::path::Path;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, ErrorCode, Result};
use crate::ids::RootId;
use crate::reader::{self, Relation};
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
                let other = Path::new(&root.path);
                match reader::relation(other, Path::new(&stored)) {
                    Ok(Relation::Disjoint) => {}
                    Ok(Relation::Overlap) => {
                        return Err(CoreError::new(
                            ErrorCode::OverlapRefused,
                            "parent_child_exclusion_not_implemented: overlapping authorized roots",
                        ));
                    }
                    Err(err)
                        if err.code == ErrorCode::GrantIdentityMismatch
                            || err.code == ErrorCode::NotFound =>
                    {
                        // Stale grant does not prove a live overlap. Reads on it already fail closed.
                    }
                    Err(err) => return Err(err),
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
        self.with_tx(|tx| {
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
