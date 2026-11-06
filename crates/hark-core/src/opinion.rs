//! Structured opinions. Not a flat memory string, and not a second copy of a decision.
//!
//! Feedback keeps the user's comment and appends a revision. Shelving does not
//! negate facts. `revise` with only a comment is pending revision, not a new judgment.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, ErrorCode, Result};
use crate::ids::WorkspaceId;
use crate::limits::{
    MAX_MEMORY_LIST, MAX_MEMORY_TEXT_CHARS, MAX_OPINION_ITEM_CHARS, MAX_OPINION_LIST_ITEMS,
};
use crate::memory::{
    self, MemoryCallContext, MemoryCaller, MemoryReceipt, StoredReceipt, OUTCOME_COMMITTED,
    OUTCOME_CONFLICT, OUTCOME_NEEDS_CLARIFICATION, OUTCOME_NOOP, OUTCOME_REVERTED,
};
use crate::search::{self, SearchDoc};
use crate::support::{evidence_overlaps, file_quote_supports, text_supports};
use crate::Core;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpinionFeedbackAction {
    Helpful,
    Rebut,
    Shelve,
    Revise,
}

impl OpinionFeedbackAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Helpful => "helpful",
            Self::Rebut => "rebut",
            Self::Shelve => "shelve",
            Self::Revise => "revise",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpinionChangeProposal {
    pub operation: memory::MemoryOperation,
    pub summary: String,
    pub evidence_refs: Vec<String>,
    pub counter_arguments: Vec<String>,
    pub uncertainties: Vec<String>,
    #[serde(default)]
    pub target_opinion_id: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpinionFeedbackInput {
    pub request_id: String,
    pub workspace_id: WorkspaceId,
    pub opinion_id: String,
    pub expected_revision: i64,
    pub action: OpinionFeedbackAction,
    #[serde(default)]
    pub user_comment: Option<String>,
    pub caller: MemoryCaller,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpinionRevisionEntry {
    pub revision: i64,
    pub status: String,
    pub note: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpinionView {
    pub id: String,
    pub workspace_id: WorkspaceId,
    pub title: String,
    pub revision: i64,
    pub summary: String,
    pub rationale: String,
    pub evidence_refs: Vec<String>,
    pub counter_arguments: Vec<String>,
    pub uncertainties: Vec<String>,
    pub suggested_next_step: Option<String>,
    pub status: String,
    pub last_updated_at: String,
    pub user_feedback_note: Option<String>,
    pub history: Vec<OpinionRevisionEntry>,
    /// False when feedback did not generate a new judgment.
    pub judgment_generated: bool,
    pub replayed: bool,
    pub still_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpinionReceipt {
    pub outcome: String,
    pub recorded: bool,
    pub replayed: bool,
    pub operation_id: String,
    pub workspace_id: WorkspaceId,
    pub opinion_id: Option<String>,
    pub revision_id: Option<String>,
    pub revision: Option<i64>,
    pub evidence_refs: Vec<String>,
    pub still_current: bool,
    pub detail: String,
    pub view: Option<OpinionView>,
}

#[allow(dead_code)]
struct OpinionHead {
    id: String,
    revision: i64,
    revision_id: String,
    status: String,
    summary: String,
    evidence_json: String,
    counter_json: String,
    uncertainty_json: String,
    note: String,
    operation: String,
    judgment_generated: bool,
    created_at: String,
}

impl Core {
    pub fn opinion_propose_change(
        &self,
        ctx: &MemoryCallContext,
        proposal: &OpinionChangeProposal,
    ) -> Result<OpinionReceipt> {
        let operation_id = memory::validate_operation_key(&ctx.operation_id)?;
        self.with_tx(|tx| propose_tx(tx, ctx, proposal, &operation_id))
    }

    pub fn get_opinion(&self, opinion_id: &str) -> Result<OpinionView> {
        self.with_conn(|conn| {
            let owner = opinion_workspace(conn, opinion_id)?;
            load_view(conn, &owner, opinion_id, None, false)?
                .ok_or_else(|| CoreError::new(ErrorCode::NotFound, opinion_id))
        })
    }

    pub fn list_workspace_opinions(&self, workspace_id: &WorkspaceId) -> Result<Vec<OpinionView>> {
        self.with_conn(|conn| {
            memory::require_workspace(conn, workspace_id)?;
            let mut stmt = conn.prepare(
                "SELECT id FROM opinions WHERE workspace_id = ?1 ORDER BY created_at, id LIMIT ?2",
            )?;
            let ids: Vec<String> = stmt
                .query_map(
                    params![workspace_id.as_str(), MAX_MEMORY_LIST as i64],
                    |row| row.get(0),
                )?
                .collect::<std::result::Result<_, _>>()?;
            let mut views = Vec::new();
            for id in ids {
                if let Some(view) = load_view(conn, workspace_id, &id, None, false)? {
                    views.push(view);
                }
            }
            Ok(views)
        })
    }

    /// Local user feedback. Does not require a model grant and does not write a decision.
    pub fn submit_opinion_feedback(&self, input: &OpinionFeedbackInput) -> Result<OpinionView> {
        let request_id = memory::validate_operation_key(&input.request_id)?;
        self.with_tx(|tx| feedback_tx(tx, input, &request_id))
    }
}

pub(crate) fn revert_committed(
    tx: &Transaction<'_>,
    workspace_id: &WorkspaceId,
    stored: &StoredReceipt,
) -> Result<MemoryReceipt> {
    let opinion_id = stored
        .opinion_id
        .as_deref()
        .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "opinion receipt has no opinion id"))?;
    let written = stored
        .revision
        .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "opinion receipt has no revision"))?;
    let head = require_head(tx, workspace_id, opinion_id)?;
    if head.revision != written {
        return Err(CoreError::new(
            ErrorCode::ConflictRevision,
            format!(
                "opinion {opinion_id} head is revision {}, operation wrote {written}; not overwriting",
                head.revision
            ),
        ));
    }
    let (operation, status, summary, evidence, counters, uncertainties, note) =
        if head.operation == "ADD" || head.revision == 1 {
            (
                "RETRACT".to_string(),
                "retracted".to_string(),
                head.summary.clone(),
                head.evidence_json.clone(),
                head.counter_json.clone(),
                head.uncertainty_json.clone(),
                "撤销该观点写入。历史保留，未物理删除。".to_string(),
            )
        } else {
            let previous =
                load_revision_number(tx, opinion_id, head.revision - 1)?.ok_or_else(|| {
                    CoreError::new(ErrorCode::NotFound, "previous opinion revision missing")
                })?;
            (
                "RESTORE".to_string(),
                previous.status.clone(),
                previous.summary.clone(),
                previous.evidence_json.clone(),
                previous.counter_json.clone(),
                previous.uncertainty_json.clone(),
                "撤销后恢复上一版观点。被撤销的修订仍保留。".to_string(),
            )
        };
    let appended = append_opinion(
        tx,
        workspace_id,
        opinion_id,
        &head,
        &stored.operation_id,
        "host",
        &operation,
        &status,
        &summary,
        &evidence,
        &counters,
        &uncertainties,
        &note,
        false,
    )?;
    Ok(MemoryReceipt {
        outcome: OUTCOME_REVERTED.to_string(),
        recorded: false,
        replayed: false,
        operation_id: stored.operation_id.clone(),
        workspace_id: workspace_id.clone(),
        domain: "revert".to_string(),
        memory_id: None,
        opinion_id: Some(opinion_id.to_string()),
        revision_id: Some(appended.0),
        revision: Some(appended.1),
        kind: Some("opinion".to_string()),
        status: Some(appended.2.clone()),
        content: Some(summary.to_string()),
        decision_title: Some(title_of(&summary)),
        decision_summary: Some(summary.to_string()),
        committed_at: Some(Utc::now().to_rfc3339()),
        source_message_id: None,
        source_ids: json_string_list(&evidence),
        retained_quote: None,
        reverted: true,
        still_current: true,
        current_revision: Some(appended.1),
        current_status: Some(appended.2),
        detail: "reverted by a new opinion revision; history retained".to_string(),
    })
}

