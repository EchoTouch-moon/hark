//! Ordinary user→assistant turns. Not onboarding, and not a model transport.
//!
//! Core binds a stored user message to a run and persists the assistant text
//! only when trusted Native submits after its own stream completion. There is
//! no success flag and this module does not open a network connection.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, ErrorCode, Result};
use crate::grant;
use crate::ids::{ConversationId, MessageId, RunId, WorkspaceId};
use crate::limits::{MAX_EVENT_BODY_CHARS, MAX_USER_MESSAGE_CHARS};
use crate::messages::{self, ConversationEvent};
use crate::policy::{looks_like_secret_text, validate_provider_token};
use crate::workspace::{self, Workspace};
use crate::Core;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationRunStart {
    /// Stable idempotency key. HarkBridge `requestId` maps here.
    pub request_id: String,
    pub workspace_id: WorkspaceId,
    pub conversation_id: ConversationId,
    /// Already stored `user_message`. Omit only when `user_text` should be stored.
    #[serde(default)]
    pub user_message_id: Option<MessageId>,
    /// Frontend `userPrompt`. On replay it must match the accepted body.
    #[serde(default)]
    pub user_text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRun {
    pub id: RunId,
    pub request_id: String,
    pub workspace_id: WorkspaceId,
    pub conversation_id: ConversationId,
    pub user_message_id: MessageId,
    pub state: String,
    pub provider: String,
    pub model: String,
    pub grant_updated_at: String,
    pub root_updated_at: String,
    pub session_ref: Option<String>,
    pub assistant_message_id: Option<MessageId>,
    pub error_code: Option<String>,
    pub replayed: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedConversationRun {
    pub run: ConversationRun,
    pub accepted_user_message: ConversationEvent,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationCommit {
    pub workspace_id: WorkspaceId,
    pub run_id: RunId,
    pub receipt_id: String,
    pub provider: String,
    pub model: String,
    pub body: String,
    pub source_ids: Vec<crate::ids::SourceId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationTurn {
    pub run: ConversationRun,
    pub assistant_message: ConversationEvent,
    pub replayed: bool,
}

/// Latest Pi session stored on an ordinary run. Not the opening binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrdinarySessionHint {
    pub run_id: RunId,
    pub session_ref: String,
    pub updated_at: String,
}

struct AuthSnap {
    provider: String,
    model: String,
    grant_updated_at: String,
    root_updated_at: String,
}

struct RunRow {
    id: String,
    request_id: String,
    workspace_id: String,
    conversation_id: String,
    user_message_id: String,
    state: String,
    provider: String,
    model: String,
    grant_updated_at: String,
    root_updated_at: String,
    session_ref: Option<String>,
    assistant_message_id: Option<String>,
    receipt_id: Option<String>,
    error_code: Option<String>,
    created_at: String,
    updated_at: String,
}

impl Core {
    /// Bind an ordinary run to a stored user message, or store `user_text` once.
    /// The same `request_id` replays the run and accepted message. Does not call
    /// a model, fold a scan card, or write onboarding.
    pub fn start_conversation_run(
        &self,
        start: &ConversationRunStart,
    ) -> Result<StartedConversationRun> {
        let request_id = validate_request_id(&start.request_id)?;
        self.with_tx(|tx| start_tx(tx, start, &request_id))
    }

    /// Mark the trusted stream running and optionally store a Pi `sessionRef`.
    /// Not completion. A model success flag is not accepted here.
    pub fn register_conversation_run(
        &self,
        workspace_id: &WorkspaceId,
        run_id: &RunId,
        session_ref: Option<&str>,
    ) -> Result<ConversationRun> {
        if let Some(session_ref) = session_ref {
            if !messages::session_ref_shape(session_ref) {
                return Err(CoreError::new(
                    ErrorCode::CorrelationRejected,
                    "sessionRef is not a pi session id",
                ));
            }
        }
        self.with_tx(|tx| register_tx(tx, workspace_id, run_id, session_ref))
    }

    /// Persist one `agent_message` after Native has observed real stream completion.
    /// Empty source ids are allowed. Forged or cross-workspace ids are not.
    pub fn commit_conversation_message(
        &self,
        commit: &ConversationCommit,
    ) -> Result<ConversationTurn> {
        validate_provider_token(&commit.provider)?;
        validate_provider_token(&commit.model)?;
        let receipt_id = commit.receipt_id.trim();
        if receipt_id.is_empty() || receipt_id.len() > 128 {
            return Err(CoreError::new(
                ErrorCode::ModelReceiptRejected,
                "receipt id missing",
            ));
        }
        let body = commit.body.trim();
        if body.is_empty() || body.chars().count() > MAX_EVENT_BODY_CHARS {
            return Err(CoreError::new(
                ErrorCode::ModelReceiptRejected,
                "assistant body empty or too long",
            ));
        }
        self.with_tx(|tx| commit_tx(tx, commit, receipt_id, body))
    }

    pub fn cancel_conversation_run(
        &self,
        workspace_id: &WorkspaceId,
        run_id: &RunId,
    ) -> Result<ConversationRun> {
        // Serialize cancellation with the outbound admission boundary.
        self.with_immediate_tx(|tx| cancel_tx(tx, workspace_id, run_id))
    }

    pub fn fail_conversation_run(
        &self,
        workspace_id: &WorkspaceId,
        run_id: &RunId,
        reason: &str,
    ) -> Result<ConversationRun> {
        let reason = reason.trim();
        if reason.is_empty() || reason.chars().count() > 200 {
            return Err(CoreError::new(
                ErrorCode::InvalidMessage,
                "failure reason empty or too long",
            ));
        }
        self.with_tx(|tx| fail_tx(tx, workspace_id, run_id, reason))
    }

    pub fn get_conversation_run(
        &self,
        workspace_id: &WorkspaceId,
        run_id: &RunId,
    ) -> Result<ConversationRun> {
        self.with_conn(|conn| {
            let row = require_owned_run(conn, workspace_id, run_id)?;
            Ok(to_run(&row, false))
        })
    }

    /// Recover a HarkBridge turn when Native still has `requestId` but lost the response.
    pub fn conversation_run_by_request(
        &self,
        workspace_id: &WorkspaceId,
        request_id: &str,
    ) -> Result<Option<StartedConversationRun>> {
        let request_id = validate_request_id(request_id)?;
        self.with_conn(|conn| {
            if workspace::load_workspace(conn, workspace_id)?.is_none() {
                return Err(CoreError::new(
                    ErrorCode::WorkspaceNotFound,
                    workspace_id.as_str(),
                ));
            }
            match load_run_by_request(conn, &request_id)? {
                None => Ok(None),
                Some(row) if row.workspace_id != workspace_id.as_str() => Err(CoreError::new(
                    ErrorCode::CrossWorkspaceRef,
                    "request id belongs to another workspace",
                )),
                Some(row) => Ok(Some(started(conn, &row, true)?)),
            }
        })
    }

    /// Newest ordinary `sessionRef` for this workspace. Does not read or write
    /// the opening binding, and does not create a table.
    pub fn latest_ordinary_session(
        &self,
        workspace_id: &WorkspaceId,
    ) -> Result<Option<OrdinarySessionHint>> {
        self.with_conn(|conn| {
            if workspace::load_workspace(conn, workspace_id)?.is_none() {
                return Err(CoreError::new(
                    ErrorCode::WorkspaceNotFound,
                    workspace_id.as_str(),
                ));
            }
            let found = conn
                .query_row(
                    "SELECT id, session_ref, updated_at FROM conversation_runs
                     WHERE workspace_id = ?1 AND session_ref IS NOT NULL
                     ORDER BY updated_at DESC, id DESC
                     LIMIT 1",
                    params![workspace_id.as_str()],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?;
            Ok(
                found.map(|(id, session_ref, updated_at)| OrdinarySessionHint {
                    run_id: RunId::from_trusted(id),
                    session_ref,
                    updated_at,
                }),
            )
        })
    }
}

fn start_tx(
    tx: &rusqlite::Transaction<'_>,
    start: &ConversationRunStart,
    request_id: &str,
) -> Result<StartedConversationRun> {
    if let Some(existing) = load_run_by_request(tx, request_id)? {
        return replay_start(tx, start, &existing);
    }
    let ws = workspace::load_workspace(tx, &start.workspace_id)?
        .ok_or_else(|| CoreError::new(ErrorCode::WorkspaceNotFound, start.workspace_id.as_str()))?;
    if ws.conversation_id.as_str() != start.conversation_id.as_str() {
        return Err(CoreError::new(
            ErrorCode::CorrelationRejected,
            "conversation does not belong to this workspace",
        ));
    }
    let snap = current_auth(tx, &ws.id)?;
    let message = bind_user_message(tx, &ws, start)?;
    if load_run_by_user_message(tx, message.id.as_str())?.is_some() {
        return Err(CoreError::new(
            ErrorCode::CorrelationRejected,
            "user message already bound to a conversation run",
        ));
    }
    let run_id = RunId::new();
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO conversation_runs (
            id, workspace_id, conversation_id, user_message_id, request_id, state,
            provider, model, grant_updated_at, root_updated_at, session_ref,
            assistant_message_id, receipt_id, error_code, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?9, NULL, NULL, NULL, NULL, ?10, ?10)",
        params![
            run_id.as_str(),
            ws.id.as_str(),
            ws.conversation_id.as_str(),
            message.id.as_str(),
            request_id,
            snap.provider,
            snap.model,
            snap.grant_updated_at,
            snap.root_updated_at,
            now,
        ],
    )?;
    let row = require_owned_run(tx, &ws.id, &run_id)?;
    started(tx, &row, false)
}

fn replay_start(
    conn: &Connection,
    start: &ConversationRunStart,
    existing: &RunRow,
) -> Result<StartedConversationRun> {
    if existing.workspace_id != start.workspace_id.as_str() {
        return Err(CoreError::new(
            ErrorCode::CrossWorkspaceRef,
            "request id belongs to another workspace",
        ));
    }
    if existing.conversation_id != start.conversation_id.as_str() {
        return Err(CoreError::new(
            ErrorCode::CorrelationRejected,
            "request id belongs to another conversation",
        ));
    }
    if let Some(id) = &start.user_message_id {
        if existing.user_message_id != id.as_str() {
            return Err(CoreError::new(
                ErrorCode::CorrelationRejected,
                "request id already bound to another user message",
            ));
        }
    }
    let message = load_event_by_id(conn, &existing.user_message_id)?;
    if let Some(text) = &start.user_text {
        if text.trim() != message.body {
            return Err(CoreError::new(
                ErrorCode::CorrelationRejected,
                "request id already accepted different user text",
            ));
        }
    }
    started(conn, existing, true)
}

fn bind_user_message(
    tx: &rusqlite::Transaction<'_>,
    ws: &Workspace,
    start: &ConversationRunStart,
) -> Result<ConversationEvent> {
    match (&start.user_message_id, start.user_text.as_deref()) {
        (Some(id), text) => {
            let event = load_user_message(tx, ws, id)?;
            if let Some(text) = text {
                if text.trim() != event.body {
                    return Err(CoreError::new(
                        ErrorCode::CorrelationRejected,
                        "user text does not match the stored user message",
                    ));
                }
            }
            Ok(event)
        }
        (None, Some(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() || trimmed.chars().count() > MAX_USER_MESSAGE_CHARS {
                return Err(CoreError::new(
                    ErrorCode::InvalidMessage,
                    "user message empty or too long",
                ));
            }
            messages::insert_event(tx, ws, "user_message", None, trimmed, "normal", &[], None)
        }
        (None, None) => Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "stored user message or user text required",
        )),
    }
}

fn register_tx(
    tx: &rusqlite::Transaction<'_>,
    workspace_id: &WorkspaceId,
    run_id: &RunId,
    session_ref: Option<&str>,
) -> Result<ConversationRun> {
    let row = require_owned_run(tx, workspace_id, run_id)?;
    let snap = current_auth(tx, workspace_id)?;
    require_run_auth(&row, &snap)?;
    match row.state.as_str() {
        "pending" => {
            tx.execute(
                "UPDATE conversation_runs
                 SET state = 'running', session_ref = ?1, updated_at = ?2
                 WHERE id = ?3 AND workspace_id = ?4 AND state = 'pending'",
                params![
                    session_ref,
                    Utc::now().to_rfc3339(),
                    row.id,
                    workspace_id.as_str()
                ],
            )?;
            Ok(to_run(&require_owned_run(tx, workspace_id, run_id)?, false))
        }
        "running" => bind_session_if_unset(tx, workspace_id, run_id, &row, session_ref),
        "committed" => {
            if session_ref.is_none() || session_ref == row.session_ref.as_deref() {
                Ok(to_run(&row, true))
            } else if row.session_ref.is_none() {
                bind_session_if_unset(tx, workspace_id, run_id, &row, session_ref)
            } else {
                Err(CoreError::new(
                    ErrorCode::CorrelationRejected,
                    "same conversation run cannot replace sessionRef",
                ))
            }
        }
        "cancelled" => Err(CoreError::new(
            ErrorCode::Cancelled,
            "cancelled run cannot be registered",
        )),
        "failed" => Err(CoreError::new(
            ErrorCode::ModelReceiptRejected,
            "failed run cannot be registered",
        )),
        other => Err(CoreError::new(
            ErrorCode::Sqlite,
            format!("unknown conversation run state {other}"),
        )),
    }
}

fn bind_session_if_unset(
    tx: &rusqlite::Transaction<'_>,
    workspace_id: &WorkspaceId,
    run_id: &RunId,
    row: &RunRow,
    session_ref: Option<&str>,
) -> Result<ConversationRun> {
    match session_ref {
        None => Ok(to_run(row, true)),
        Some(next) => match row.session_ref.as_deref() {
            None => {
                tx.execute(
                    "UPDATE conversation_runs SET session_ref = ?1, updated_at = ?2
                     WHERE id = ?3 AND workspace_id = ?4 AND session_ref IS NULL",
                    params![next, Utc::now().to_rfc3339(), row.id, workspace_id.as_str()],
                )?;
                Ok(to_run(&require_owned_run(tx, workspace_id, run_id)?, false))
            }
            Some(current) if current == next => Ok(to_run(row, true)),
            Some(_) => Err(CoreError::new(
                ErrorCode::CorrelationRejected,
                "same conversation run cannot replace sessionRef",
            )),
        },
    }
}

fn commit_tx(
    tx: &rusqlite::Transaction<'_>,
    commit: &ConversationCommit,
    receipt_id: &str,
    body: &str,
) -> Result<ConversationTurn> {
    let row = require_owned_run(tx, &commit.workspace_id, &commit.run_id)?;
    if row.state == "committed" {
        return replay_commit(tx, &row, commit, receipt_id, body);
    }
    if row.state == "cancelled" {
        return Err(CoreError::new(
            ErrorCode::Cancelled,
            "late conversation commit after cancel",
        ));
    }
    if row.state == "failed" {
        return Err(CoreError::new(
            ErrorCode::ModelReceiptRejected,
            "failed run cannot be committed",
        ));
    }
    if row.state != "running" {
        return Err(CoreError::new(
            ErrorCode::ModelReceiptRejected,
            "stream_not_registered",
        ));
    }
    let snap = current_auth(tx, &commit.workspace_id)?;
    if commit.provider != snap.provider {
        return Err(CoreError::new(
            ErrorCode::ProviderMismatch,
            "receipt provider does not match grant",
        ));
    }
    if commit.model != snap.model {
        return Err(CoreError::new(
            ErrorCode::ModelMismatch,
            "receipt model does not match grant",
        ));
    }
    if commit.provider != row.provider {
        return Err(CoreError::new(
            ErrorCode::ProviderMismatch,
            "receipt provider does not match run",
        ));
    }
    if commit.model != row.model {
        return Err(CoreError::new(
            ErrorCode::ModelMismatch,
            "receipt model does not match run",
        ));
    }
    if row.grant_updated_at != snap.grant_updated_at || row.root_updated_at != snap.root_updated_at
    {
        return Err(CoreError::new(
            ErrorCode::RunMismatch,
            "authorization_snapshot_stale",
        ));
    }
    messages::require_same_workspace_sources(tx, &commit.workspace_id, &commit.source_ids)?;
    let ws = workspace::load_workspace(tx, &commit.workspace_id)?.ok_or_else(|| {
        CoreError::new(ErrorCode::WorkspaceNotFound, commit.workspace_id.as_str())
    })?;
    let event = messages::insert_event(
        tx,
        &ws,
        "agent_message",
        None,
        body,
        "normal",
        &commit.source_ids,
        Some(receipt_id),
    )?;
    let updated = tx.execute(
        "UPDATE conversation_runs
         SET state = 'committed', assistant_message_id = ?1, receipt_id = ?2,
             error_code = NULL, updated_at = ?3
         WHERE id = ?4 AND workspace_id = ?5 AND state = 'running'",
        params![
            event.id.as_str(),
            receipt_id,
            Utc::now().to_rfc3339(),
            row.id,
            commit.workspace_id.as_str(),
        ],
    )?;
    if updated != 1 {
        return Err(CoreError::new(
            ErrorCode::RunMismatch,
            "conversation run was no longer running",
        ));
    }
    let stored = require_owned_run(tx, &commit.workspace_id, &commit.run_id)?;
    Ok(ConversationTurn {
        run: to_run(&stored, false),
        assistant_message: event,
        replayed: false,
    })
}

fn replay_commit(
    conn: &Connection,
    row: &RunRow,
    commit: &ConversationCommit,
    receipt_id: &str,
    body: &str,
) -> Result<ConversationTurn> {
    let Some(assistant_id) = row.assistant_message_id.as_deref() else {
        return Err(CoreError::new(
            ErrorCode::ModelReceiptRejected,
            "committed run missing assistant message",
        ));
    };
    let event = load_event_by_id(conn, assistant_id)?;
    let same = row.receipt_id.as_deref() == Some(receipt_id)
        && event.body == body
        && event.kind == "agent_message"
        && event.source_ids == commit.source_ids;
    if !same {
        return Err(CoreError::new(
            ErrorCode::ModelReceiptRejected,
            "commit_conflict",
        ));
    }
    Ok(ConversationTurn {
        run: to_run(row, true),
        assistant_message: event,
        replayed: true,
    })
}

fn cancel_tx(
    tx: &rusqlite::Transaction<'_>,
    workspace_id: &WorkspaceId,
    run_id: &RunId,
) -> Result<ConversationRun> {
    let row = require_owned_run(tx, workspace_id, run_id)?;
    match row.state.as_str() {
        "cancelled" => Ok(to_run(&row, true)),
        "pending" | "running" => {
            tx.execute(
                "UPDATE conversation_runs SET state = 'cancelled', updated_at = ?1
                 WHERE id = ?2 AND workspace_id = ?3 AND state IN ('pending', 'running')",
                params![Utc::now().to_rfc3339(), row.id, workspace_id.as_str()],
            )?;
            Ok(to_run(&require_owned_run(tx, workspace_id, run_id)?, false))
        }
        "committed" => Err(CoreError::new(
            ErrorCode::ModelReceiptRejected,
            "committed run cannot be cancelled",
        )),
        "failed" => Err(CoreError::new(
            ErrorCode::ModelReceiptRejected,
            "failed run cannot be cancelled",
        )),
        other => Err(CoreError::new(
            ErrorCode::Sqlite,
            format!("unknown conversation run state {other}"),
        )),
    }
}

fn fail_tx(
    tx: &rusqlite::Transaction<'_>,
    workspace_id: &WorkspaceId,
    run_id: &RunId,
    reason: &str,
) -> Result<ConversationRun> {
    let row = require_owned_run(tx, workspace_id, run_id)?;
    match row.state.as_str() {
        "failed" if row.error_code.as_deref() == Some(reason) => Ok(to_run(&row, true)),
        "failed" => Err(CoreError::new(
            ErrorCode::ModelReceiptRejected,
            "failed run is terminal",
        )),
        "pending" | "running" => {
            tx.execute(
                "UPDATE conversation_runs SET state = 'failed', error_code = ?1, updated_at = ?2
                 WHERE id = ?3 AND workspace_id = ?4 AND state IN ('pending', 'running')",
                params![
                    reason,
                    Utc::now().to_rfc3339(),
                    row.id,
                    workspace_id.as_str()
                ],
            )?;
            Ok(to_run(&require_owned_run(tx, workspace_id, run_id)?, false))
        }
        "cancelled" => Err(CoreError::new(
            ErrorCode::Cancelled,
            "cancelled run cannot be failed",
        )),
        "committed" => Err(CoreError::new(
            ErrorCode::ModelReceiptRejected,
            "committed run cannot be failed",
        )),
        other => Err(CoreError::new(
            ErrorCode::Sqlite,
            format!("unknown conversation run state {other}"),
        )),
    }
}

/// Used inside the memory write transaction, not as a separate preflight check.
pub(crate) fn require_running_agent(
    conn: &Connection,
    workspace_id: &WorkspaceId,
    run_id: &RunId,
) -> Result<()> {
    let row = require_owned_run(conn, workspace_id, run_id)?;
    if row.state != "running" {
        return Err(CoreError::new(
            ErrorCode::RunMismatch,
            "memory writer run is not running",
        ));
    }
    require_run_auth(&row, &current_auth(conn, workspace_id)?)
}

fn current_auth(conn: &Connection, workspace_id: &WorkspaceId) -> Result<AuthSnap> {
    let (provider, model, grant_updated_at) = messages::explicit_model_grant(conn, workspace_id)?;
    let root = messages::root_for_workspace(conn, workspace_id)?;
    grant::require_active(&root)?;
    Ok(AuthSnap {
        provider,
        model,
        grant_updated_at,
        root_updated_at: root.updated_at,
    })
}

fn require_run_auth(row: &RunRow, snap: &AuthSnap) -> Result<()> {
    if row.provider != snap.provider {
        return Err(CoreError::new(
            ErrorCode::ProviderMismatch,
            "run provider does not match grant",
        ));
    }
    if row.model != snap.model {
        return Err(CoreError::new(
            ErrorCode::ModelMismatch,
            "run model does not match grant",
        ));
    }
    if row.grant_updated_at != snap.grant_updated_at || row.root_updated_at != snap.root_updated_at
    {
        return Err(CoreError::new(
            ErrorCode::RunMismatch,
            "authorization_snapshot_stale",
        ));
    }
    Ok(())
}

fn validate_request_id(value: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "request id empty or too long",
        ));
    }
    if trimmed.chars().any(|ch| ch.is_control()) || looks_like_secret_text(trimmed) {
        return Err(CoreError::new(
            ErrorCode::SecretMaterialRejected,
            "request id is not a stable idempotency key",
        ));
    }
    Ok(trimmed.to_string())
}

