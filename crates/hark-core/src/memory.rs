//! Workspace notes for identity, decision, and experience.
//!
//! Chat text stays in `conversation_events`. A decision is stored here only
//! after the cited same-workspace user wording supports it. File excerpts are
//! the stored `source_refs` text; this module does not open files or ask a model.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, ErrorCode, Result};
use crate::grant::{self, RootStatus};
use crate::ids::{MessageId, RunId, WorkspaceId};
use crate::limits::{MAX_MEMORY_LIST, MAX_MEMORY_TEXT_CHARS, MAX_OPINION_LIST_ITEMS};
use crate::messages;
use crate::policy::looks_like_secret_text;
use crate::search::{self, SearchDoc};
use crate::support::{
    explicit_experience_confirmation, file_quote_supports, normalize_match, text_supports,
};
use crate::workspace;
use crate::Core;

pub const OUTCOME_COMMITTED: &str = "committed";
pub const OUTCOME_NOOP: &str = "noop";
pub const OUTCOME_NEEDS_CLARIFICATION: &str = "needs_clarification";
pub const OUTCOME_CONFLICT: &str = "conflict";
pub const OUTCOME_REVERTED: &str = "reverted";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum MemoryOperation {
    Add,
    Revise,
    Dispute,
    Noop,
    Retract,
}

impl MemoryOperation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Add => "ADD",
            Self::Revise => "REVISE",
            Self::Dispute => "DISPUTE",
            Self::Noop => "NOOP",
            Self::Retract => "RETRACT",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryNoteKind {
    Identity,
    Decision,
    Experience,
}

impl MemoryNoteKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Identity => "identity",
            Self::Decision => "decision",
            Self::Experience => "experience",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MemoryCaller {
    User,
    Host,
    AgentRun { run_id: RunId },
}