fn propose_tx(
    tx: &Transaction<'_>,
    ctx: &MemoryCallContext,
    proposal: &OpinionChangeProposal,
    operation_id: &str,
) -> Result<OpinionReceipt> {
    memory::require_workspace(tx, &ctx.workspace_id)?;
    if let Some(stored) = memory::load_receipt(tx, &ctx.workspace_id, operation_id, "opinion")? {
        return receipt_from_stored(tx, &ctx.workspace_id, stored, true);
    }
    let _caller = caller_label(tx, ctx)?;
    let receipt = match proposal.operation {
        memory::MemoryOperation::Noop => noop_opinion(tx, ctx, proposal, operation_id)?,
        memory::MemoryOperation::Add => add_opinion(tx, ctx, proposal, operation_id)?,
        memory::MemoryOperation::Revise => {
            change_opinion(tx, ctx, proposal, operation_id, "REVISE")?
        }
        memory::MemoryOperation::Dispute => {
            change_opinion(tx, ctx, proposal, operation_id, "DISPUTE")?
        }
        memory::MemoryOperation::Retract => retract_opinion(tx, ctx, proposal, operation_id)?,
    };
    memory::store_receipt(tx, &stored_from_opinion(&receipt))?;
    Ok(receipt)
}

fn add_opinion(
    tx: &Transaction<'_>,
    ctx: &MemoryCallContext,
    proposal: &OpinionChangeProposal,
    operation_id: &str,
) -> Result<OpinionReceipt> {
    if proposal.target_opinion_id.is_some() || proposal.expected_revision.is_some() {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "ADD does not take targetOpinionId or expectedRevision",
        ));
    }
    let fields = validate_fields(proposal)?;
    let evidence = check_evidence(tx, ctx, proposal, &fields.summary)?;
    if let EvidenceCheck::Clarify { detail, ids } = evidence {
        return Ok(clarify_opinion(ctx, operation_id, detail, ids));
    }
    let EvidenceCheck::Ok { ids } = evidence else {
        unreachable!("clarify returned above");
    };
    let opinion_id = format!("opn_{}", uuid_hex());
    let now = Utc::now().to_rfc3339();
    let caller = caller_label(tx, ctx)?;
    tx.execute(
        "INSERT INTO opinions (id, workspace_id, head_revision, created_at) VALUES (?1, ?2, 1, ?3)",
        params![opinion_id, ctx.workspace_id.as_str(), now],
    )?;
    let revision_id = insert_opinion_revision(
        tx,
        &opinion_id,
        ctx.workspace_id.as_str(),
        1,
        "ADD",
        "active",
        &fields.summary,
        &fields.evidence_json,
        &fields.counter_json,
        &fields.uncertainty_json,
        "",
        None,
        operation_id,
        &caller,
        true,
        &now,
    )?;
    project_opinion(
        tx,
        &revision_id,
        ctx.workspace_id.as_str(),
        &opinion_id,
        &fields.summary,
        &fields.counter_json,
        &fields.uncertainty_json,
        "active",
        false,
        true,
        &now,
    )?;
    let view = load_view(tx, &ctx.workspace_id, &opinion_id, None, false)?
        .ok_or_else(|| CoreError::new(ErrorCode::Sqlite, "opinion missing after insert"))?;
    Ok(OpinionReceipt {
        outcome: OUTCOME_COMMITTED.to_string(),
        recorded: true,
        replayed: false,
        operation_id: operation_id.to_string(),
        workspace_id: ctx.workspace_id.clone(),
        opinion_id: Some(opinion_id),
        revision_id: Some(revision_id),
        revision: Some(1),
        evidence_refs: ids,
        still_current: true,
        detail: "committed".to_string(),
        view: Some(view),
    })
}

