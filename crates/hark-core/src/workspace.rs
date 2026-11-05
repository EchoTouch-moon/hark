use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, ErrorCode, Result};
use crate::grant::{self, AuthorizedRoot, RootStatus};
use crate::ids::{
    AgentId, CandidateId, ConversationId, GrantId, OnboardingId, RootId, ScanId, WorkspaceId,
};
use crate::limits::ONBOARDING_GENERATION;
use crate::policy::{split_relative, validate_provider_token};
use crate::reader::{self, DirIdentity};
use crate::scan::{CandidateRole, InitialScan, ScanStatus};
use crate::Core;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceKind {
    Model,
    Search,
    BackgroundModel,
    Notification,
}

impl ServiceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Model => "model",
            Self::Search => "search",
            Self::BackgroundModel => "background_model",
            Self::Notification => "notification",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "model" => Ok(Self::Model),
            "search" => Ok(Self::Search),
            "background_model" => Ok(Self::BackgroundModel),
            "notification" => Ok(Self::Notification),
            _ => Err(CoreError::new(ErrorCode::Sqlite, "unknown service")),
        }
    }

    fn all() -> [Self; 4] {
        [
            Self::Model,
            Self::Search,
            Self::BackgroundModel,
            Self::Notification,
        ]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceStatus {
    Enabled,
    Paused,
    Revoked,
    Disabled,
}

impl ServiceStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Enabled => "enabled",
            Self::Paused => "paused",
            Self::Revoked => "revoked",
            Self::Disabled => "disabled",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "enabled" => Ok(Self::Enabled),
            "paused" => Ok(Self::Paused),
            "revoked" => Ok(Self::Revoked),
            "disabled" => Ok(Self::Disabled),
            _ => Err(CoreError::new(ErrorCode::Sqlite, "unknown service status")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum ImportMode {
    SingleProject,
    SelectedCandidates { candidate_ids: Vec<CandidateId> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmImport {
    pub root_id: RootId,
    pub scan_id: ScanId,
    pub mode: ImportMode,
    pub enable_model_initial_read: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: WorkspaceId,
    pub root_id: RootId,
    pub agent_id: AgentId,
    pub conversation_id: ConversationId,
    pub relative_path: String,
    pub dev: String,
    pub ino: String,
    pub display_name: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceGrant {
    pub id: GrantId,
    pub workspace_id: WorkspaceId,
    pub service: ServiceKind,
    pub status: ServiceStatus,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceGrantUpdate {
    pub workspace_id: WorkspaceId,
    pub service: ServiceKind,
    pub status: ServiceStatus,
    pub provider: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmResult {
    pub workspaces: Vec<Workspace>,
    pub replayed: bool,
}

impl Core {
    pub fn confirm_import(&self, req: &ConfirmImport) -> Result<ConfirmResult> {
        let root = self.get_root(&req.root_id)?;
        grant::require_active(&root)?;
        let identity = DirIdentity {
            dev: root.dev.clone(),
            ino: root.ino.clone(),
        };
        reader::identify_relative(std::path::Path::new(&root.path), &identity, "")?;
        let scan = self.get_scan(&req.scan_id)?;
        if scan.root_id != root.id {
            return Err(CoreError::new(
                ErrorCode::CandidateNotInScan,
                "scan belongs to another root",
            ));
        }
        if !matches!(scan.status, ScanStatus::Completed | ScanStatus::Limited) {
            return Err(CoreError::new(
                ErrorCode::ScanNotConfirmable,
                "cancelled or failed scans do not create workspaces",
            ));
        }
        let requested = requested_paths(&scan, &req.mode)?;
        if requested.is_empty() {
            return Err(CoreError::new(
                ErrorCode::CandidateNotInScan,
                "no candidates selected",
            ));
        }
        refuse_internal_overlap(&requested)?;
        self.with_tx(|tx| {
            let existing = load_workspaces(tx)?;
            let already = existing
                .iter()
                .filter(|ws| {
                    ws.root_id == root.id && requested.iter().any(|p| p == &ws.relative_path)
                })
                .cloned()
                .collect::<Vec<_>>();
            if already.len() == requested.len() {
                return Ok(ConfirmResult {
                    workspaces: already,
                    replayed: true,
                });
            }
            if !already.is_empty() {
                return Err(CoreError::new(
                    ErrorCode::ScanAlreadyConfirmed,
                    "scan is partially confirmed; refusing to add workspaces",
                ));
            }
            for path in &requested {
                let ident =
                    reader::identify_relative(std::path::Path::new(&root.path), &identity, path)?;
                refuse_against_existing(&existing, &root, path, &ident)?;
            }
            let now = Utc::now().to_rfc3339();
            let mut created = Vec::new();
            for path in &requested {
                let ident =
                    reader::identify_relative(std::path::Path::new(&root.path), &identity, path)?;
                let ws = insert_workspace(tx, &root, path, &ident, &now, &scan)?;
                enable_model_if_requested(tx, &ws.id, req.enable_model_initial_read)?;
                created.push(ws);
            }
            Ok(ConfirmResult {
                workspaces: created,
                replayed: false,
            })
        })
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        self.with_conn(load_workspaces)
    }

    pub fn get_workspace(&self, id: &WorkspaceId) -> Result<Workspace> {
        self.with_conn(|conn| {
            load_workspace(conn, id)?
                .ok_or_else(|| CoreError::new(ErrorCode::WorkspaceNotFound, id.as_str()))
        })
    }

    pub fn set_service_grant(&self, update: &ServiceGrantUpdate) -> Result<ServiceGrant> {
        if let Some(provider) = &update.provider {
            validate_provider_token(provider)?;
        }
        if let Some(model) = &update.model {
            validate_provider_token(model)?;
        }
        self.with_tx(|tx| {
            let ws = load_workspace(tx, &update.workspace_id)?.ok_or_else(|| {
                CoreError::new(ErrorCode::WorkspaceNotFound, update.workspace_id.as_str())
            })?;
            let now = Utc::now().to_rfc3339();
            tx.execute(
                "UPDATE service_grants
                 SET status = ?1, provider = ?2, model = ?3, updated_at = ?4
                 WHERE workspace_id = ?5 AND service = ?6",
                params![
                    update.status.as_str(),
                    update.provider,
                    update.model,
                    now,
                    ws.id.as_str(),
                    update.service.as_str(),
                ],
            )?;
            load_grant(tx, &ws.id, update.service)?
                .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "service grant missing"))
        })
    }

    pub fn get_service_grant(
        &self,
        workspace_id: &WorkspaceId,
        service: ServiceKind,
    ) -> Result<ServiceGrant> {
        self.with_conn(|conn| {
            load_grant(conn, workspace_id, service)?
                .ok_or_else(|| CoreError::new(ErrorCode::NotFound, service.as_str()))
        })
    }
}

fn requested_paths(scan: &InitialScan, mode: &ImportMode) -> Result<Vec<String>> {
    match mode {
        ImportMode::SingleProject => Ok(vec![String::new()]),
        ImportMode::SelectedCandidates { candidate_ids } => {
            let mut paths = Vec::new();
            for id in candidate_ids {
                let cand = scan
                    .candidates
                    .iter()
                    .find(|c| &c.id == id)
                    .ok_or_else(|| CoreError::new(ErrorCode::CandidateNotInScan, id.as_str()))?;
                if cand.role == CandidateRole::SingleRoot && candidate_ids.len() > 1 {
                    return Err(CoreError::new(
                        ErrorCode::OverlapRefused,
                        "parent_child_exclusion_not_implemented: cannot import the root and a child together",
                    ));
                }
                paths.push(cand.relative_path.clone());
            }
            paths.sort();
            paths.dedup();
            Ok(paths)
        }
    }
}

fn refuse_internal_overlap(paths: &[String]) -> Result<()> {
    for (i, left) in paths.iter().enumerate() {
        for right in paths.iter().skip(i + 1) {
            if relative_overlap(left, right) {
                return Err(CoreError::new(
                    ErrorCode::OverlapRefused,
                    "parent_child_exclusion_not_implemented: selected paths overlap",
                ));
            }
        }
    }
    Ok(())
}

fn relative_overlap(left: &str, right: &str) -> bool {
    if left == right {
        return true;
    }
    let Ok(a) = split_relative(left) else {
        return true;
    };
    let Ok(b) = split_relative(right) else {
        return true;
    };
    let n = a.len().min(b.len());
    if a.len() == b.len() {
        return a
            .iter()
            .zip(b.iter())
            .all(|(x, y)| x.eq_ignore_ascii_case(y));
    }
    let (shorter, longer) = if a.len() < b.len() {
        (&a, &b)
    } else {
        (&b, &a)
    };
    shorter
        .iter()
        .zip(longer.iter())
        .take(n)
        .all(|(x, y)| x.eq_ignore_ascii_case(y))
        && shorter.len() < longer.len()
}

fn refuse_against_existing(
    existing: &[Workspace],
    root: &AuthorizedRoot,
    path: &str,
    ident: &DirIdentity,
) -> Result<()> {
    for ws in existing {
        if ws.dev == ident.dev && ws.ino == ident.ino {
            return Err(CoreError::new(
                ErrorCode::OverlapRefused,
                "parent_child_exclusion_not_implemented: same directory inode",
            ));
        }
        if ws.root_id == root.id && relative_overlap(&ws.relative_path, path) {
            return Err(CoreError::new(
                ErrorCode::OverlapRefused,
                "parent_child_exclusion_not_implemented: overlaps an existing workspace",
            ));
        }
        if ws.root_id != root.id {
            let other = load_root_path_from_workspace(ws);
            if other.dev == ident.dev && other.ino == ident.ino {
                return Err(CoreError::new(
                    ErrorCode::OverlapRefused,
                    "parent_child_exclusion_not_implemented: cross-root inode overlap",
                ));
            }
        }
    }
    let _ = RootStatus::Active;
    Ok(())
}

fn load_root_path_from_workspace(ws: &Workspace) -> DirIdentity {
    DirIdentity {
        dev: ws.dev.clone(),
        ino: ws.ino.clone(),
    }
}

fn insert_workspace(
    tx: &rusqlite::Transaction<'_>,
    root: &AuthorizedRoot,
    relative_path: &str,
    ident: &DirIdentity,
    now: &str,
    scan: &InitialScan,
) -> Result<Workspace> {
    let id = WorkspaceId::new();
    let agent_id = AgentId::new();
    let conversation_id = ConversationId::new();
    let onboarding_id = OnboardingId::new();
    let display_name = if relative_path.is_empty() {
        std::path::Path::new(&root.path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("project")
            .to_string()
    } else {
        relative_path
            .rsplit('/')
            .next()
            .unwrap_or("project")
            .to_string()
    };
    tx.execute(
        "INSERT INTO workspaces (
            id, root_id, agent_id, conversation_id, relative_path, dev, ino, display_name, status, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9)",
        params![
            id.as_str(),
            root.id.as_str(),
            agent_id.as_str(),
            conversation_id.as_str(),
            relative_path,
            ident.dev,
            ident.ino,
            display_name,
            now,
        ],
    )?;
    tx.execute(
        "INSERT INTO conversations (id, workspace_id, created_at) VALUES (?1, ?2, ?3)",
        params![conversation_id.as_str(), id.as_str(), now],
    )?;
    for service in ServiceKind::all() {
        let status = "disabled";
        tx.execute(
            "INSERT INTO service_grants (id, workspace_id, service, status, provider, model, updated_at)
             VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5)",
            params![GrantId::new().as_str(), id.as_str(), service.as_str(), status, now],
        )?;
    }
    let evidence = serde_json::json!({
        "scanId": scan.id.as_str(),
        "coverage": scan.coverage,
        "limitsHit": scan.limits_hit,
        "note": "workspace created from confirmed scan; no memory and no model call",
    });
    tx.execute(
        "INSERT INTO onboarding_runs (
            id, workspace_id, generation, state, scan_id, structure_scanned, selective_read_done,
            model_analyzed, opening_presented, local_card_folded, model_status, error_code,
            evidence_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, 'workspace_created', ?4, 1, 0, 0, 0, 0, 'disabled', NULL, ?5, ?6, ?6)",
        params![
            onboarding_id.as_str(),
            id.as_str(),
            ONBOARDING_GENERATION,
            scan.id.as_str(),
            evidence.to_string(),
            now,
        ],
    )?;
    tx.execute(
        "UPDATE scan_candidates SET workspace_id = ?1 WHERE scan_id = ?2 AND relative_path = ?3",
        params![id.as_str(), scan.id.as_str(), relative_path],
    )?;
    Ok(Workspace {
        id,
        root_id: root.id.clone(),
        agent_id,
        conversation_id,
        relative_path: relative_path.to_string(),
        dev: ident.dev.clone(),
        ino: ident.ino.clone(),
        display_name,
        status: "active".to_string(),
        created_at: now.to_string(),
    })
}

pub(crate) fn load_workspaces(conn: &rusqlite::Connection) -> Result<Vec<Workspace>> {
    let mut stmt = conn.prepare(
        "SELECT id, root_id, agent_id, conversation_id, relative_path, dev, ino, display_name, status, created_at
         FROM workspaces ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([], map_workspace)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub(crate) fn load_workspace(
    conn: &rusqlite::Connection,
    id: &WorkspaceId,
) -> Result<Option<Workspace>> {
    conn.query_row(
        "SELECT id, root_id, agent_id, conversation_id, relative_path, dev, ino, display_name, status, created_at
         FROM workspaces WHERE id = ?1",
        params![id.as_str()],
        map_workspace,
    )
    .optional()
    .map_err(CoreError::from)
}

fn map_workspace(row: &rusqlite::Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: WorkspaceId::from_trusted(row.get(0)?),
        root_id: RootId::from_trusted(row.get(1)?),
        agent_id: AgentId::from_trusted(row.get(2)?),
        conversation_id: ConversationId::from_trusted(row.get(3)?),
        relative_path: row.get(4)?,
        dev: row.get(5)?,
        ino: row.get(6)?,
        display_name: row.get(7)?,
        status: row.get(8)?,
        created_at: row.get(9)?,
    })
}

pub(crate) fn load_grant(
    conn: &rusqlite::Connection,
    workspace_id: &WorkspaceId,
    service: ServiceKind,
) -> Result<Option<ServiceGrant>> {
    conn.query_row(
        "SELECT id, workspace_id, service, status, provider, model, updated_at
         FROM service_grants WHERE workspace_id = ?1 AND service = ?2",
        params![workspace_id.as_str(), service.as_str()],
        |row| {
            let service: String = row.get(2)?;
            let status: String = row.get(3)?;
            Ok(ServiceGrant {
                id: GrantId::from_trusted(row.get(0)?),
                workspace_id: WorkspaceId::from_trusted(row.get(1)?),
                service: ServiceKind::parse(&service).map_err(sql_err)?,
                status: ServiceStatus::parse(&status).map_err(sql_err)?,
                provider: row.get(4)?,
                model: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .optional()
    .map_err(CoreError::from)
}

fn sql_err(err: CoreError) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(err.to_string())))
}

pub(crate) fn enable_model_if_requested(
    tx: &rusqlite::Transaction<'_>,
    workspace_id: &WorkspaceId,
    enabled: bool,
) -> Result<()> {
    if !enabled {
        return Ok(());
    }
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "UPDATE service_grants SET status = 'enabled', updated_at = ?1
         WHERE workspace_id = ?2 AND service = 'model'",
        params![now, workspace_id.as_str()],
    )?;
    tx.execute(
        "UPDATE onboarding_runs SET model_status = 'enabled_awaiting_receipt', updated_at = ?1
         WHERE workspace_id = ?2 AND generation = ?3",
        params![now, workspace_id.as_str(), ONBOARDING_GENERATION],
    )?;
    Ok(())
}