/// Trusted Host/Native context. Not a field the model is allowed to fill.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCallContext {
    pub workspace_id: WorkspaceId,
    pub operation_id: String,
    #[serde(default)]
    pub current_user_message_id: Option<MessageId>,
    pub caller: MemoryCaller,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryChangeProposal {
    pub operation: MemoryOperation,
    pub kind: MemoryNoteKind,
    pub content: String,
    #[serde(default)]
    pub source_refs: Vec<String>,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRevisionEntry {
    pub revision: i64,
    pub status: String,
    pub note: String,
    pub content: String,
    pub historical: bool,
    pub support: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryNote {
    pub id: String,
    pub workspace_id: WorkspaceId,
    pub kind: String,
    pub text: String,
    pub source_refs: Vec<String>,
    pub revision: i64,
    pub status: String,
    pub observed_at: String,
    pub supersedes_revision_id: Option<String>,
    pub support: String,
    pub status_label: String,
    /// Head is the current state. Historical revisions are in `history`.
    pub historical: bool,
    pub history: Vec<MemoryRevisionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReceipt {
    pub outcome: String,
    /// True only when this operation appended a current memory revision.
    pub recorded: bool,
    pub replayed: bool,
    pub operation_id: String,
    pub workspace_id: WorkspaceId,
    pub domain: String,
    pub memory_id: Option<String>,
    pub opinion_id: Option<String>,
    pub revision_id: Option<String>,
    pub revision: Option<i64>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub content: Option<String>,
    pub decision_title: Option<String>,
    pub decision_summary: Option<String>,
    pub committed_at: Option<String>,
    pub source_message_id: Option<String>,
    pub source_ids: Vec<String>,
    /// User wording kept when the proposal was not committed.
    pub retained_quote: Option<String>,
    pub reverted: bool,
    pub still_current: bool,
    pub current_revision: Option<i64>,
    pub current_status: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredReceipt {
    pub outcome: String,
    pub recorded: bool,
    pub operation_id: String,
    pub workspace_id: String,
    pub domain: String,
    pub memory_id: Option<String>,
    pub opinion_id: Option<String>,
    pub revision_id: Option<String>,
    pub revision: Option<i64>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub content: Option<String>,
    pub decision_title: Option<String>,
    pub source_message_id: Option<String>,
    pub source_ids: Vec<String>,
    pub retained_quote: Option<String>,
    pub detail: String,
    pub reverted: bool,
    pub support: Option<String>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct Head {
    memory_id: String,
    kind: String,
    revision: i64,
    revision_id: String,
    status: String,
    content: String,
    support: String,
    note: String,
    operation: String,
    source_json: String,
    supersedes_revision_id: Option<String>,
    created_at: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedRef {
    pub id: String,
    pub kind: String,
    pub text: String,
}

enum Support {
    Ok {
        support: String,
        source_ids: Vec<String>,
        message_id: Option<String>,
    },
    Clarify {
        detail: String,
        quote: Option<String>,
        source_ids: Vec<String>,
    },
}

impl Core {
    pub fn memory_propose_change(
        &self,
        ctx: &MemoryCallContext,
        proposal: &MemoryChangeProposal,
    ) -> Result<MemoryReceipt> {
        let operation_id = validate_operation_key(&ctx.operation_id)?;
        self.with_tx(|tx| propose_tx(tx, ctx, proposal, &operation_id))
    }

    pub fn get_memory(&self, workspace_id: &WorkspaceId, memory_id: &str) -> Result<MemoryNote> {
        self.with_conn(|conn| {
            require_workspace(conn, workspace_id)?;
            load_note(conn, workspace_id, memory_id)?
                .ok_or_else(|| CoreError::new(ErrorCode::NotFound, memory_id))
        })
    }

    pub fn list_workspace_memories(&self, workspace_id: &WorkspaceId) -> Result<Vec<MemoryNote>> {
        self.with_conn(|conn| {
            require_workspace(conn, workspace_id)?;
            let mut stmt = conn.prepare(
                "SELECT id FROM workspace_memories WHERE workspace_id = ?1
                 ORDER BY created_at, id LIMIT ?2",
            )?;
            let ids: Vec<String> = stmt
                .query_map(
                    params![workspace_id.as_str(), MAX_MEMORY_LIST as i64],
                    |row| row.get(0),
                )?
                .collect::<std::result::Result<_, _>>()?;
            let mut notes = Vec::new();
            for id in ids {
                if let Some(note) = load_note(conn, workspace_id, &id)? {
                    notes.push(note);
                }
            }
            Ok(notes)
        })
    }

    pub fn memory_receipt_by_operation(
        &self,
        workspace_id: &WorkspaceId,
        operation_id: &str,
    ) -> Result<Option<MemoryReceipt>> {
        let operation_id = validate_operation_key(operation_id)?;
        self.with_conn(|conn| {
            require_workspace(conn, workspace_id)?;
            let Some(stored) = load_receipt(conn, workspace_id, &operation_id, "memory")? else {
                return Ok(None);
            };
            Ok(Some(receipt_from_stored(conn, stored, true)?))
        })
    }

    pub fn revert_memory_operation(
        &self,
        workspace_id: &WorkspaceId,
        operation_id: &str,
    ) -> Result<MemoryReceipt> {
        let operation_id = validate_operation_key(operation_id)?;
        self.with_tx(|tx| revert_tx(tx, workspace_id, &operation_id))
    }
}

pub(crate) fn validate_operation_key(value: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "operation id empty or too long",
        ));
    }
    if trimmed.chars().any(|ch| ch.is_control()) || looks_like_secret_text(trimmed) {
        return Err(CoreError::new(
            ErrorCode::SecretMaterialRejected,
            "operation id is not a stable idempotency key",
        ));
    }
    Ok(trimmed.to_string())
}

pub(crate) fn require_workspace(conn: &Connection, workspace_id: &WorkspaceId) -> Result<()> {
    if workspace::load_workspace(conn, workspace_id)?.is_none() {
        return Err(CoreError::new(
            ErrorCode::WorkspaceNotFound,
            workspace_id.as_str(),
        ));
    }
    Ok(())
}

pub(crate) fn store_receipt(tx: &Transaction<'_>, stored: &StoredReceipt) -> Result<()> {
    tx.execute(
        "INSERT INTO memory_write_receipts (
            workspace_id, operation_id, domain, outcome, receipt_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            stored.workspace_id,
            stored.operation_id,
            stored.domain,
            stored.outcome,
            serde_json::to_string(stored)?,
            Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

pub(crate) fn load_receipt(
    conn: &Connection,
    workspace_id: &WorkspaceId,
    operation_id: &str,
    domain: &str,
) -> Result<Option<StoredReceipt>> {
    let json: Option<String> = conn
        .query_row(
            "SELECT receipt_json FROM memory_write_receipts
             WHERE workspace_id = ?1 AND operation_id = ?2 AND domain = ?3",
            params![workspace_id.as_str(), operation_id, domain],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|value| serde_json::from_str(&value).map_err(CoreError::from))
        .transpose()
}

fn propose_tx(
    tx: &Transaction<'_>,
    ctx: &MemoryCallContext,
    proposal: &MemoryChangeProposal,
    operation_id: &str,
) -> Result<MemoryReceipt> {
    require_workspace(tx, &ctx.workspace_id)?;
    if let Some(stored) = load_receipt(tx, &ctx.workspace_id, operation_id, "memory")? {
        return receipt_from_stored(tx, stored, true);
    }
    let _caller = caller_label(tx, &ctx.workspace_id, &ctx.caller)?;
    let receipt = match proposal.operation {
        MemoryOperation::Noop => noop_tx(tx, ctx, proposal, operation_id)?,
        MemoryOperation::Add => add_tx(tx, ctx, proposal, operation_id)?,
        MemoryOperation::Revise => change_tx(tx, ctx, proposal, operation_id, "REVISE")?,
        MemoryOperation::Dispute => change_tx(tx, ctx, proposal, operation_id, "DISPUTE")?,
        MemoryOperation::Retract => retract_tx(tx, ctx, proposal, operation_id)?,
    };
    let stored = stored_from_receipt(&receipt);
    store_receipt(tx, &stored)?;
    Ok(receipt)
}

fn add_tx(
    tx: &Transaction<'_>,
    ctx: &MemoryCallContext,
    proposal: &MemoryChangeProposal,
    operation_id: &str,
) -> Result<MemoryReceipt> {
    if proposal.target_id.is_some() || proposal.expected_revision.is_some() {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "ADD does not take targetId or expectedRevision",
        ));
    }
    let content = validate_content(&proposal.content)?;
    let refs = resolve_refs(
        tx,
        &ctx.workspace_id,
        &proposal.source_refs,
        ctx.current_user_message_id.as_ref().map(|id| id.as_str()),
    )?;
    match support_for(proposal.kind, &content, &refs, None)? {
        Support::Clarify {
            detail,
            quote,
            source_ids,
        } => Ok(clarify_receipt(
            ctx,
            operation_id,
            detail,
            quote,
            source_ids,
        )),
        Support::Ok {
            support,
            source_ids,
            message_id,
        } => {
            if let Some(existing) =
                find_active_duplicate(tx, &ctx.workspace_id, proposal.kind, &content)?
            {
                return Ok(noop_existing(
                    ctx,
                    operation_id,
                    &existing,
                    "noop: same content is already current",
                ));
            }
            let memory_id = format!("mem_{}", uuid_hex());
            let revision_id = format!("rev_{}", uuid_hex());
            let now = Utc::now().to_rfc3339();
            let caller = caller_label(tx, &ctx.workspace_id, &ctx.caller)?;
            tx.execute(
                "INSERT INTO workspace_memories (id, workspace_id, kind, head_revision, created_at)
                 VALUES (?1, ?2, ?3, 1, ?4)",
                params![
                    memory_id,
                    ctx.workspace_id.as_str(),
                    proposal.kind.as_str(),
                    now
                ],
            )?;
            insert_revision(
                tx,
                &revision_id,
                &memory_id,
                ctx.workspace_id.as_str(),
                1,
                "ADD",
                "active",
                &content,
                &support,
                "",
                None,
                operation_id,
                &caller,
                false,
                &source_json(&refs)?,
                &now,
            )?;
            project_memory(
                tx,
                &revision_id,
                ctx.workspace_id.as_str(),
                &memory_id,
                proposal.kind.as_str(),
                &content,
                "active",
                false,
                &now,
                message_id.as_deref(),
            )?;
            Ok(committed_receipt(
                ctx,
                operation_id,
                &memory_id,
                &revision_id,
                1,
                proposal.kind.as_str(),
                "active",
                &content,
                &source_ids,
                message_id,
                &now,
                "committed",
            ))
        }
    }
}

fn change_tx(
    tx: &Transaction<'_>,
    ctx: &MemoryCallContext,
    proposal: &MemoryChangeProposal,
    operation_id: &str,
    operation: &str,
) -> Result<MemoryReceipt> {
    let content = validate_content(&proposal.content)?;
    let target = proposal
        .target_id
        .as_deref()
        .ok_or_else(|| CoreError::new(ErrorCode::InvalidMessage, "targetId required"))?;
    let expected = proposal
        .expected_revision
        .ok_or_else(|| CoreError::new(ErrorCode::InvalidMessage, "expectedRevision required"))?;
    if proposal.kind == MemoryNoteKind::Decision && ctx.current_user_message_id.is_none() {
        return Ok(clarify_receipt(
            ctx,
            operation_id,
            "needs_clarification: a decision change requires the current user message".to_string(),
            None,
            Vec::new(),
        ));
    }
    let head = require_head(tx, &ctx.workspace_id, target)?;
    if head.kind != proposal.kind.as_str() {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "kind does not match the stored memory",
        ));
    }
    if head.revision != expected {
        return Ok(conflict_receipt(ctx, operation_id, &head));
    }
    let refs = resolve_refs(
        tx,
        &ctx.workspace_id,
        &proposal.source_refs,
        ctx.current_user_message_id.as_ref().map(|id| id.as_str()),
    )?;
    let current_id = ctx.current_user_message_id.as_ref().map(|id| id.as_str());
    match support_for(proposal.kind, &content, &refs, current_id)? {
        Support::Clarify {
            detail,
            quote,
            source_ids,
        } => Ok(clarify_receipt(
            ctx,
            operation_id,
            detail,
            quote,
            source_ids,
        )),
        Support::Ok {
            support,
            source_ids,
            message_id,
        } => {
            if operation == "REVISE" && normalize_match(&content) == normalize_match(&head.content)
            {
                return Ok(noop_existing(
                    ctx,
                    operation_id,
                    &head,
                    "noop: revision text is unchanged",
                ));
            }
            let status = if operation == "DISPUTE" {
                "disputed"
            } else {
                "active"
            };
            append_head(
                tx,
                ctx,
                operation_id,
                &head,
                operation,
                status,
                &content,
                &support,
                if operation == "DISPUTE" {
                    "争议记录。未判定哪一方正确。"
                } else {
                    ""
                },
                &source_json(&refs)?,
                &source_ids,
                message_id,
                "committed",
            )
        }
    }
}

fn retract_tx(
    tx: &Transaction<'_>,
    ctx: &MemoryCallContext,
    proposal: &MemoryChangeProposal,
    operation_id: &str,
) -> Result<MemoryReceipt> {
    let target = proposal
        .target_id
        .as_deref()
        .ok_or_else(|| CoreError::new(ErrorCode::InvalidMessage, "targetId required"))?;
    let expected = proposal
        .expected_revision
        .ok_or_else(|| CoreError::new(ErrorCode::InvalidMessage, "expectedRevision required"))?;
    let head = require_head(tx, &ctx.workspace_id, target)?;
    if head.kind != proposal.kind.as_str() {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "kind does not match the stored memory",
        ));
    }
    if head.revision != expected {
        return Ok(conflict_receipt(ctx, operation_id, &head));
    }
    if head.status == "retracted" {
        return Ok(noop_existing(
            ctx,
            operation_id,
            &head,
            "noop: already retracted",
        ));
    }
    append_head(
        tx,
        ctx,
        operation_id,
        &head,
        "RETRACT",
        "retracted",
        &head.content,
        &head.support,
        "撤回保留原文，不物理删除历史。",
        &head.source_json,
        &source_ids_from_json(&head.source_json),
        None,
        "committed",
    )
}