fn change_opinion(
    tx: &Transaction<'_>,
    ctx: &MemoryCallContext,
    proposal: &OpinionChangeProposal,
    operation_id: &str,
    operation: &str,
) -> Result<OpinionReceipt> {
    let target = proposal
        .target_opinion_id
        .as_deref()
        .ok_or_else(|| CoreError::new(ErrorCode::InvalidMessage, "targetOpinionId required"))?;
    let expected = proposal
        .expected_revision
        .ok_or_else(|| CoreError::new(ErrorCode::InvalidMessage, "expectedRevision required"))?;
    let head = require_head(tx, &ctx.workspace_id, target)?;
    if head.revision != expected {
        return Ok(conflict_opinion(ctx, operation_id, &head));
    }
    let fields = validate_fields(proposal)?;
    let evidence = check_evidence(tx, ctx, proposal, &fields.summary)?;
    if let EvidenceCheck::Clarify { detail, ids } = evidence {
        return Ok(clarify_opinion(ctx, operation_id, detail, ids));
    }
    let EvidenceCheck::Ok { ids } = evidence else {
        unreachable!("clarify returned above");
    };
    if operation == "REVISE"
        && fields.summary == head.summary
        && fields.evidence_json == head.evidence_json
        && fields.counter_json == head.counter_json
        && fields.uncertainty_json == head.uncertainty_json
    {
        let view = load_view(tx, &ctx.workspace_id, &head.id, None, false)?;
        return Ok(OpinionReceipt {
            outcome: OUTCOME_NOOP.to_string(),
            recorded: false,
            replayed: false,
            operation_id: operation_id.to_string(),
            workspace_id: ctx.workspace_id.clone(),
            opinion_id: Some(head.id),
            revision_id: Some(head.revision_id),
            revision: Some(head.revision),
            evidence_refs: ids,
            still_current: false,
            detail: "noop: structured opinion is unchanged".to_string(),
            view,
        });
    }
    let status = if operation == "DISPUTE" {
        "disputed"
    } else {
        "active"
    };
    let caller = caller_label(tx, ctx)?;
    let appended = append_opinion(
        tx,
        &ctx.workspace_id,
        &head.id,
        &head,
        operation_id,
        &caller,
        operation,
        status,
        &fields.summary,
        &fields.evidence_json,
        &fields.counter_json,
        &fields.uncertainty_json,
        if operation == "DISPUTE" {
            "争议记录。未判定哪一方正确，也没有改写用户决定。"
        } else {
            ""
        },
        true,
    )?;
    let view = load_view(tx, &ctx.workspace_id, &head.id, None, false)?;
    Ok(OpinionReceipt {
        outcome: OUTCOME_COMMITTED.to_string(),
        recorded: true,
        replayed: false,
        operation_id: operation_id.to_string(),
        workspace_id: ctx.workspace_id.clone(),
        opinion_id: Some(head.id),
        revision_id: Some(appended.0),
        revision: Some(appended.1),
        evidence_refs: ids,
        still_current: true,
        detail: "committed".to_string(),
        view,
    })
}