fn started(conn: &Connection, row: &RunRow, replayed: bool) -> Result<StartedConversationRun> {
    let accepted_user_message = load_event_by_id(conn, &row.user_message_id)?;
    Ok(StartedConversationRun {
        run: to_run(row, replayed),
        accepted_user_message,
        replayed,
    })
}

fn to_run(row: &RunRow, replayed: bool) -> ConversationRun {
    ConversationRun {
        id: RunId::from_trusted(row.id.clone()),
        request_id: row.request_id.clone(),
        workspace_id: WorkspaceId::from_trusted(row.workspace_id.clone()),
        conversation_id: ConversationId::from_trusted(row.conversation_id.clone()),
        user_message_id: MessageId::from_trusted(row.user_message_id.clone()),
        state: row.state.clone(),
        provider: row.provider.clone(),
        model: row.model.clone(),
        grant_updated_at: row.grant_updated_at.clone(),
        root_updated_at: row.root_updated_at.clone(),
        session_ref: row.session_ref.clone(),
        assistant_message_id: row
            .assistant_message_id
            .clone()
            .map(MessageId::from_trusted),
        error_code: row.error_code.clone(),
        replayed,
        created_at: row.created_at.clone(),
        updated_at: row.updated_at.clone(),
    }
}

fn require_owned_run(
    conn: &Connection,
    workspace_id: &WorkspaceId,
    run_id: &RunId,
) -> Result<RunRow> {
    match load_run_by_id(conn, run_id.as_str())? {
        None => Err(CoreError::new(ErrorCode::RunMismatch, "run_not_found")),
        Some(row) if row.workspace_id != workspace_id.as_str() => Err(CoreError::new(
            ErrorCode::CrossWorkspaceRef,
            run_id.as_str(),
        )),
        Some(row) => Ok(row),
    }
}

