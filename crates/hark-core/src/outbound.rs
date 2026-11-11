//! Isolated approval ledger, not a transport or a complete send authorization.
//!
//! Only trusted Native code may construct the binding from the actual serialized
//! request and the precise sources represented in it. This API verifies stored
//! source records, not the current filesystem. Nor does consuming a receipt make
//! a later send atomic with revocation. The production transport remains closed
//! until both properties are provided by the sender at the actual send boundary.

use chrono::Utc;
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{CoreError, ErrorCode, Result};
use crate::limits::ONBOARDING_GENERATION;
use crate::{Core, RootId, RunId, SourceId, WorkspaceId};

pub const STEPFUN_OUTBOUND_ENDPOINT: &str =
    "https://api.stepfun.com/step_plan/v1/messages?beta=true";
pub const STEPFUN_OUTBOUND_MODEL: &str = "step-3.7-flash";
const MAX_SOURCES: usize = 128;
const MAX_APPROVAL_MS: i64 = 120_000;

/// Snapshot captured from the exact sources represented in this request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutboundSource {
    pub source_id: SourceId,
    pub content_sha256: String,
    pub byte_len: u64,
    pub truncated: bool,
}

/// Never obtain this structure directly from a frontend or model response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundBinding {
    pub workspace_id: WorkspaceId,
    pub run_id: RunId,
    pub root_id: RootId,
    pub endpoint: String,
    pub provider: String,
    pub model: String,
    pub body_sha256: String,
    pub limits_sha256: String,
    pub sources: Vec<OutboundSource>,
    pub expires_at_ms: i64,
}

fn rejected(reason: &'static str) -> CoreError {
    CoreError::new(ErrorCode::ModelNotAuthorized, reason)
}

fn valid_sha(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn validate(binding: &OutboundBinding) -> Result<()> {
    let now = Utc::now().timestamp_millis();
    if binding.endpoint != STEPFUN_OUTBOUND_ENDPOINT
        || binding.provider != "stepfun"
        || binding.model != STEPFUN_OUTBOUND_MODEL
        || !valid_sha(&binding.body_sha256)
        || !valid_sha(&binding.limits_sha256)
        || binding.expires_at_ms <= now
        || binding.expires_at_ms > now + MAX_APPROVAL_MS
        || binding.sources.len() > MAX_SOURCES
        || binding
            .sources
            .iter()
            .any(|s| !valid_sha(&s.content_sha256))
    {
        return Err(rejected("invalid or expired outbound binding"));
    }
    Ok(())
}

struct Current {
    root_updated_at: String,
    grant_updated_at: String,
    sources_sha256: String,
}

fn require_current(tx: &Transaction<'_>, binding: &OutboundBinding) -> Result<Current> {
    // Never select an ambiguous identity, even if the random IDs collide
    // across the two independently stored run types.
    let matches: i64 = tx.query_row(
        "SELECT (EXISTS(SELECT 1 FROM conversation_runs WHERE id=?1 AND workspace_id=?2)
             + EXISTS(SELECT 1 FROM onboarding_runs WHERE active_run_id=?1 AND workspace_id=?2 AND generation=?3))",
        params![binding.run_id.as_str(), binding.workspace_id.as_str(), ONBOARDING_GENERATION],
        |row| row.get(0),
    )?;
    if matches != 1 {
        return Err(rejected("run missing or ambiguous"));
    }
    let row = tx
        .query_row(
            "SELECT run.state, run.provider, run.model, run.root_updated_at, run.grant_updated_at,
                w.root_id, r.status, r.updated_at, g.status, g.updated_at, g.provider, g.model
         FROM (
             SELECT workspace_id, id AS run_id, state, provider, model, root_updated_at, grant_updated_at
             FROM conversation_runs WHERE id=?1 AND workspace_id=?2
             UNION ALL
             SELECT workspace_id, active_run_id AS run_id, state,
               auth_provider AS provider, auth_model AS model,
               auth_root_updated_at AS root_updated_at, auth_grant_updated_at AS grant_updated_at
             FROM onboarding_runs
             WHERE active_run_id=?1 AND workspace_id=?2 AND generation=?3
               AND state='analyzing' AND opening_presented=0
         ) run JOIN workspaces w ON w.id=run.workspace_id
         JOIN authorized_roots r ON r.id=w.root_id
         JOIN service_grants g ON g.workspace_id=w.id AND g.service='model'",
            params![binding.run_id.as_str(), binding.workspace_id.as_str(), ONBOARDING_GENERATION],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                ))
            },
        )
        .optional()?;
    let Some((
        state,
        provider,
        model,
        root_revision,
        grant_revision,
        root_id,
        root_status,
        root_current,
        grant_status,
        grant_current,
        grant_provider,
        grant_model,
    )) = row
    else {
        return Err(rejected("run or grant missing"));
    };
    if !matches!(state.as_str(), "pending" | "running" | "analyzing")
        || root_id != binding.root_id.as_str()
        || root_status != "active"
        || root_revision != root_current
        || grant_status != "enabled"
        || grant_revision != grant_current
        || provider != binding.provider
        || model != binding.model
        || grant_provider.as_deref() != Some(binding.provider.as_str())
        || grant_model.as_deref() != Some(binding.model.as_str())
    {
        return Err(rejected("run or authorization changed"));
    }
    // Sort explicitly; order of unrelated historical rows never affects this request.
    let mut sources = binding.sources.clone();
    sources.sort_by(|a, b| a.source_id.as_str().cmp(b.source_id.as_str()));
    if sources.windows(2).any(|p| p[0].source_id == p[1].source_id) {
        return Err(rejected("duplicate outbound source"));
    }
    let mut snapshot = Vec::with_capacity(sources.len());
    for source in sources {
        let row = tx.query_row(
            "SELECT relative_path, content_sha256, byte_len, truncated FROM source_refs WHERE id=?1 AND workspace_id=?2",
            params![source.source_id.as_str(), binding.workspace_id.as_str()],
            |row| Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?, row.get::<_,u64>(2)?, row.get::<_,bool>(3)?)),
        ).optional()?;
        let Some((path, hash, len, truncated)) = row else {
            return Err(rejected("source missing"));
        };
        if hash != source.content_sha256 || len != source.byte_len || truncated != source.truncated
        {
            return Err(rejected("source snapshot changed"));
        }
        snapshot.push((
            source.source_id.as_str().to_owned(),
            path,
            hash,
            len,
            truncated,
        ));
    }
    let encoded = serde_json::to_vec(&snapshot).map_err(|_| rejected("source snapshot invalid"))?;
    Ok(Current {
        root_updated_at: root_current,
        grant_updated_at: grant_current,
        sources_sha256: hex::encode(Sha256::digest(encoded)),
    })
}