fn retract_opinion(
    tx: &Transaction<'_>,
    ctx: &MemoryCallContext,
    proposal: &OpinionChangeProposal,
    operation_id: &str,
) -> Result<OpinionReceipt> {
    let target = proposal
        .target_opinion_id
        .as_deref()
        .ok_or_else(|| CoreError::new(ErrorCode::InvalidMessage, "targetOpinionId required"))?;
    let expected = proposal
        .expected_revision
        .ok_or_else(|| CoreError::new(ErrorCode::InvalidMessage, "expectedRevision required"))?;
    let head = require_head(tx, &ctx.workspace_id, target)?;
    if head.revision != expected {
        return Ok(conflict_opinion(ctx, operation_id, &head));
    }
    if head.status == "retracted" {
        let view = load_view(tx, &ctx.workspace_id, &head.id, None, false)?;
        return Ok(OpinionReceipt {
            outcome: OUTCOME_NOOP.to_string(),
            recorded: false,
            replayed: false,
            operation_id: operation_id.to_string(),
            workspace_id: ctx.workspace_id.clone(),
            opinion_id: Some(head.id),
            revision_id: Some(head.revision_id),
            revision: Some(head.revision),
            evidence_refs: json_string_list(&head.evidence_json),
            still_current: false,
            detail: "noop: already retracted".to_string(),
            view,
        });
    }
    let caller = caller_label(tx, ctx)?;
    let appended = append_opinion(
        tx,
        &ctx.workspace_id,
        &head.id,
        &head,
        operation_id,
        &caller,
        "RETRACT",
        "retracted",
        &head.summary,
        &head.evidence_json,
        &head.counter_json,
        &head.uncertainty_json,
        "撤回观点。历史保留。",
        false,
    )?;
    let view = load_view(tx, &ctx.workspace_id, &head.id, None, false)?;
    Ok(OpinionReceipt {
        outcome: OUTCOME_COMMITTED.to_string(),
        recorded: true,
        replayed: false,
        operation_id: operation_id.to_string(),
        workspace_id: ctx.workspace_id.clone(),
        opinion_id: Some(head.id.clone()),
        revision_id: Some(appended.0),
        revision: Some(appended.1),
        evidence_refs: json_string_list(&head.evidence_json),
        still_current: true,
        detail: "committed".to_string(),
        view,
    })
}

fn noop_opinion(
    tx: &Transaction<'_>,
    ctx: &MemoryCallContext,
    proposal: &OpinionChangeProposal,
    operation_id: &str,
) -> Result<OpinionReceipt> {
    if let Some(target) = proposal.target_opinion_id.as_deref() {
        let head = require_head(tx, &ctx.workspace_id, target)?;
        let view = load_view(tx, &ctx.workspace_id, &head.id, None, false)?;
        return Ok(OpinionReceipt {
            outcome: OUTCOME_NOOP.to_string(),
            recorded: false,
            replayed: false,
            operation_id: operation_id.to_string(),
            workspace_id: ctx.workspace_id.clone(),
            opinion_id: Some(head.id),
            revision_id: Some(head.revision_id),
            revision: Some(head.revision),
            evidence_refs: json_string_list(&head.evidence_json),
            still_current: false,
            detail: "noop".to_string(),
            view,
        });
    }
    Ok(OpinionReceipt {
        outcome: OUTCOME_NOOP.to_string(),
        recorded: false,
        replayed: false,
        operation_id: operation_id.to_string(),
        workspace_id: ctx.workspace_id.clone(),
        opinion_id: None,
        revision_id: None,
        revision: None,
        evidence_refs: Vec::new(),
        still_current: false,
        detail: "noop".to_string(),
        view: None,
    })
}