fn load_run_by_request(conn: &Connection, request_id: &str) -> Result<Option<RunRow>> {
    conn.query_row(
        &format!("{RUN_SELECT} WHERE request_id = ?1"),
        params![request_id],
        map_run,
    )
    .optional()
    .map_err(CoreError::from)
}

fn load_run_by_id(conn: &Connection, run_id: &str) -> Result<Option<RunRow>> {
    conn.query_row(
        &format!("{RUN_SELECT} WHERE id = ?1"),
        params![run_id],
        map_run,
    )
    .optional()
    .map_err(CoreError::from)
}

fn load_run_by_user_message(conn: &Connection, message_id: &str) -> Result<Option<RunRow>> {
    conn.query_row(
        &format!("{RUN_SELECT} WHERE user_message_id = ?1"),
        params![message_id],
        map_run,
    )
    .optional()
    .map_err(CoreError::from)
}

const RUN_SELECT: &str =
    "SELECT id, request_id, workspace_id, conversation_id, user_message_id, state,
    provider, model, grant_updated_at, root_updated_at, session_ref,
    assistant_message_id, receipt_id, error_code, created_at, updated_at
    FROM conversation_runs";

fn map_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunRow> {
    Ok(RunRow {
        id: row.get(0)?,
        request_id: row.get(1)?,
        workspace_id: row.get(2)?,
        conversation_id: row.get(3)?,
        user_message_id: row.get(4)?,
        state: row.get(5)?,
        provider: row.get(6)?,
        model: row.get(7)?,
        grant_updated_at: row.get(8)?,
        root_updated_at: row.get(9)?,
        session_ref: row.get(10)?,
        assistant_message_id: row.get(11)?,
        receipt_id: row.get(12)?,
        error_code: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn load_event_by_id(conn: &Connection, id: &str) -> Result<ConversationEvent> {
    conn.query_row(
        "SELECT id, workspace_id, conversation_id, kind, generation, body, presentation, source_ids_json, created_at
         FROM conversation_events WHERE id = ?1",
        params![id],
        messages::map_event,
    )
    .optional()?
    .ok_or_else(|| CoreError::new(ErrorCode::InvalidMessage, "conversation event missing"))
}

fn load_user_message(
    conn: &Connection,
    ws: &Workspace,
    id: &MessageId,
) -> Result<ConversationEvent> {
    let Some(event) = conn
        .query_row(
            "SELECT id, workspace_id, conversation_id, kind, generation, body, presentation, source_ids_json, created_at
             FROM conversation_events WHERE id = ?1",
            params![id.as_str()],
            messages::map_event,
        )
        .optional()?
    else {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "user message is not stored",
        ));
    };
    if event.workspace_id.as_str() != ws.id.as_str() {
        return Err(CoreError::new(ErrorCode::CrossWorkspaceRef, id.as_str()));
    }
    if event.conversation_id != ws.conversation_id.as_str() {
        return Err(CoreError::new(
            ErrorCode::CorrelationRejected,
            "user message conversation does not belong to this workspace",
        ));
    }
    if event.kind != "user_message" {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "normal run requires a stored user_message",
        ));
    }
    Ok(event)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_payload_rejects_model_success_flag() {
        let raw = r#"{"workspaceId":"ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","runId":"run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","receiptId":"r","provider":"stepfun","model":"m","body":"hi","sourceIds":[],"success":true}"#;
        assert!(serde_json::from_str::<ConversationCommit>(raw).is_err());
    }
}