impl Core {
    /// Only a trusted native handler may call this after explicit user review.
    pub fn approve_outbound(&self, binding: &OutboundBinding) -> Result<String> {
        self.with_immediate_tx(|tx| {
            validate(binding)?;
            let current = require_current(tx, binding)?;
            let id = format!("approval_{}", Uuid::new_v4().simple());
            append(tx, &id, "approved", binding, &current)?;
            Ok(id)
        })
    }

    /// Recheck and consume once. This alone does not authorize a later network call.
    pub fn consume_outbound(&self, id: &str, binding: &OutboundBinding) -> Result<()> {
        self.with_immediate_tx(|tx| {
            validate(binding)?;
            let current = require_current(tx, binding)?;
            let found: i64 = tx.query_row(
                "SELECT COUNT(*) FROM outbound_review_events a WHERE a.approval_id=?1 AND a.phase='approved'
                 AND a.workspace_id=?2 AND a.run_id=?3 AND a.root_id=?4 AND a.endpoint=?5
                 AND a.provider=?6 AND a.model=?7 AND a.body_sha256=?8 AND a.source_snapshot_sha256=?9
                 AND a.limits_sha256=?10 AND a.root_updated_at=?11 AND a.grant_updated_at=?12 AND a.expires_at_ms=?13
                 AND NOT EXISTS (SELECT 1 FROM outbound_review_events c WHERE c.approval_id=a.approval_id AND c.phase='consumed')",
                params![id, binding.workspace_id.as_str(), binding.run_id.as_str(), binding.root_id.as_str(),
                    binding.endpoint, binding.provider, binding.model, binding.body_sha256, current.sources_sha256,
                    binding.limits_sha256, current.root_updated_at, current.grant_updated_at, binding.expires_at_ms], |row| row.get(0),
            )?;
            if found != 1 { return Err(rejected("approval missing, changed or already consumed")); }
            append(tx, id, "consumed", binding, &current)
        })
    }

    /// Experimental synchronous send boundary. The consumed receipt is first
    /// committed so a crash or an ambiguous transport error cannot reuse it.
    /// A second immediate transaction rechecks the authorization and keeps the
    /// database writer lock while `begin` runs. A sender using this must start
    /// the actual socket write synchronously inside `begin`, not queue work to
    /// another process; returning a future or a queued operation is unsafe.
    /// The callback must not re-enter Core or wait for UI/IPC, which would
    /// deadlock or hold the database lock for an unbounded period.
    ///
    /// This is not wired to the desktop. It does not validate the current
    /// filesystem or prove that the source list covers the serialized body.
    /// SQLite cannot roll back a network request; after any failure the
    /// receipt remains consumed and the caller must not retry automatically.
    /// Long callbacks delay or can make concurrent revocation return busy.
    pub fn consume_and_begin_outbound<T>(
        &self,
        id: &str,
        binding: &OutboundBinding,
        begin: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        self.consume_outbound(id, binding)?;
        self.with_immediate_tx(|tx| {
            validate(binding)?;
            require_current(tx, binding)?;
            begin()
        })
    }
}

fn append(
    tx: &Transaction<'_>,
    id: &str,
    phase: &str,
    b: &OutboundBinding,
    c: &Current,
) -> Result<()> {
    tx.execute(
        "INSERT INTO outbound_review_events (approval_id,phase,workspace_id,run_id,root_id,endpoint,provider,model,body_sha256,source_snapshot_sha256,limits_sha256,grant_updated_at,root_updated_at,expires_at_ms,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![id, phase, b.workspace_id.as_str(), b.run_id.as_str(), b.root_id.as_str(), b.endpoint,
            b.provider, b.model, b.body_sha256, c.sources_sha256, b.limits_sha256, c.grant_updated_at,
            c.root_updated_at, b.expires_at_ms, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}