fn feedback_tx(
    tx: &Transaction<'_>,
    input: &OpinionFeedbackInput,
    request_id: &str,
) -> Result<OpinionView> {
    memory::require_workspace(tx, &input.workspace_id)?;
    if let Some(existing) = memory::load_receipt(tx, &input.workspace_id, request_id, "feedback")? {
        let opinion_id = existing
            .opinion_id
            .unwrap_or_else(|| input.opinion_id.clone());
        let revision = existing.revision;
        return load_view(tx, &input.workspace_id, &opinion_id, revision, true)?
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound, opinion_id));
    }
    let head = require_head(tx, &input.workspace_id, &input.opinion_id)?;
    if head.revision != input.expected_revision {
        return Err(CoreError::new(
            ErrorCode::ConflictRevision,
            format!(
                "opinion head is revision {}, expected {}",
                head.revision, input.expected_revision
            ),
        ));
    }
    let comment = match input.user_comment.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else if trimmed.chars().count() > MAX_MEMORY_TEXT_CHARS {
                return Err(CoreError::new(
                    ErrorCode::InvalidMessage,
                    "feedback comment too long",
                ));
            } else {
                Some(trimmed.to_string())
            }
        }
        None => None,
    };
    let (status, note, judgment) = match input.action {
        OpinionFeedbackAction::Helpful => ("active", "用户标记有帮助。不是新判断。", false),
        OpinionFeedbackAction::Rebut => (
            "disputed",
            "用户反驳。不是否定项目事实，也不是新的已核实结论。",
            false,
        ),
        OpinionFeedbackAction::Shelve => ("shelved", "用户搁置。搁置不是否定事实。", false),
        OpinionFeedbackAction::Revise => (
            "pending_revision",
            "待修订：只记录用户意见，未生成新判断。",
            false,
        ),
    };
    let mut counters: Vec<String> = json_string_list(&head.counter_json);
    if input.action == OpinionFeedbackAction::Rebut {
        if let Some(comment) = &comment {
            counters.push(format!("用户反驳：{comment}"));
        }
    }
    let counter_json = serde_json::to_string(&counters)?;
    let caller = caller_label_direct(tx, &input.workspace_id, &input.caller)?;
    let appended = append_opinion(
        tx,
        &input.workspace_id,
        &head.id,
        &head,
        request_id,
        &caller,
        "FEEDBACK",
        status,
        &head.summary,
        &head.evidence_json,
        &counter_json,
        &head.uncertainty_json,
        note,
        judgment,
    )?;
    let feedback_id = format!("fbk_{}", uuid_hex());
    tx.execute(
        "INSERT INTO opinion_feedback (
            id, workspace_id, opinion_id, revision_id, request_id, action, user_comment, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            feedback_id,
            input.workspace_id.as_str(),
            head.id,
            appended.0,
            request_id,
            input.action.as_str(),
            comment,
            Utc::now().to_rfc3339(),
        ],
    )?;
    let view = load_view(tx, &input.workspace_id, &head.id, None, false)?
        .ok_or_else(|| CoreError::new(ErrorCode::Sqlite, "opinion missing after feedback"))?;
    memory::store_receipt(
        tx,
        &StoredReceipt {
            outcome: OUTCOME_COMMITTED.to_string(),
            recorded: true,
            operation_id: request_id.to_string(),
            workspace_id: input.workspace_id.as_str().to_string(),
            domain: "feedback".to_string(),
            memory_id: None,
            opinion_id: Some(head.id.clone()),
            revision_id: Some(appended.0),
            revision: Some(appended.1),
            kind: Some("opinion".to_string()),
            status: Some(status.to_string()),
            content: Some(head.summary.clone()),
            decision_title: Some(title_of(&head.summary)),
            source_message_id: None,
            source_ids: json_string_list(&head.evidence_json),
            retained_quote: comment,
            detail: "feedback recorded; no new judgment unless opinion_propose_change supplies structure".to_string(),
            reverted: false,
            support: None,
        },
    )?;
    Ok(view)
}

#[allow(clippy::too_many_arguments)]
fn append_opinion(
    tx: &Transaction<'_>,
    workspace_id: &WorkspaceId,
    opinion_id: &str,
    head: &OpinionHead,
    operation_id: &str,
    caller: &str,
    operation: &str,
    status: &str,
    summary: &str,
    evidence_json: &str,
    counter_json: &str,
    uncertainty_json: &str,
    note: &str,
    judgment_generated: bool,
) -> Result<(String, i64, String)> {
    let next = head.revision + 1;
    let now = Utc::now().to_rfc3339();
    let revision_id = insert_opinion_revision(
        tx,
        opinion_id,
        workspace_id.as_str(),
        next,
        operation,
        status,
        summary,
        evidence_json,
        counter_json,
        uncertainty_json,
        note,
        Some(&head.revision_id),
        operation_id,
        caller,
        judgment_generated,
        &now,
    )?;
    let changed = tx.execute(
        "UPDATE opinions SET head_revision = ?1 WHERE id = ?2 AND workspace_id = ?3 AND head_revision = ?4",
        params![next, opinion_id, workspace_id.as_str(), head.revision],
    )?;
    if changed != 1 {
        return Err(CoreError::new(
            ErrorCode::ConflictRevision,
            "opinion head changed during update",
        ));
    }
    tx.execute(
        "UPDATE opinion_revisions SET historical = 1 WHERE id = ?1",
        params![head.revision_id],
    )?;
    search::mark_historical(
        tx,
        &search::opinion_doc_id(&head.revision_id),
        "历史观点，不是当前判断",
    )?;
    project_opinion(
        tx,
        &revision_id,
        workspace_id.as_str(),
        opinion_id,
        summary,
        counter_json,
        uncertainty_json,
        status,
        false,
        judgment_generated,
        &now,
    )?;
    Ok((revision_id, next, status.to_string()))
}