fn noop_tx(
    tx: &Transaction<'_>,
    ctx: &MemoryCallContext,
    proposal: &MemoryChangeProposal,
    operation_id: &str,
) -> Result<MemoryReceipt> {
    if let Some(target) = proposal.target_id.as_deref() {
        let head = require_head(tx, &ctx.workspace_id, target)?;
        return Ok(noop_existing(ctx, operation_id, &head, "noop"));
    }
    Ok(MemoryReceipt {
        outcome: OUTCOME_NOOP.to_string(),
        recorded: false,
        replayed: false,
        operation_id: operation_id.to_string(),
        workspace_id: ctx.workspace_id.clone(),
        domain: "memory".to_string(),
        memory_id: None,
        opinion_id: None,
        revision_id: None,
        revision: None,
        kind: Some(proposal.kind.as_str().to_string()),
        status: None,
        content: None,
        decision_title: None,
        decision_summary: None,
        committed_at: None,
        source_message_id: None,
        source_ids: Vec::new(),
        retained_quote: None,
        reverted: false,
        still_current: false,
        current_revision: None,
        current_status: None,
        detail: "noop".to_string(),
    })
}

fn append_head(
    tx: &Transaction<'_>,
    ctx: &MemoryCallContext,
    operation_id: &str,
    head: &Head,
    operation: &str,
    status: &str,
    content: &str,
    support: &str,
    note: &str,
    source_json: &str,
    source_ids: &[String],
    message_id: Option<String>,
    detail: &str,
) -> Result<MemoryReceipt> {
    let next = head.revision + 1;
    let revision_id = format!("rev_{}", uuid_hex());
    let now = Utc::now().to_rfc3339();
    let caller = caller_label(tx, &ctx.workspace_id, &ctx.caller)?;
    insert_revision(
        tx,
        &revision_id,
        &head.memory_id,
        ctx.workspace_id.as_str(),
        next,
        operation,
        status,
        content,
        support,
        note,
        Some(&head.revision_id),
        operation_id,
        &caller,
        false,
        source_json,
        &now,
    )?;
    let changed = tx.execute(
        "UPDATE workspace_memories SET head_revision = ?1
         WHERE id = ?2 AND workspace_id = ?3 AND head_revision = ?4",
        params![
            next,
            head.memory_id,
            ctx.workspace_id.as_str(),
            head.revision
        ],
    )?;
    if changed != 1 {
        return Err(CoreError::new(
            ErrorCode::ConflictRevision,
            "memory head changed during update",
        ));
    }
    tx.execute(
        "UPDATE memory_revisions SET historical = 1 WHERE id = ?1",
        params![head.revision_id],
    )?;
    search::mark_historical(
        tx,
        &search::memory_doc_id(&head.revision_id),
        "历史修订，不是当前决定",
    )?;
    project_memory(
        tx,
        &revision_id,
        ctx.workspace_id.as_str(),
        &head.memory_id,
        &head.kind,
        content,
        status,
        false,
        &now,
        message_id.as_deref(),
    )?;
    Ok(committed_receipt(
        ctx,
        operation_id,
        &head.memory_id,
        &revision_id,
        next,
        &head.kind,
        status,
        content,
        source_ids,
        message_id,
        &now,
        detail,
    ))
}

