use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{CoreError, ErrorCode, Result};
use crate::grant::{self, AuthorizedRoot, RootStatus};
use crate::ids::{MessageId, SourceId, WorkspaceId};
use crate::limits::{
    MAX_EVENT_BODY_CHARS, MAX_EXCERPT_CHARS, MAX_USER_MESSAGE_CHARS, ONBOARDING_GENERATION,
};
use crate::policy::{
    is_key_file, join_relative, private_key_bytes, split_relative, validate_provider_token,
};
use crate::reader::{self, DirIdentity};
use crate::scan::ScanBudget;
use crate::workspace::{self, ServiceKind, ServiceStatus, Workspace};
use crate::CancelFlag;
use crate::Core;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    pub id: SourceId,
    pub workspace_id: WorkspaceId,
    pub relative_path: String,
    pub content_sha256: String,
    pub byte_len: u64,
    pub truncated: bool,
    pub binary: bool,
    pub excerpt: Option<String>,
    pub observed_at: String,
    pub content_available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRead {
    pub source: SourceRef,
    pub text: Option<String>,
    pub untrusted: bool,
    pub complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationEvent {
    pub id: MessageId,
    pub workspace_id: WorkspaceId,
    pub conversation_id: String,
    pub kind: String,
    pub generation: Option<i64>,
    pub body: String,
    pub presentation: String,
    pub source_ids: Vec<SourceId>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstMessage {
    pub event: ConversationEvent,
    pub replayed: bool,
    pub folded_local_card: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingCheckpoint {
    pub workspace_id: WorkspaceId,
    pub generation: i64,
    pub state: String,
    pub structure_scanned: bool,
    pub selective_read_done: bool,
    pub model_analyzed: bool,
    pub opening_presented: bool,
    pub local_card_folded: bool,
    pub model_status: String,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOpeningReceipt {
    pub workspace_id: WorkspaceId,
    pub receipt_id: String,
    pub provider: String,
    pub model: String,
    pub success: bool,
    pub body: String,
    pub source_ids: Vec<SourceId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectiveReadReport {
    pub sources: Vec<SourceRef>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOverview {
    pub workspace_id: WorkspaceId,
    pub relative_path: String,
    pub directory_status: String,
    pub readable: bool,
    pub structure_scanned: bool,
    pub selective_read_done: bool,
    pub model_analyzed: bool,
    pub opening_presented: bool,
    pub model_inference: bool,
    pub source_ids: Vec<SourceId>,
}

impl Core {
    pub fn read_workspace_file(
        &self,
        workspace_id: &WorkspaceId,
        relative_path: &str,
        budget: &ScanBudget,
    ) -> Result<FileRead> {
        budget.validate()?;
        let (ws, root) = self.workspace_and_root(workspace_id)?;
        grant::require_active(&root)?;
        let full = compose_rel(&ws.relative_path, relative_path)?;
        let bytes = read_checked(&root, &ws, &full, budget.max_file_bytes)?;
        let source = self.with_tx(|tx| insert_source(tx, &ws, relative_path, &bytes))?;
        let text = utf8_text(&bytes.bytes);
        Ok(FileRead {
            complete: !bytes.truncated && text.is_some(),
            text,
            untrusted: true,
            source,
        })
    }

    pub fn selective_key_read(
        &self,
        workspace_id: &WorkspaceId,
        budget: &ScanBudget,
        cancel: &CancelFlag,
    ) -> Result<SelectiveReadReport> {
        budget.validate()?;
        let (ws, root) = self.workspace_and_root(workspace_id)?;
        grant::require_active(&root)?;
        let identity = root_identity(&root);
        let listed = reader::inspect_directory(
            std::path::Path::new(&root.path),
            &identity,
            &ws.relative_path,
            budget.max_entries,
            cancel,
        )?;
        let mut sources = Vec::new();
        let mut skipped = Vec::new();
        let mut total = 0_u64;
        if listed.cancelled {
            skipped.push("cancelled".to_string());
        }
        if listed.hit_entry_limit {
            skipped.push("max_entries".to_string());
        }
        for child in listed.children {
            if cancel.is_cancelled() {
                if !skipped.iter().any(|item| item == "cancelled") {
                    skipped.push("cancelled".to_string());
                }
                break;
            }
            let reader::ChildInspect::File { name, .. } = child else {
                continue;
            };
            if !is_key_file(&name) {
                continue;
            }
            if total >= budget.max_total_bytes {
                skipped.push(format!("{name}:max_total_bytes"));
                break;
            }
            let cap = budget.max_file_bytes.min(budget.max_total_bytes - total);
            let rel = if ws.relative_path.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", ws.relative_path, name)
            };
            match read_checked(&root, &ws, &rel, cap) {
                Ok(bytes) => {
                    total += bytes.bytes.len() as u64;
                    let source = self.with_tx(|tx| insert_source(tx, &ws, &name, &bytes))?;
                    sources.push(source);
                }
                Err(err) => skipped.push(format!("{name}:{}", err.code_str())),
            }
        }
        self.with_tx(|tx| {
            tx.execute(
                "UPDATE onboarding_runs
                 SET selective_read_done = 1, state = 'reading', updated_at = ?1
                 WHERE workspace_id = ?2 AND generation = ?3 AND opening_presented = 0",
                params![
                    Utc::now().to_rfc3339(),
                    ws.id.as_str(),
                    ONBOARDING_GENERATION
                ],
            )?;
            Ok(())
        })?;
        Ok(SelectiveReadReport { sources, skipped })
    }

    pub fn list_source_refs(&self, workspace_id: &WorkspaceId) -> Result<Vec<SourceRef>> {
        let (_ws, root) = self.workspace_and_root(workspace_id)?;
        let available = root.status == RootStatus::Active;
        self.with_conn(|conn| load_sources(conn, workspace_id, available))
    }

    pub fn get_source_ref(
        &self,
        workspace_id: &WorkspaceId,
        source_id: &SourceId,
    ) -> Result<SourceRef> {
        self.with_conn(|conn| {
            let owner: Option<String> = conn
                .query_row(
                    "SELECT workspace_id FROM source_refs WHERE id = ?1",
                    params![source_id.as_str()],
                    |row| row.get(0),
                )
                .optional()?;
            match owner {
                None => Err(CoreError::new(
                    ErrorCode::SourceRefNotFound,
                    source_id.as_str(),
                )),
                Some(other) if other != workspace_id.as_str() => Err(CoreError::new(
                    ErrorCode::CrossWorkspaceRef,
                    "source ref belongs to another workspace",
                )),
                Some(_) => {
                    let root = root_for_workspace(conn, workspace_id)?;
                    let available = root.status == RootStatus::Active;
                    let mut source = load_source(conn, workspace_id, source_id)?;
                    if !available {
                        source.excerpt = None;
                        source.content_available = false;
                    }
                    Ok(source)
                }
            }
        })
    }

    pub fn commit_local_scan_card(&self, workspace_id: &WorkspaceId) -> Result<FirstMessage> {
        self.with_tx(|tx| {
            let existing = find_first_message(tx, workspace_id, "local_scan_card")?;
            if let Some(event) = existing {
                let folded = event.presentation == "folded_evidence";
                return Ok(FirstMessage {
                    event,
                    replayed: true,
                    folded_local_card: folded,
                });
            }
            let ws = workspace::load_workspace(tx, workspace_id)?.ok_or_else(|| {
                CoreError::new(ErrorCode::WorkspaceNotFound, workspace_id.as_str())
            })?;
            let checkpoint = load_checkpoint(tx, workspace_id)?;
            let sources = load_sources(tx, workspace_id, true)?;
            let body = build_local_card(&ws, &checkpoint, &sources);
            let source_ids = sources.iter().map(|s| s.id.clone()).collect::<Vec<_>>();
            let event = insert_event(
                tx,
                &ws,
                "local_scan_card",
                Some(ONBOARDING_GENERATION),
                &body,
                "expanded",
                &source_ids,
                None,
            )?;
            let model_status = checkpoint.model_status.clone();
            let next_state = if model_status == "disabled" {
                "waiting_for_model_auth"
            } else {
                "message_ready"
            };
            tx.execute(
                "UPDATE onboarding_runs
                 SET state = ?1, updated_at = ?2
                 WHERE workspace_id = ?3 AND generation = ?4 AND opening_presented = 0",
                params![
                    next_state,
                    Utc::now().to_rfc3339(),
                    ws.id.as_str(),
                    ONBOARDING_GENERATION
                ],
            )?;
            Ok(FirstMessage {
                event,
                replayed: false,
                folded_local_card: false,
            })
        })
    }

    pub fn commit_agent_opening(&self, receipt: &AgentOpeningReceipt) -> Result<FirstMessage> {
        if !receipt.success
            || receipt.body.trim().is_empty()
            || receipt.body.chars().count() > MAX_EVENT_BODY_CHARS
        {
            return Err(CoreError::new(
                ErrorCode::ModelReceiptRejected,
                "opening requires a successful non-empty receipt; core will not invent one",
            ));
        }
        validate_provider_token(&receipt.provider)?;
        validate_provider_token(&receipt.model)?;
        if receipt.receipt_id.trim().is_empty() || receipt.receipt_id.len() > 128 {
            return Err(CoreError::new(
                ErrorCode::ModelReceiptRejected,
                "receipt id missing",
            ));
        }
        self.with_tx(|tx| {
            if let Some(event) =
                find_first_message(tx, &receipt.workspace_id, "agent_opening_message")?
            {
                fold_local_card(tx, &receipt.workspace_id)?;
                return Ok(FirstMessage {
                    event,
                    replayed: true,
                    folded_local_card: true,
                });
            }
            let grant = workspace::load_grant(tx, &receipt.workspace_id, ServiceKind::Model)?
                .ok_or_else(|| {
                    CoreError::new(ErrorCode::ModelNotAuthorized, "model grant missing")
                })?;
            if grant.status != ServiceStatus::Enabled {
                return Err(CoreError::new(
                    ErrorCode::ModelNotAuthorized,
                    "model initial read is not enabled; refusing a fake opening",
                ));
            }
            if let Some(expected) = &grant.provider {
                if expected != &receipt.provider {
                    return Err(CoreError::new(
                        ErrorCode::ProviderMismatch,
                        "receipt provider does not match grant",
                    ));
                }
            }
            for source_id in &receipt.source_ids {
                let owner: Option<String> = tx
                    .query_row(
                        "SELECT workspace_id FROM source_refs WHERE id = ?1",
                        params![source_id.as_str()],
                        |row| row.get(0),
                    )
                    .optional()?;
                match owner {
                    None => {
                        return Err(CoreError::new(
                            ErrorCode::SourceRefNotFound,
                            source_id.as_str(),
                        ));
                    }
                    Some(other) if other != receipt.workspace_id.as_str() => {
                        return Err(CoreError::new(
                            ErrorCode::CrossWorkspaceRef,
                            source_id.as_str(),
                        ));
                    }
                    Some(_) => {}
                }
            }
            let ws = workspace::load_workspace(tx, &receipt.workspace_id)?.ok_or_else(|| {
                CoreError::new(ErrorCode::WorkspaceNotFound, receipt.workspace_id.as_str())
            })?;
            let event = insert_event(
                tx,
                &ws,
                "agent_opening_message",
                Some(ONBOARDING_GENERATION),
                receipt.body.trim(),
                "normal",
                &receipt.source_ids,
                Some(&receipt.receipt_id),
            )?;
            fold_local_card(tx, &ws.id)?;
            let now = Utc::now().to_rfc3339();
            tx.execute(
                "UPDATE onboarding_runs
                 SET state = 'presented', model_analyzed = 1, opening_presented = 1,
                     local_card_folded = 1, model_status = 'receipt_accepted', error_code = NULL,
                     updated_at = ?1
                 WHERE workspace_id = ?2 AND generation = ?3",
                params![now, ws.id.as_str(), ONBOARDING_GENERATION],
            )?;
            Ok(FirstMessage {
                event,
                replayed: false,
                folded_local_card: true,
            })
        })
    }

    pub fn record_model_unavailable(
        &self,
        workspace_id: &WorkspaceId,
        reason: &str,
    ) -> Result<OnboardingCheckpoint> {
        let reason = reason.chars().take(200).collect::<String>();
        self.with_tx(|tx| {
            let current = load_checkpoint(tx, workspace_id)?;
            if current.opening_presented {
                return Err(CoreError::new(
                    ErrorCode::OnboardingAlreadyPresented,
                    "opening already stored",
                ));
            }
            tx.execute(
                "UPDATE onboarding_runs
                 SET state = 'waiting_for_model_auth', model_status = 'unavailable',
                     model_analyzed = 0, error_code = ?1, updated_at = ?2
                 WHERE workspace_id = ?3 AND generation = ?4",
                params![
                    reason,
                    Utc::now().to_rfc3339(),
                    workspace_id.as_str(),
                    ONBOARDING_GENERATION
                ],
            )?;
            load_checkpoint(tx, workspace_id)
        })
    }

    pub fn mark_analyzing(&self, workspace_id: &WorkspaceId) -> Result<OnboardingCheckpoint> {
        self.with_tx(|tx| {
            let current = load_checkpoint(tx, workspace_id)?;
            if current.opening_presented {
                return Err(CoreError::new(
                    ErrorCode::OnboardingAlreadyPresented,
                    workspace_id.as_str(),
                ));
            }
            let grant =
                workspace::load_grant(tx, workspace_id, ServiceKind::Model)?.ok_or_else(|| {
                    CoreError::new(ErrorCode::ModelNotAuthorized, "model grant missing")
                })?;
            if grant.status != ServiceStatus::Enabled {
                return Err(CoreError::new(
                    ErrorCode::ModelNotAuthorized,
                    "model is not enabled",
                ));
            }
            tx.execute(
                "UPDATE onboarding_runs SET state = 'analyzing', updated_at = ?1
                 WHERE workspace_id = ?2 AND generation = ?3",
                params![
                    Utc::now().to_rfc3339(),
                    workspace_id.as_str(),
                    ONBOARDING_GENERATION
                ],
            )?;
            load_checkpoint(tx, workspace_id)
        })
    }

    pub fn cancel_onboarding(&self, workspace_id: &WorkspaceId) -> Result<OnboardingCheckpoint> {
        self.with_tx(|tx| {
            let current = load_checkpoint(tx, workspace_id)?;
            if current.opening_presented {
                return Err(CoreError::new(
                    ErrorCode::OnboardingAlreadyPresented,
                    workspace_id.as_str(),
                ));
            }
            tx.execute(
                "UPDATE onboarding_runs SET state = 'cancelled', updated_at = ?1
                 WHERE workspace_id = ?2 AND generation = ?3",
                params![
                    Utc::now().to_rfc3339(),
                    workspace_id.as_str(),
                    ONBOARDING_GENERATION
                ],
            )?;
            load_checkpoint(tx, workspace_id)
        })
    }

    pub fn retry_onboarding(&self, workspace_id: &WorkspaceId) -> Result<OnboardingCheckpoint> {
        self.with_tx(|tx| {
            let current = load_checkpoint(tx, workspace_id)?;
            if current.opening_presented {
                return Err(CoreError::new(
                    ErrorCode::OnboardingAlreadyPresented,
                    "refusing to re-welcome a presented workspace",
                ));
            }
            if current.state != "cancelled"
                && current.state != "failed"
                && current.model_status != "unavailable"
            {
                return Ok(current);
            }
            tx.execute(
                "UPDATE onboarding_runs
                 SET state = 'workspace_created', error_code = NULL, updated_at = ?1
                 WHERE workspace_id = ?2 AND generation = ?3",
                params![
                    Utc::now().to_rfc3339(),
                    workspace_id.as_str(),
                    ONBOARDING_GENERATION
                ],
            )?;
            load_checkpoint(tx, workspace_id)
        })
    }

    pub fn append_user_message(
        &self,
        workspace_id: &WorkspaceId,
        text: &str,
    ) -> Result<ConversationEvent> {
        let trimmed = text.trim();
        if trimmed.is_empty() || trimmed.chars().count() > MAX_USER_MESSAGE_CHARS {
            return Err(CoreError::new(
                ErrorCode::InvalidMessage,
                "user message empty or too long",
            ));
        }
        self.with_tx(|tx| {
            let ws = workspace::load_workspace(tx, workspace_id)?.ok_or_else(|| {
                CoreError::new(ErrorCode::WorkspaceNotFound, workspace_id.as_str())
            })?;
            insert_event(tx, &ws, "user_message", None, trimmed, "normal", &[], None)
        })
    }

    pub fn list_conversation(&self, workspace_id: &WorkspaceId) -> Result<Vec<ConversationEvent>> {
        self.with_conn(|conn| load_events(conn, workspace_id))
    }

    pub fn onboarding(&self, workspace_id: &WorkspaceId) -> Result<OnboardingCheckpoint> {
        self.with_conn(|conn| load_checkpoint(conn, workspace_id))
    }

    pub fn workspace_overview(&self, workspace_id: &WorkspaceId) -> Result<WorkspaceOverview> {
        let (ws, root) = self.workspace_and_root(workspace_id)?;
        let checkpoint = self.onboarding(workspace_id)?;
        let sources = self.list_source_refs(workspace_id)?;
        Ok(WorkspaceOverview {
            workspace_id: ws.id,
            relative_path: ws.relative_path,
            directory_status: match root.status {
                RootStatus::Active => "active".to_string(),
                RootStatus::Paused => "paused".to_string(),
                RootStatus::Revoked => "revoked".to_string(),
            },
            readable: root.status == RootStatus::Active,
            structure_scanned: checkpoint.structure_scanned,
            selective_read_done: checkpoint.selective_read_done,
            model_analyzed: checkpoint.model_analyzed,
            opening_presented: checkpoint.opening_presented,
            model_inference: false,
            source_ids: sources.into_iter().map(|s| s.id).collect(),
        })
    }

    fn workspace_and_root(
        &self,
        workspace_id: &WorkspaceId,
    ) -> Result<(Workspace, AuthorizedRoot)> {
        self.with_conn(|conn| {
            let ws = workspace::load_workspace(conn, workspace_id)?.ok_or_else(|| {
                CoreError::new(ErrorCode::WorkspaceNotFound, workspace_id.as_str())
            })?;
            let root = root_for_workspace(conn, workspace_id)?;
            Ok((ws, root))
        })
    }
}

struct ReadBytesOwned {
    bytes: Vec<u8>,
    truncated: bool,
}

fn read_checked(
    root: &AuthorizedRoot,
    ws: &Workspace,
    full_rel: &str,
    max_bytes: u64,
) -> Result<ReadBytesOwned> {
    let identity = root_identity(root);
    let current = reader::identify_relative(
        std::path::Path::new(&root.path),
        &identity,
        &ws.relative_path,
    )?;
    if current.dev != ws.dev || current.ino != ws.ino {
        return Err(CoreError::new(
            ErrorCode::GrantIdentityMismatch,
            "workspace directory inode changed",
        ));
    }
    let read = reader::read_file(
        std::path::Path::new(&root.path),
        &identity,
        full_rel,
        max_bytes,
    )?;
    if private_key_bytes(&read.bytes) {
        return Err(CoreError::new(
            ErrorCode::SensitivePath,
            "private key material",
        ));
    }
    Ok(ReadBytesOwned {
        bytes: read.bytes,
        truncated: read.truncated,
    })
}

fn compose_rel(workspace_rel: &str, file_rel: &str) -> Result<String> {
    let mut parts = split_relative(workspace_rel)?;
    parts.extend(split_relative(file_rel)?);
    if parts.is_empty() {
        return Err(CoreError::new(ErrorCode::InvalidPath, "empty file path"));
    }
    Ok(join_relative(&parts))
}

fn root_identity(root: &AuthorizedRoot) -> DirIdentity {
    DirIdentity {
        dev: root.dev.clone(),
        ino: root.ino.clone(),
    }
}

fn insert_source(
    tx: &rusqlite::Transaction<'_>,
    ws: &Workspace,
    relative_path: &str,
    bytes: &ReadBytesOwned,
) -> Result<SourceRef> {
    let hash = hex::encode(Sha256::digest(&bytes.bytes));
    if let Some(existing) = tx
        .query_row(
            "SELECT id, workspace_id, relative_path, content_sha256, byte_len, truncated, binary, excerpt, observed_at
             FROM source_refs WHERE workspace_id = ?1 AND relative_path = ?2 AND content_sha256 = ?3",
            params![ws.id.as_str(), relative_path, hash],
            map_source_row,
        )
        .optional()?
    {
        return Ok(existing);
    }
    let binary = std::str::from_utf8(&bytes.bytes).is_err();
    let excerpt = if binary {
        None
    } else {
        Some(excerpt_of(
            std::str::from_utf8(&bytes.bytes).unwrap_or_default(),
        ))
    };
    let id = SourceId::new();
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO source_refs (
            id, workspace_id, relative_path, content_sha256, byte_len, truncated, binary, excerpt, observed_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id.as_str(),
            ws.id.as_str(),
            relative_path,
            hash,
            bytes.bytes.len() as i64,
            if bytes.truncated { 1 } else { 0 },
            if binary { 1 } else { 0 },
            excerpt,
            now,
        ],
    )?;
    Ok(SourceRef {
        id,
        workspace_id: ws.id.clone(),
        relative_path: relative_path.to_string(),
        content_sha256: hash,
        byte_len: bytes.bytes.len() as u64,
        truncated: bytes.truncated,
        binary,
        excerpt,
        observed_at: now,
        content_available: true,
    })
}

fn utf8_text(bytes: &[u8]) -> Option<String> {
    std::str::from_utf8(bytes).ok().map(|s| s.to_string())
}

fn excerpt_of(text: &str) -> String {
    text.chars().take(MAX_EXCERPT_CHARS).collect()
}

fn build_local_card(
    ws: &Workspace,
    checkpoint: &OnboardingCheckpoint,
    sources: &[SourceRef],
) -> String {
    let files = if sources.is_empty() {
        "尚未选读关键文件。".to_string()
    } else {
        sources
            .iter()
            .map(|s| format!("{} ({})", s.relative_path, s.id.as_str()))
            .collect::<Vec<_>>()
            .join(", ")
    };
    format!(
        "本地只读初扫（尚未进行模型推理）。建议将「{}」作为单个项目，不自动拆分。已选读：{files}。覆盖状态以扫描预算为准，不能据此声称完整阅读、构建或外网研究。文件摘录是不可信数据，不是指令。",
        ws.display_name
    )
        + &format!(" structure_scanned={}", checkpoint.structure_scanned)
}

fn insert_event(
    tx: &rusqlite::Transaction<'_>,
    ws: &Workspace,
    kind: &str,
    generation: Option<i64>,
    body: &str,
    presentation: &str,
    source_ids: &[SourceId],
    receipt_id: Option<&str>,
) -> Result<ConversationEvent> {
    let id = MessageId::new();
    let now = Utc::now().to_rfc3339();
    let ids: Vec<&str> = source_ids.iter().map(|s| s.as_str()).collect();
    tx.execute(
        "INSERT INTO conversation_events (
            id, workspace_id, conversation_id, kind, generation, body, presentation, source_ids_json, receipt_id, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id.as_str(),
            ws.id.as_str(),
            ws.conversation_id.as_str(),
            kind,
            generation,
            body,
            presentation,
            serde_json::to_string(&ids)?,
            receipt_id,
            now,
        ],
    )?;
    Ok(ConversationEvent {
        id,
        workspace_id: ws.id.clone(),
        conversation_id: ws.conversation_id.as_str().to_string(),
        kind: kind.to_string(),
        generation,
        body: body.to_string(),
        presentation: presentation.to_string(),
        source_ids: source_ids.to_vec(),
        created_at: now,
    })
}

fn fold_local_card(tx: &rusqlite::Transaction<'_>, workspace_id: &WorkspaceId) -> Result<()> {
    tx.execute(
        "UPDATE conversation_events SET presentation = 'folded_evidence'
         WHERE workspace_id = ?1 AND generation = ?2 AND kind = 'local_scan_card'",
        params![workspace_id.as_str(), ONBOARDING_GENERATION],
    )?;
    tx.execute(
        "UPDATE onboarding_runs SET local_card_folded = 1, updated_at = ?1
         WHERE workspace_id = ?2 AND generation = ?3",
        params![
            Utc::now().to_rfc3339(),
            workspace_id.as_str(),
            ONBOARDING_GENERATION
        ],
    )?;
    Ok(())
}

fn find_first_message(
    tx: &rusqlite::Transaction<'_>,
    workspace_id: &WorkspaceId,
    kind: &str,
) -> Result<Option<ConversationEvent>> {
    tx.query_row(
        "SELECT id, workspace_id, conversation_id, kind, generation, body, presentation, source_ids_json, created_at
         FROM conversation_events
         WHERE workspace_id = ?1 AND kind = ?2 AND generation = ?3",
        params![workspace_id.as_str(), kind, ONBOARDING_GENERATION],
        map_event,
    )
    .optional()
    .map_err(CoreError::from)
}

fn load_events(
    conn: &rusqlite::Connection,
    workspace_id: &WorkspaceId,
) -> Result<Vec<ConversationEvent>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, conversation_id, kind, generation, body, presentation, source_ids_json, created_at
         FROM conversation_events WHERE workspace_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map(params![workspace_id.as_str()], map_event)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn map_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationEvent> {
    let ids: String = row.get(7)?;
    let parsed: Vec<String> = serde_json::from_str(&ids).unwrap_or_default();
    Ok(ConversationEvent {
        id: MessageId::from_trusted(row.get(0)?),
        workspace_id: WorkspaceId::from_trusted(row.get(1)?),
        conversation_id: row.get(2)?,
        kind: row.get(3)?,
        generation: row.get(4)?,
        body: row.get(5)?,
        presentation: row.get(6)?,
        source_ids: parsed.into_iter().map(SourceId::from_trusted).collect(),
        created_at: row.get(8)?,
    })
}

fn load_checkpoint(
    conn: &rusqlite::Connection,
    workspace_id: &WorkspaceId,
) -> Result<OnboardingCheckpoint> {
    conn.query_row(
        "SELECT workspace_id, generation, state, structure_scanned, selective_read_done, model_analyzed,
                opening_presented, local_card_folded, model_status, error_code
         FROM onboarding_runs WHERE workspace_id = ?1 AND generation = ?2",
        params![workspace_id.as_str(), ONBOARDING_GENERATION],
        |row| {
            Ok(OnboardingCheckpoint {
                workspace_id: WorkspaceId::from_trusted(row.get(0)?),
                generation: row.get(1)?,
                state: row.get(2)?,
                structure_scanned: row.get::<_, i64>(3)? == 1,
                selective_read_done: row.get::<_, i64>(4)? == 1,
                model_analyzed: row.get::<_, i64>(5)? == 1,
                opening_presented: row.get::<_, i64>(6)? == 1,
                local_card_folded: row.get::<_, i64>(7)? == 1,
                model_status: row.get(8)?,
                error_code: row.get(9)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| CoreError::new(ErrorCode::OnboardingNotFound, workspace_id.as_str()))
}

fn load_sources(
    conn: &rusqlite::Connection,
    workspace_id: &WorkspaceId,
    available: bool,
) -> Result<Vec<SourceRef>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, relative_path, content_sha256, byte_len, truncated, binary, excerpt, observed_at
         FROM source_refs WHERE workspace_id = ?1 ORDER BY observed_at, id",
    )?;
    let rows = stmt.query_map(params![workspace_id.as_str()], map_source_row)?;
    let mut out = Vec::new();
    for row in rows {
        let mut source = row?;
        source.content_available = available;
        if !available {
            source.excerpt = None;
        }
        out.push(source);
    }
    Ok(out)
}

fn load_source(
    conn: &rusqlite::Connection,
    workspace_id: &WorkspaceId,
    source_id: &SourceId,
) -> Result<SourceRef> {
    conn.query_row(
        "SELECT id, workspace_id, relative_path, content_sha256, byte_len, truncated, binary, excerpt, observed_at
         FROM source_refs WHERE workspace_id = ?1 AND id = ?2",
        params![workspace_id.as_str(), source_id.as_str()],
        map_source_row,
    )
    .optional()?
    .ok_or_else(|| CoreError::new(ErrorCode::SourceRefNotFound, source_id.as_str()))
}

fn map_source_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SourceRef> {
    Ok(SourceRef {
        id: SourceId::from_trusted(row.get(0)?),
        workspace_id: WorkspaceId::from_trusted(row.get(1)?),
        relative_path: row.get(2)?,
        content_sha256: row.get(3)?,
        byte_len: row.get::<_, i64>(4)? as u64,
        truncated: row.get::<_, i64>(5)? == 1,
        binary: row.get::<_, i64>(6)? == 1,
        excerpt: row.get(7)?,
        observed_at: row.get(8)?,
        content_available: true,
    })
}

fn root_for_workspace(
    conn: &rusqlite::Connection,
    workspace_id: &WorkspaceId,
) -> Result<AuthorizedRoot> {
    let root_id: String = conn.query_row(
        "SELECT root_id FROM workspaces WHERE id = ?1",
        params![workspace_id.as_str()],
        |row| row.get(0),
    )?;
    grant::load_root(conn, &crate::ids::RootId::from_trusted(root_id))?
        .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "root missing for workspace"))
}