#[allow(clippy::too_many_arguments)]
fn insert_opinion_revision(
    tx: &Transaction<'_>,
    opinion_id: &str,
    workspace_id: &str,
    revision: i64,
    operation: &str,
    status: &str,
    summary: &str,
    evidence_json: &str,
    counter_json: &str,
    uncertainty_json: &str,
    note: &str,
    supersedes: Option<&str>,
    operation_id: &str,
    caller: &str,
    judgment_generated: bool,
    created_at: &str,
) -> Result<String> {
    let id = format!("rev_{}", uuid_hex());
    tx.execute(
        "INSERT INTO opinion_revisions (
            id, opinion_id, workspace_id, revision, operation, status, summary,
            evidence_json, counter_json, uncertainty_json, note, supersedes_revision_id,
            operation_id, caller, historical, judgment_generated, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 0, ?15, ?16)",
        params![
            id,
            opinion_id,
            workspace_id,
            revision,
            operation,
            status,
            summary,
            evidence_json,
            counter_json,
            uncertainty_json,
            note,
            supersedes,
            operation_id,
            caller,
            if judgment_generated { 1 } else { 0 },
            created_at,
        ],
    )?;
    Ok(id)
}

fn project_opinion(
    tx: &Transaction<'_>,
    revision_id: &str,
    workspace_id: &str,
    opinion_id: &str,
    summary: &str,
    counter_json: &str,
    uncertainty_json: &str,
    status: &str,
    historical: bool,
    judgment_generated: bool,
    recorded_at: &str,
) -> Result<()> {
    let body = format!(
        "{summary}\n{}\n{}",
        json_string_list(counter_json).join("\n"),
        json_string_list(uncertainty_json).join("\n")
    );
    search::upsert_projection(
        tx,
        &SearchDoc {
            id: search::opinion_doc_id(revision_id),
            workspace_id: workspace_id.to_string(),
            kind: "opinion".to_string(),
            title: title_of(summary),
            snippet: search::snippet_of(summary),
            body: crate::support::fold_ascii(&body),
            recorded_at: recorded_at.to_string(),
            status_label: opinion_label(status, historical, judgment_generated),
            historical,
            source_ref_id: None,
            opinion_id: Some(opinion_id.to_string()),
            conversation_id: None,
            target_id: Some(opinion_id.to_string()),
            trust: 1,
        },
    )
}

enum EvidenceCheck {
    Ok { ids: Vec<String> },
    Clarify { detail: String, ids: Vec<String> },
}

fn check_evidence(
    tx: &Transaction<'_>,
    ctx: &MemoryCallContext,
    proposal: &OpinionChangeProposal,
    summary: &str,
) -> Result<EvidenceCheck> {
    if proposal.evidence_refs.is_empty() {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "evidenceRefs is required",
        ));
    }
    let refs = memory::resolve_refs(tx, &ctx.workspace_id, &proposal.evidence_refs, None)?;
    let ids: Vec<String> = refs.iter().map(|item| item.id.clone()).collect();
    let current = ctx.current_user_message_id.as_ref().map(|id| id.as_str());
    let only_current =
        current.is_some() && refs.iter().all(|item| Some(item.id.as_str()) == current);
    if only_current {
        let text = refs.first().map(|item| item.text.as_str()).unwrap_or("");
        if text_supports(summary, text) {
            return Ok(EvidenceCheck::Ok { ids });
        }
        return Ok(EvidenceCheck::Clarify {
            detail: "needs_clarification: current message id cannot endorse an opinion fact that is not in that message".to_string(),
            ids,
        });
    }
    let related = refs.iter().any(|item| {
        text_supports(summary, &item.text)
            || file_quote_supports(summary, &item.text)
            || evidence_overlaps(summary, &item.text)
    });
    if related {
        Ok(EvidenceCheck::Ok { ids })
    } else {
        Ok(EvidenceCheck::Clarify {
            detail: "needs_clarification: opinion summary does not overlap the cited evidence"
                .to_string(),
            ids,
        })
    }
}

struct Fields {
    summary: String,
    evidence_json: String,
    counter_json: String,
    uncertainty_json: String,
}

fn validate_fields(proposal: &OpinionChangeProposal) -> Result<Fields> {
    let summary = proposal.summary.trim();
    if summary.is_empty() || summary.chars().count() > MAX_MEMORY_TEXT_CHARS {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "opinion summary empty or too long",
        ));
    }
    let counters = validate_list(&proposal.counter_arguments)?;
    let uncertainties = validate_list(&proposal.uncertainties)?;
    Ok(Fields {
        summary: summary.to_string(),
        evidence_json: serde_json::to_string(&proposal.evidence_refs)?,
        counter_json: serde_json::to_string(&counters)?,
        uncertainty_json: serde_json::to_string(&uncertainties)?,
    })
}