fn revert_tx(
    tx: &Transaction<'_>,
    workspace_id: &WorkspaceId,
    operation_id: &str,
) -> Result<MemoryReceipt> {
    require_workspace(tx, workspace_id)?;
    if let Some(stored) = load_receipt(tx, workspace_id, operation_id, "revert")? {
        return receipt_from_stored(tx, stored, true);
    }
    let stored = committed_for_revert(tx, workspace_id, operation_id)?;
    let receipt = match stored.domain.as_str() {
        "memory" => revert_memory(tx, workspace_id, &stored)?,
        "opinion" | "feedback" => crate::opinion::revert_committed(tx, workspace_id, &stored)?,
        _ => {
            return Err(CoreError::new(
                ErrorCode::NotFound,
                "operation did not commit",
            ))
        }
    };
    store_receipt(tx, &stored_from_receipt(&receipt))?;
    Ok(receipt)
}

fn revert_memory(
    tx: &Transaction<'_>,
    workspace_id: &WorkspaceId,
    stored: &StoredReceipt,
) -> Result<MemoryReceipt> {
    let memory_id = stored
        .memory_id
        .as_deref()
        .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "memory receipt has no memory id"))?;
    let written = stored
        .revision
        .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "memory receipt has no revision"))?;
    let head = require_head(tx, workspace_id, memory_id)?;
    if head.revision != written {
        return Err(CoreError::new(
            ErrorCode::ConflictRevision,
            format!(
                "memory {} head is revision {}, operation wrote {}; not overwriting",
                memory_id, head.revision, written
            ),
        ));
    }
    let ctx = MemoryCallContext {
        workspace_id: workspace_id.clone(),
        operation_id: stored.operation_id.clone(),
        current_user_message_id: None,
        caller: MemoryCaller::Host,
    };
    if head.operation == "ADD" || head.revision == 1 {
        let mut receipt = append_head(
            tx,
            &ctx,
            &stored.operation_id,
            &head,
            "RETRACT",
            "retracted",
            &head.content,
            &head.support,
            "撤销该写入。原文保留为历史，未物理删除。",
            &head.source_json,
            &stored.source_ids,
            stored.source_message_id.clone(),
            "reverted",
        )?;
        receipt.outcome = OUTCOME_REVERTED.to_string();
        receipt.recorded = false;
        receipt.reverted = true;
        receipt.domain = "revert".to_string();
        receipt.detail = "reverted by a new revision; history retained".to_string();
        return Ok(receipt);
    }
    let previous = load_revision_number(tx, memory_id, head.revision - 1)?
        .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "previous memory revision missing"))?;
    let mut receipt = append_head(
        tx,
        &ctx,
        &stored.operation_id,
        &head,
        "RESTORE",
        &previous.status,
        &previous.content,
        &previous.support,
        "撤销后恢复上一版。被撤销的修订仍保留。",
        &previous.source_json,
        &source_ids_from_json(&previous.source_json),
        stored.source_message_id.clone(),
        "reverted",
    )?;
    receipt.outcome = OUTCOME_REVERTED.to_string();
    receipt.recorded = false;
    receipt.reverted = true;
    receipt.domain = "revert".to_string();
    receipt.detail = "restored previous revision; later text was not overwritten".to_string();
    Ok(receipt)
}