fn validate_list(items: &[String]) -> Result<Vec<String>> {
    if items.len() > MAX_OPINION_LIST_ITEMS {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "too many opinion list items",
        ));
    }
    let mut out = Vec::new();
    for item in items {
        let trimmed = item.trim();
        if trimmed.is_empty() || trimmed.chars().count() > MAX_OPINION_ITEM_CHARS {
            return Err(CoreError::new(
                ErrorCode::InvalidMessage,
                "opinion list item empty or too long",
            ));
        }
        out.push(trimmed.to_string());
    }
    Ok(out)
}

fn require_head(
    conn: &Connection,
    workspace_id: &WorkspaceId,
    opinion_id: &str,
) -> Result<OpinionHead> {
    let owner = opinion_workspace(conn, opinion_id)?;
    if owner.as_str() != workspace_id.as_str() {
        return Err(CoreError::new(ErrorCode::CrossWorkspaceRef, opinion_id));
    }
    load_head(conn, opinion_id)?.ok_or_else(|| CoreError::new(ErrorCode::NotFound, opinion_id))
}

fn opinion_workspace(conn: &Connection, opinion_id: &str) -> Result<WorkspaceId> {
    let owner: Option<String> = conn
        .query_row(
            "SELECT workspace_id FROM opinions WHERE id = ?1",
            params![opinion_id],
            |row| row.get(0),
        )
        .optional()?;
    owner
        .map(WorkspaceId::from_trusted)
        .ok_or_else(|| CoreError::new(ErrorCode::NotFound, opinion_id))
}

fn load_head(conn: &Connection, opinion_id: &str) -> Result<Option<OpinionHead>> {
    conn.query_row(
        "SELECT o.id, r.revision, r.id, r.status, r.summary, r.evidence_json, r.counter_json,
                r.uncertainty_json, r.note, r.operation, r.judgment_generated, r.created_at
         FROM opinions o
         JOIN opinion_revisions r ON r.opinion_id = o.id AND r.revision = o.head_revision
         WHERE o.id = ?1",
        params![opinion_id],
        |row| {
            Ok(OpinionHead {
                id: row.get(0)?,
                revision: row.get(1)?,
                revision_id: row.get(2)?,
                status: row.get(3)?,
                summary: row.get(4)?,
                evidence_json: row.get(5)?,
                counter_json: row.get(6)?,
                uncertainty_json: row.get(7)?,
                note: row.get(8)?,
                operation: row.get(9)?,
                judgment_generated: row.get::<_, i64>(10)? == 1,
                created_at: row.get(11)?,
            })
        },
    )
    .optional()
    .map_err(CoreError::from)
}

fn load_revision_number(
    conn: &Connection,
    opinion_id: &str,
    revision: i64,
) -> Result<Option<OpinionHead>> {
    conn.query_row(
        "SELECT opinion_id, revision, id, status, summary, evidence_json, counter_json,
                uncertainty_json, note, operation, judgment_generated, created_at
         FROM opinion_revisions WHERE opinion_id = ?1 AND revision = ?2",
        params![opinion_id, revision],
        |row| {
            Ok(OpinionHead {
                id: row.get(0)?,
                revision: row.get(1)?,
                revision_id: row.get(2)?,
                status: row.get(3)?,
                summary: row.get(4)?,
                evidence_json: row.get(5)?,
                counter_json: row.get(6)?,
                uncertainty_json: row.get(7)?,
                note: row.get(8)?,
                operation: row.get(9)?,
                judgment_generated: row.get::<_, i64>(10)? == 1,
                created_at: row.get(11)?,
            })
        },
    )
    .optional()
    .map_err(CoreError::from)
}

fn load_view(
    conn: &Connection,
    workspace_id: &WorkspaceId,
    opinion_id: &str,
    as_of: Option<i64>,
    replayed: bool,
) -> Result<Option<OpinionView>> {
    let owner = match opinion_workspace(conn, opinion_id) {
        Ok(owner) => owner,
        Err(err) if err.code == ErrorCode::NotFound => return Ok(None),
        Err(err) => return Err(err),
    };
    if owner.as_str() != workspace_id.as_str() {
        return Err(CoreError::new(ErrorCode::CrossWorkspaceRef, opinion_id));
    }
    let head = if let Some(revision) = as_of {
        load_revision_number(conn, opinion_id, revision)?
    } else {
        load_head(conn, opinion_id)?
    };
    let Some(head) = head else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        "SELECT revision, status, note, created_at FROM opinion_revisions
         WHERE opinion_id = ?1 AND revision <= ?2 ORDER BY revision, id",
    )?;
    let history = stmt
        .query_map(params![opinion_id, head.revision], |row| {
            Ok(OpinionRevisionEntry {
                revision: row.get(0)?,
                status: row.get(1)?,
                note: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let feedback: Option<Option<String>> = conn
        .query_row(
            "SELECT user_comment FROM opinion_feedback WHERE revision_id = ?1",
            params![head.revision_id],
            |row| row.get(0),
        )
        .optional()?;
    let live_head = load_head(conn, opinion_id)?.map(|item| item.revision);
    Ok(Some(OpinionView {
        id: opinion_id.to_string(),
        workspace_id: workspace_id.clone(),
        title: title_of(&head.summary),
        revision: head.revision,
        summary: head.summary.clone(),
        rationale: "未生成独立理由。这是结构化观点，不是已核实事实。".to_string(),
        evidence_refs: json_string_list(&head.evidence_json),
        counter_arguments: json_string_list(&head.counter_json),
        uncertainties: json_string_list(&head.uncertainty_json),
        suggested_next_step: None,
        status: head.status,
        last_updated_at: head.created_at,
        user_feedback_note: feedback.flatten(),
        history,
        judgment_generated: head.judgment_generated,
        replayed,
        still_current: live_head == Some(head.revision),
    }))
}

fn clarify_opinion(
    ctx: &MemoryCallContext,
    operation_id: &str,
    detail: String,
    ids: Vec<String>,
) -> OpinionReceipt {
    OpinionReceipt {
        outcome: OUTCOME_NEEDS_CLARIFICATION.to_string(),
        recorded: false,
        replayed: false,
        operation_id: operation_id.to_string(),
        workspace_id: ctx.workspace_id.clone(),
        opinion_id: None,
        revision_id: None,
        revision: None,
        evidence_refs: ids,
        still_current: false,
        detail,
        view: None,
    }
}

fn conflict_opinion(
    ctx: &MemoryCallContext,
    operation_id: &str,
    head: &OpinionHead,
) -> OpinionReceipt {
    OpinionReceipt {
        outcome: OUTCOME_CONFLICT.to_string(),
        recorded: false,
        replayed: false,
        operation_id: operation_id.to_string(),
        workspace_id: ctx.workspace_id.clone(),
        opinion_id: Some(head.id.clone()),
        revision_id: Some(head.revision_id.clone()),
        revision: Some(head.revision),
        evidence_refs: json_string_list(&head.evidence_json),
        still_current: false,
        detail: format!(
            "conflict: head revision is {}, expected revision does not match",
            head.revision
        ),
        view: None,
    }
}

fn stored_from_opinion(receipt: &OpinionReceipt) -> StoredReceipt {
    StoredReceipt {
        outcome: receipt.outcome.clone(),
        recorded: receipt.recorded,
        operation_id: receipt.operation_id.clone(),
        workspace_id: receipt.workspace_id.as_str().to_string(),
        domain: "opinion".to_string(),
        memory_id: None,
        opinion_id: receipt.opinion_id.clone(),
        revision_id: receipt.revision_id.clone(),
        revision: receipt.revision,
        kind: Some("opinion".to_string()),
        status: None,
        content: receipt.view.as_ref().map(|view| view.summary.clone()),
        decision_title: receipt.view.as_ref().map(|view| view.title.clone()),
        source_message_id: None,
        source_ids: receipt.evidence_refs.clone(),
        retained_quote: None,
        detail: receipt.detail.clone(),
        reverted: false,
        support: None,
    }
}

fn receipt_from_stored(
    conn: &Connection,
    workspace_id: &WorkspaceId,
    stored: StoredReceipt,
    replayed: bool,
) -> Result<OpinionReceipt> {
    let view = if let Some(opinion_id) = stored.opinion_id.as_deref() {
        load_view(conn, workspace_id, opinion_id, stored.revision, replayed)?
    } else {
        None
    };
    let still_current = view.as_ref().is_some_and(|item| item.still_current) && stored.recorded;
    Ok(OpinionReceipt {
        outcome: stored.outcome,
        recorded: stored.recorded,
        replayed,
        operation_id: stored.operation_id,
        workspace_id: workspace_id.clone(),
        opinion_id: stored.opinion_id,
        revision_id: stored.revision_id,
        revision: stored.revision,
        evidence_refs: stored.source_ids,
        still_current,
        detail: stored.detail,
        view,
    })
}

fn caller_label(tx: &Transaction<'_>, ctx: &MemoryCallContext) -> Result<String> {
    caller_label_direct(tx, &ctx.workspace_id, &ctx.caller)
}

fn caller_label_direct(
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

fn opinion_label(status: &str, historical: bool, judgment_generated: bool) -> String {
    if historical {
        return "历史观点，不是当前判断".to_string();
    }
    match status {
        "pending_revision" => "待修订：只记录了用户意见，未生成新判断".to_string(),
        "shelved" => "已搁置，不是否定事实".to_string(),
        "disputed" => "有争议，不是已核实事实".to_string(),
        "retracted" => "已撤回，历史仍在".to_string(),
        _ if !judgment_generated => "当前观点状态已记录，不是新生成的判断".to_string(),
        _ => "当前观点，不是已核实事实".to_string(),
    }
}

fn title_of(summary: &str) -> String {
    format!("观点 {}", summary.chars().take(32).collect::<String>())
}

fn json_string_list(value: &str) -> Vec<String> {
    serde_json::from_str(value).unwrap_or_default()
}

fn uuid_hex() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