fn committed_for_revert(
    tx: &Transaction<'_>,
    workspace_id: &WorkspaceId,
    operation_id: &str,
) -> Result<StoredReceipt> {
    for domain in ["memory", "opinion", "feedback"] {
        if let Some(stored) = load_receipt(tx, workspace_id, operation_id, domain)? {
            if stored.outcome == OUTCOME_COMMITTED && stored.recorded {
                return Ok(stored);
            }
            return Err(CoreError::new(
                ErrorCode::InvalidMessage,
                "operation did not commit; nothing to revert",
            ));
        }
    }
    Err(CoreError::new(
        ErrorCode::NotFound,
        "memory operation not found",
    ))
}

fn support_for(
    kind: MemoryNoteKind,
    content: &str,
    refs: &[ResolvedRef],
    revise_current: Option<&str>,
) -> Result<Support> {
    let source_ids: Vec<String> = refs.iter().map(|item| item.id.clone()).collect();
    let quote = refs
        .iter()
        .find(|item| item.kind == "user_message")
        .map(|item| item.text.clone());
    match kind {
        MemoryNoteKind::Decision => {
            let messages: Vec<&ResolvedRef> = if let Some(current) = revise_current {
                let matched: Vec<&ResolvedRef> = refs
                    .iter()
                    .filter(|item| item.kind == "user_message" && item.id == current)
                    .collect();
                if matched.is_empty() {
                    return Ok(Support::Clarify {
                        detail: "needs_clarification: decision revise requires the current user message, not an older id".to_string(),
                        quote,
                        source_ids,
                    });
                }
                matched
            } else {
                refs.iter()
                    .filter(|item| item.kind == "user_message")
                    .collect()
            };
            if messages.is_empty() {
                return Ok(Support::Clarify {
                    detail: "needs_clarification: a decision needs a same-workspace user message; a file or current message id alone cannot endorse it".to_string(),
                    quote: None,
                    source_ids,
                });
            }
            if messages
                .iter()
                .any(|item| text_supports(content, &item.text))
            {
                Ok(Support::Ok {
                    support: "user_quote".to_string(),
                    message_id: messages.first().map(|item| item.id.clone()),
                    source_ids,
                })
            } else {
                Ok(Support::Clarify {
                    detail: "needs_clarification: decision text is not supported by the cited user wording".to_string(),
                    quote: messages.first().map(|item| item.text.clone()),
                    source_ids,
                })
            }
        }
        MemoryNoteKind::Identity => {
            if let Some(message) = refs
                .iter()
                .find(|item| item.kind == "user_message" && text_supports(content, &item.text))
            {
                return Ok(Support::Ok {
                    support: "user_quote".to_string(),
                    message_id: Some(message.id.clone()),
                    source_ids,
                });
            }
            if let Some(file) = refs
                .iter()
                .find(|item| item.kind == "source_ref" && file_quote_supports(content, &item.text))
            {
                return Ok(Support::Ok {
                    support: "file_excerpt".to_string(),
                    message_id: None,
                    source_ids: vec![file.id.clone()],
                });
            }
            Ok(Support::Clarify {
                detail: "needs_clarification: identity is not a quote of the user message or stored file excerpt".to_string(),
                quote,
                source_ids,
            })
        }
        MemoryNoteKind::Experience => {
            let confirmed = refs.iter().find(|item| {
                item.kind == "user_message"
                    && revise_current.is_none_or(|current| item.id == current)
                    && explicit_experience_confirmation(&item.text)
                    && text_supports(content, &item.text)
            });
            if let Some(message) = confirmed {
                Ok(Support::Ok {
                    support: "user_quote".to_string(),
                    message_id: Some(message.id.clone()),
                    source_ids,
                })
            } else {
                Ok(Support::Clarify {
                    detail: "needs_clarification: one observation is not a method or a global preference".to_string(),
                    quote,
                    source_ids,
                })
            }
        }
    }
}

pub(crate) fn resolve_refs(
    conn: &Connection,
    workspace_id: &WorkspaceId,
    ids: &[String],
    current_user_message_id: Option<&str>,
) -> Result<Vec<ResolvedRef>> {
    let mut ordered = Vec::new();
    if let Some(current) = current_user_message_id {
        ordered.push(current.to_string());
    }
    for id in ids {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(CoreError::new(
                ErrorCode::InvalidMessage,
                "empty source ref",
            ));
        }
        if !ordered.iter().any(|existing| existing == trimmed) {
            ordered.push(trimmed.to_string());
        }
    }
    if ordered.len() > MAX_OPINION_LIST_ITEMS {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "too many source refs",
        ));
    }
    if ordered.is_empty() {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "at least one source ref or current user message is required",
        ));
    }
    let mut out = Vec::new();
    for id in ordered {
        out.push(resolve_one(conn, workspace_id, &id)?);
    }
    Ok(out)
}

fn resolve_one(conn: &Connection, workspace_id: &WorkspaceId, id: &str) -> Result<ResolvedRef> {
    let source: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT workspace_id, excerpt FROM source_refs WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((owner, excerpt)) = source {
        if owner != workspace_id.as_str() {
            return Err(CoreError::new(ErrorCode::CrossWorkspaceRef, id));
        }
        let root = messages::root_for_workspace(conn, workspace_id)?;
        if root.status != RootStatus::Active {
            grant::require_active(&root)?;
        }
        return Ok(ResolvedRef {
            id: id.to_string(),
            kind: "source_ref".to_string(),
            text: excerpt.unwrap_or_default(),
        });
    }
    let event: Option<(String, String, String)> = conn
        .query_row(
            "SELECT workspace_id, kind, body FROM conversation_events WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if let Some((owner, kind, body)) = event {
        if owner != workspace_id.as_str() {
            return Err(CoreError::new(ErrorCode::CrossWorkspaceRef, id));
        }
        let resolved_kind = if kind == "user_message" {
            "user_message"
        } else {
            "conversation"
        };
        return Ok(ResolvedRef {
            id: id.to_string(),
            kind: resolved_kind.to_string(),
            text: body,
        });
    }
    Err(CoreError::new(ErrorCode::SourceRefNotFound, id))
}

fn require_head(conn: &Connection, workspace_id: &WorkspaceId, memory_id: &str) -> Result<Head> {
    load_head(conn, workspace_id, memory_id)?
        .ok_or_else(|| CoreError::new(ErrorCode::NotFound, memory_id))
}

fn load_head(
    conn: &Connection,
    workspace_id: &WorkspaceId,
    memory_id: &str,
) -> Result<Option<Head>> {
    let owner: Option<String> = conn
        .query_row(
            "SELECT workspace_id FROM workspace_memories WHERE id = ?1",
            params![memory_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(owner) = owner else {
        return Ok(None);
    };
    if owner != workspace_id.as_str() {
        return Err(CoreError::new(ErrorCode::CrossWorkspaceRef, memory_id));
    }
    conn.query_row(
        "SELECT m.id, m.kind, r.revision, r.id, r.status, r.content, r.support, r.note,
                r.operation, r.source_json, r.supersedes_revision_id, r.created_at
         FROM workspace_memories m
         JOIN memory_revisions r ON r.memory_id = m.id AND r.revision = m.head_revision
         WHERE m.id = ?1 AND m.workspace_id = ?2",
        params![memory_id, workspace_id.as_str()],
        map_head,
    )
    .optional()
    .map_err(CoreError::from)
}

fn load_revision_number(conn: &Connection, memory_id: &str, revision: i64) -> Result<Option<Head>> {
    conn.query_row(
        "SELECT r.memory_id, m.kind, r.revision, r.id, r.status, r.content, r.support, r.note,
                r.operation, r.source_json, r.supersedes_revision_id, r.created_at
         FROM memory_revisions r
         JOIN workspace_memories m ON m.id = r.memory_id
         WHERE r.memory_id = ?1 AND r.revision = ?2",
        params![memory_id, revision],
        map_head,
    )
    .optional()
    .map_err(CoreError::from)
}

fn map_head(row: &rusqlite::Row<'_>) -> rusqlite::Result<Head> {
    Ok(Head {
        memory_id: row.get(0)?,
        kind: row.get(1)?,
        revision: row.get(2)?,
        revision_id: row.get(3)?,
        status: row.get(4)?,
        content: row.get(5)?,
        support: row.get(6)?,
        note: row.get(7)?,
        operation: row.get(8)?,
        source_json: row.get(9)?,
        supersedes_revision_id: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn find_active_duplicate(
    conn: &Connection,
    workspace_id: &WorkspaceId,
    kind: MemoryNoteKind,
    content: &str,
) -> Result<Option<Head>> {
    let wanted = normalize_match(content);
    let mut stmt = conn.prepare(
        "SELECT m.id, m.kind, r.revision, r.id, r.status, r.content, r.support, r.note,
                r.operation, r.source_json, r.supersedes_revision_id, r.created_at
         FROM workspace_memories m
         JOIN memory_revisions r ON r.memory_id = m.id AND r.revision = m.head_revision
         WHERE m.workspace_id = ?1 AND m.kind = ?2 AND r.status = 'active'
         LIMIT 200",
    )?;
    let rows = stmt.query_map(params![workspace_id.as_str(), kind.as_str()], map_head)?;
    for row in rows {
        let head = row?;
        if normalize_match(&head.content) == wanted {
            return Ok(Some(head));
        }
    }
    Ok(None)
}

fn load_note(
    conn: &Connection,
    workspace_id: &WorkspaceId,
    memory_id: &str,
) -> Result<Option<MemoryNote>> {
    let Some(head) = load_head(conn, workspace_id, memory_id)? else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        "SELECT revision, status, note, content, historical, support, created_at
         FROM memory_revisions WHERE memory_id = ?1 ORDER BY revision, id",
    )?;
    let history = stmt
        .query_map(params![memory_id], |row| {
            let historical = row.get::<_, i64>(4)? == 1;
            Ok(MemoryRevisionEntry {
                revision: row.get(0)?,
                status: row.get(1)?,
                note: row.get(2)?,
                content: row.get(3)?,
                historical,
                support: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(Some(MemoryNote {
        id: head.memory_id,
        workspace_id: workspace_id.clone(),
        kind: head.kind.clone(),
        text: head.content.clone(),
        source_refs: source_ids_from_json(&head.source_json),
        revision: head.revision,
        status: head.status.clone(),
        observed_at: head.created_at,
        supersedes_revision_id: head.supersedes_revision_id,
        support: head.support.clone(),
        status_label: memory_label(&head.kind, &head.status, false),
        historical: false,
        history,
    }))
}

#[allow(clippy::too_many_arguments)]
fn insert_revision(
    tx: &Transaction<'_>,
    id: &str,
    memory_id: &str,
    workspace_id: &str,
    revision: i64,
    operation: &str,
    status: &str,
    content: &str,
    support: &str,
    note: &str,
    supersedes: Option<&str>,
    operation_id: &str,
    caller: &str,
    historical: bool,
    source_json: &str,
    created_at: &str,
) -> Result<()> {
    tx.execute(
        "INSERT INTO memory_revisions (
            id, memory_id, workspace_id, revision, operation, status, content, support, note,
            supersedes_revision_id, operation_id, caller, historical, source_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            id,
            memory_id,
            workspace_id,
            revision,
            operation,
            status,
            content,
            support,
            note,
            supersedes,
            operation_id,
            caller,
            if historical { 1 } else { 0 },
            source_json,
            created_at,
        ],
    )?;
    Ok(())
}

fn project_memory(
    tx: &Transaction<'_>,
    revision_id: &str,
    workspace_id: &str,
    memory_id: &str,
    kind: &str,
    content: &str,
    status: &str,
    historical: bool,
    recorded_at: &str,
    source_ref_id: Option<&str>,
) -> Result<()> {
    let label = memory_label(kind, status, historical);
    search::upsert_projection(
        tx,
        &SearchDoc {
            id: search::memory_doc_id(revision_id),
            workspace_id: workspace_id.to_string(),
            kind: kind.to_string(),
            title: format!("{}{}", kind_prefix(kind), snippet_title(content)),
            snippet: search::snippet_of(content),
            body: crate::support::fold_ascii(content),
            recorded_at: recorded_at.to_string(),
            status_label: label,
            historical,
            source_ref_id: source_ref_id.map(str::to_string),
            opinion_id: None,
            conversation_id: None,
            target_id: Some(memory_id.to_string()),
            trust: if kind == "decision" { 3 } else { 2 },
        },
    )
}

fn caller_label(
    conn: &Connection,
    workspace_id: &WorkspaceId,
    caller: &MemoryCaller,
) -> Result<String> {
    match caller {
        MemoryCaller::User => Ok("user".to_string()),
        MemoryCaller::Host => Ok("host".to_string()),
        MemoryCaller::AgentRun { run_id } => {
            let owner: Option<String> = conn
                .query_row(
                    "SELECT workspace_id FROM conversation_runs WHERE id = ?1",
                    params![run_id.as_str()],
                    |row| row.get(0),
                )
                .optional()?;
            match owner {
                Some(owner) if owner == workspace_id.as_str() => {
                    Ok(format!("run:{}", run_id.as_str()))
                }
                Some(_) => Err(CoreError::new(
                    ErrorCode::WorkspaceMismatch,
                    "caller run is in another workspace",
                )),
                None => Err(CoreError::new(
                    ErrorCode::RunMismatch,
                    "caller run is not in this workspace",
                )),
            }
        }
    }
}

fn validate_content(content: &str) -> Result<String> {
    let trimmed = content.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_MEMORY_TEXT_CHARS {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "memory content empty or too long",
        ));
    }
    Ok(trimmed.to_string())
}

fn source_json(refs: &[ResolvedRef]) -> Result<String> {
    let links: Vec<serde_json::Value> = refs
        .iter()
        .map(|item| serde_json::json!({"kind": item.kind, "id": item.id}))
        .collect();
    Ok(serde_json::to_string(&links)?)
}

fn source_ids_from_json(value: &str) -> Vec<String> {
    let parsed: Vec<serde_json::Value> = serde_json::from_str(value).unwrap_or_default();
    parsed
        .into_iter()
        .filter_map(|item| {
            item.get("id")
                .and_then(|id| id.as_str())
                .map(str::to_string)
        })
        .collect()
}

fn committed_receipt(
    ctx: &MemoryCallContext,
    operation_id: &str,
    memory_id: &str,
    revision_id: &str,
    revision: i64,
    kind: &str,
    status: &str,
    content: &str,
    source_ids: &[String],
    message_id: Option<String>,
    committed_at: &str,
    detail: &str,
) -> MemoryReceipt {
    let recorded = detail == "committed";
    MemoryReceipt {
        outcome: if recorded { OUTCOME_COMMITTED } else { detail }.to_string(),
        recorded,
        replayed: false,
        operation_id: operation_id.to_string(),
        workspace_id: ctx.workspace_id.clone(),
        domain: "memory".to_string(),
        memory_id: Some(memory_id.to_string()),
        opinion_id: None,
        revision_id: Some(revision_id.to_string()),
        revision: Some(revision),
        kind: Some(kind.to_string()),
        status: Some(status.to_string()),
        content: Some(content.to_string()),
        decision_title: Some(format!("{}{}", kind_prefix(kind), snippet_title(content))),
        decision_summary: Some(content.to_string()),
        committed_at: Some(committed_at.to_string()),
        source_message_id: message_id,
        source_ids: source_ids.to_vec(),
        retained_quote: None,
        reverted: false,
        still_current: recorded || detail == "reverted",
        current_revision: Some(revision),
        current_status: Some(status.to_string()),
        detail: detail.to_string(),
    }
}

fn clarify_receipt(
    ctx: &MemoryCallContext,
    operation_id: &str,
    detail: String,
    quote: Option<String>,
    source_ids: Vec<String>,
) -> MemoryReceipt {
    MemoryReceipt {
        outcome: OUTCOME_NEEDS_CLARIFICATION.to_string(),
        recorded: false,
        replayed: false,
        operation_id: operation_id.to_string(),
        workspace_id: ctx.workspace_id.clone(),
        domain: "memory".to_string(),
        memory_id: None,
        opinion_id: None,
        revision_id: None,
        revision: None,
        kind: None,
        status: None,
        content: None,
        decision_title: None,
        decision_summary: None,
        committed_at: None,
        source_message_id: None,
        source_ids,
        retained_quote: quote,
        reverted: false,
        still_current: false,
        current_revision: None,
        current_status: None,
        detail,
    }
}

fn conflict_receipt(ctx: &MemoryCallContext, operation_id: &str, head: &Head) -> MemoryReceipt {
    MemoryReceipt {
        outcome: OUTCOME_CONFLICT.to_string(),
        recorded: false,
        replayed: false,
        operation_id: operation_id.to_string(),
        workspace_id: ctx.workspace_id.clone(),
        domain: "memory".to_string(),
        memory_id: Some(head.memory_id.clone()),
        opinion_id: None,
        revision_id: Some(head.revision_id.clone()),
        revision: Some(head.revision),
        kind: Some(head.kind.clone()),
        status: Some(head.status.clone()),
        content: None,
        decision_title: None,
        decision_summary: None,
        committed_at: None,
        source_message_id: None,
        source_ids: source_ids_from_json(&head.source_json),
        retained_quote: None,
        reverted: false,
        still_current: false,
        current_revision: Some(head.revision),
        current_status: Some(head.status.clone()),
        detail: format!(
            "conflict: head revision is {}, expected revision does not match",
            head.revision
        ),
    }
}

fn noop_existing(
    ctx: &MemoryCallContext,
    operation_id: &str,
    head: &Head,
    detail: &str,
) -> MemoryReceipt {
    MemoryReceipt {
        outcome: OUTCOME_NOOP.to_string(),
        recorded: false,
        replayed: false,
        operation_id: operation_id.to_string(),
        workspace_id: ctx.workspace_id.clone(),
        domain: "memory".to_string(),
        memory_id: Some(head.memory_id.clone()),
        opinion_id: None,
        revision_id: Some(head.revision_id.clone()),
        revision: Some(head.revision),
        kind: Some(head.kind.clone()),
        status: Some(head.status.clone()),
        content: Some(head.content.clone()),
        decision_title: None,
        decision_summary: None,
        committed_at: None,
        source_message_id: None,
        source_ids: source_ids_from_json(&head.source_json),
        retained_quote: None,
        reverted: false,
        still_current: false,
        current_revision: Some(head.revision),
        current_status: Some(head.status.clone()),
        detail: detail.to_string(),
    }
}

fn stored_from_receipt(receipt: &MemoryReceipt) -> StoredReceipt {
    StoredReceipt {
        outcome: receipt.outcome.clone(),
        recorded: receipt.recorded,
        operation_id: receipt.operation_id.clone(),
        workspace_id: receipt.workspace_id.as_str().to_string(),
        domain: receipt.domain.clone(),
        memory_id: receipt.memory_id.clone(),
        opinion_id: receipt.opinion_id.clone(),
        revision_id: receipt.revision_id.clone(),
        revision: receipt.revision,
        kind: receipt.kind.clone(),
        status: receipt.status.clone(),
        content: receipt.content.clone(),
        decision_title: receipt.decision_title.clone(),
        source_message_id: receipt.source_message_id.clone(),
        source_ids: receipt.source_ids.clone(),
        retained_quote: receipt.retained_quote.clone(),
        detail: receipt.detail.clone(),
        reverted: receipt.reverted,
        support: None,
    }
}

pub(crate) fn receipt_from_stored(
    conn: &Connection,
    stored: StoredReceipt,
    replayed: bool,
) -> Result<MemoryReceipt> {
    let workspace_id = WorkspaceId::from_trusted(stored.workspace_id.clone());
    let mut receipt = MemoryReceipt {
        outcome: stored.outcome,
        recorded: stored.recorded,
        replayed,
        operation_id: stored.operation_id,
        workspace_id,
        domain: stored.domain,
        memory_id: stored.memory_id,
        opinion_id: stored.opinion_id,
        revision_id: stored.revision_id,
        revision: stored.revision,
        kind: stored.kind,
        status: stored.status.clone(),
        content: stored.content.clone(),
        decision_title: stored.decision_title,
        decision_summary: stored.content,
        committed_at: None,
        source_message_id: stored.source_message_id,
        source_ids: stored.source_ids,
        retained_quote: stored.retained_quote,
        reverted: stored.reverted,
        still_current: false,
        current_revision: stored.revision,
        current_status: stored.status.clone(),
        detail: stored.detail,
    };
    if let Some(memory_id) = receipt.memory_id.clone() {
        if let Some(head) = load_head(conn, &receipt.workspace_id, &memory_id)? {
            receipt.current_revision = Some(head.revision);
            receipt.current_status = Some(head.status);
            receipt.still_current = receipt.revision == Some(head.revision)
                && matches!(
                    receipt.outcome.as_str(),
                    OUTCOME_COMMITTED | OUTCOME_REVERTED
                );
        }
    } else if let Some(opinion_id) = receipt.opinion_id.clone() {
        if let Some((revision, status)) = conn
            .query_row(
                "SELECT o.head_revision, r.status
                 FROM opinions o
                 JOIN opinion_revisions r ON r.opinion_id = o.id AND r.revision = o.head_revision
                 WHERE o.id = ?1 AND o.workspace_id = ?2",
                params![opinion_id, receipt.workspace_id.as_str()],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
        {
            receipt.current_revision = Some(revision);
            receipt.current_status = Some(status);
            receipt.still_current = receipt.revision == Some(revision)
                && matches!(
                    receipt.outcome.as_str(),
                    OUTCOME_COMMITTED | OUTCOME_REVERTED
                );
        }
    }
    Ok(receipt)
}

fn memory_label(kind: &str, status: &str, historical: bool) -> String {
    if historical {
        return "历史修订，不是当前决定".to_string();
    }
    match status {
        "retracted" => "已撤回，历史仍在".to_string(),
        "disputed" => "有争议，未判定哪一方正确".to_string(),
        _ => match kind {
            "decision" => "当前决定（原话支持，不是已核实事实）".to_string(),
            "identity" => "项目身份笔记（原话），不是观察事实".to_string(),
            "experience" => "已确认经验，不是全局偏好".to_string(),
            _ => "当前笔记，不是已核实事实".to_string(),
        },
    }
}

fn kind_prefix(kind: &str) -> &'static str {
    match kind {
        "decision" => "决定 ",
        "identity" => "身份 ",
        "experience" => "经验 ",
        _ => "笔记 ",
    }
}

fn snippet_title(text: &str) -> String {
    text.chars().take(32).collect()
}

fn uuid_hex() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
