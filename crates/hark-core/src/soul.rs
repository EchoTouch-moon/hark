//! Soul & Proactivity projections: L0/L1 Context Pack, verifiable NarrativeState,
//! and bounded incremental Workspace Observer + Attention projection.
//!
//! All directory inspection uses the fd-safe `reader` under `IoGate` admission.
//! Paused or revoked directories never trigger filesystem reads or source mutations.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{CoreError, ErrorCode, Result};
use crate::grant::{self, RootStatus};
use crate::ids::{ConversationId, SourceId, WorkspaceId};
use crate::limits::ONBOARDING_GENERATION;
use crate::memory::{self, MemoryNote};
use crate::messages::{self, OnboardingCheckpoint, SourceRef};
use crate::opinion::{self, OpinionView};
use crate::policy::is_key_file;
use crate::reader::{self, DirIdentity};
use crate::scan::ScanBudget;
use crate::search;
use crate::workspace::{self, Workspace};
use crate::{CancelFlag, Core};

const MAX_CONTEXT_IDENTITY_CHARS: usize = 2_000;
const MAX_CONTEXT_OVERVIEW_CHARS: usize = 4_000;
const MAX_PACK_IDENTITIES: usize = 8;
const MAX_PACK_DECISIONS: usize = 12;
const MAX_PACK_EXPERIENCES: usize = 8;
const MAX_PACK_SOURCES: usize = 16;
const MAX_PACK_OPINIONS_PER_BUCKET: usize = 8;
const MAX_PACK_ITEM_TEXT_CHARS: usize = 280;
const MAX_PACK_EXCERPT_CHARS: usize = 120;
const MAX_GIT_HEAD_BYTES: u64 = 4_096;

/// Compact request-level snapshot matching the Pi Agent Host `ContextSnapshot` DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnapshot {
    pub context_pack_revision: String,
    pub source_version: String,
    pub empty: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overview: Option<String>,
}

/// Full L0/L1 Workspace Context Pack projection returned by [`Core::build_context_pack`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPack {
    pub workspace_id: WorkspaceId,
    pub context_pack_revision: String,
    pub source_version: String,
    pub empty: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overview: Option<String>,
    pub root_status: String,
    pub memory_count: usize,
    pub active_opinion_count: usize,
    pub attention_opinion_count: usize,
    pub source_count: usize,
    pub stale_source_count: usize,
}

impl ContextPack {
    pub fn to_snapshot(&self) -> ContextSnapshot {
        ContextSnapshot {
            context_pack_revision: self.context_pack_revision.clone(),
            source_version: self.source_version.clone(),
            empty: self.empty,
            identity: self.identity.clone(),
            overview: self.overview.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NarrativeAvailability {
    Known,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlameStage {
    Neutral,
    Ember,
    Gentle,
    Bright,
    Milestone,
}

/// Single verifiable projection driving both Flame and Story UI surfaces.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrativeState {
    pub availability: NarrativeAvailability,
    pub flame: FlameStage,
    pub stage_label: String,
    pub narrative_reason: String,
    pub basis_refs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_at: Option<String>,
    pub stale: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservationStatus {
    Observed,
    Paused,
    Revoked,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceFreshness {
    Fresh,
    Changed,
    Missing,
    Unreadable,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedFileChange {
    pub relative_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_source_id: Option<SourceId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_source_id: Option<SourceId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_sha256: Option<String>,
    pub freshness: SourceFreshness,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionItem {
    pub id: String,
    pub workspace_id: WorkspaceId,
    pub workspace_name: String,
    pub conversation_id: ConversationId,
    pub headline: String,
    pub why_now: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_opinion_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_evidence_id: Option<String>,
    pub created_at: String,
    pub dismissed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceObservationReport {
    pub workspace_id: WorkspaceId,
    pub status: ObservationStatus,
    pub observed_at: String,
    pub checked_paths: usize,
    pub changed_files: Vec<ObservedFileChange>,
    pub stale_opinion_ids: Vec<String>,
    pub attention_items: Vec<AttentionItem>,
    pub git_head_changed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_head: Option<String>,
    pub skipped: Vec<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ObserverState {
    last_observed_at: Option<String>,
    latest_source_by_path: BTreeMap<String, String>,
    stale_source_ids: BTreeSet<String>,
    missing_paths: BTreeMap<String, String>,
    unreadable_paths: BTreeMap<String, String>,
    git_head: Option<String>,
    git_head_sha256: Option<String>,
    git_head_changed_at: Option<String>,
    attention_timestamps: BTreeMap<String, String>,
    dismissed_attention_ids: BTreeSet<String>,
}

struct WorkspaceFacts {
    ws: Workspace,
    root_status: RootStatus,
    checkpoint: Option<OnboardingCheckpoint>,
    sources: Vec<SourceRef>,
    memories: Vec<MemoryNote>,
    opinions: Vec<OpinionView>,
    observer: ObserverState,
}

enum PendingDiskResult {
    Read {
        path: String,
        prev_source: Option<SourceRef>,
        bytes: messages::ReadBytesOwned,
        sha: String,
    },
    Missing {
        path: String,
        prev_source: SourceRef,
    },
    Unreadable {
        path: String,
        prev_source: SourceRef,
        reason: String,
    },
}

impl Core {
    /// Project bounded L0/L1 context for a workspace from active memories,
    /// structured opinions, and tracked source refs.
    pub fn build_context_pack(&self, workspace_id: &WorkspaceId) -> Result<ContextPack> {
        let facts = self.with_conn(|conn| load_workspace_facts(conn, workspace_id))?;
        Ok(project_context_pack(&facts))
    }

    /// Project verifiable [`NarrativeState`] from directory status, source freshness,
    /// opinions, and committed decisions. Never derived from chat message counts.
    pub fn workspace_narrative_state(&self, workspace_id: &WorkspaceId) -> Result<NarrativeState> {
        let facts = self.with_conn(|conn| load_workspace_facts(conn, workspace_id))?;
        Ok(project_narrative_state(&facts))
    }

    /// Perform a bounded incremental check of tracked `SourceRef`s, key files, and
    /// `.git/HEAD` (when inside the authorized root). Marks changed/missing sources
    /// and affected opinions `stale` while preserving history, and returns
    /// deduplicated [`AttentionItem`] candidates.
    pub fn observe_workspace_changes(
        &self,
        workspace_id: &WorkspaceId,
        budget: &ScanBudget,
        cancel: &CancelFlag,
    ) -> Result<WorkspaceObservationReport> {
        budget.validate()?;
        let (ws, root) = self.workspace_and_root(workspace_id)?;
        let now = Utc::now().to_rfc3339();
        if let Some(status) = inactive_observation_status(root.status) {
            let items = self.list_attention_items(workspace_id)?;
            return Ok(inactive_observation_report(
                workspace_id,
                status,
                &now,
                items,
            ));
        }

        let (sources, observer_state) = self.with_conn(|conn| {
            let sources = messages::load_sources(conn, workspace_id, true)?;
            let observer = load_observer_state(conn, workspace_id)?;
            Ok((sources, observer))
        })?;
        let latest_by_path = latest_sources_map(&sources, &observer_state);

        let root_id = root.id.clone();
        let check_id = root_id.clone();
        let admit_id = root_id.clone();
        let check = move || {
            let current = self.get_root(&check_id)?;
            grant::require_active(&current)
        };
        let admit =
            move |op: &mut dyn FnMut() -> Result<()>| self.admit_active_io(&admit_id, || op());
        let gate = grant::IoGate::new(&check, &admit);

        let listed = match reader::inspect_directory(
            Path::new(&root.path),
            &messages::root_identity(&root),
            &ws.relative_path,
            budget.max_entries,
            cancel,
            &gate,
        ) {
            Ok(dir) => dir,
            Err(err) if err.code == ErrorCode::RootPaused => {
                let items = self.list_attention_items(workspace_id)?;
                return Ok(inactive_observation_report(
                    workspace_id,
                    ObservationStatus::Paused,
                    &now,
                    items,
                ));
            }
            Err(err) if err.code == ErrorCode::RootRevoked => {
                let items = self.list_attention_items(workspace_id)?;
                return Ok(inactive_observation_report(
                    workspace_id,
                    ObservationStatus::Revoked,
                    &now,
                    items,
                ));
            }
            Err(err) => return Err(err),
        };

        let mut skipped = Vec::new();
        if listed.cancelled {
            skipped.push("cancelled".to_string());
        }
        if listed.hit_entry_limit {
            skipped.push("max_entries".to_string());
        }

        let mut candidate_paths: Vec<String> = latest_by_path.keys().cloned().collect();
        let mut new_key_files: Vec<String> = listed
            .children
            .into_iter()
            .filter_map(|child| match child {
                reader::ChildInspect::File { name, .. } if is_key_file(&name) => Some(name),
                _ => None,
            })
            .filter(|name| !latest_by_path.contains_key(name))
            .collect();
        new_key_files.sort_by_key(|name| key_file_priority(name));
        candidate_paths.extend(new_key_files);

        let mut pending = Vec::new();
        let mut checked_paths = 0_usize;
        let mut total_bytes = 0_u64;

        for path in candidate_paths {
            if cancel.is_cancelled() {
                if !skipped.iter().any(|s| s == "cancelled") {
                    skipped.push("cancelled".to_string());
                }
                break;
            }
            if checked_paths >= budget.max_entries as usize {
                if !skipped.iter().any(|s| s == "max_entries") {
                    skipped.push("max_entries".to_string());
                }
                break;
            }
            if total_bytes >= budget.max_total_bytes {
                skipped.push(format!("{path}:max_total_bytes"));
                break;
            }
            checked_paths += 1;
            let cap = budget
                .max_file_bytes
                .min(budget.max_total_bytes - total_bytes);
            let prev_source = latest_by_path.get(&path).cloned();
            match messages::read_checked(self, &root, &ws, &path, cap) {
                Ok(bytes) => {
                    total_bytes += bytes.bytes.len() as u64;
                    let sha = hex::encode(Sha256::digest(&bytes.bytes));
                    pending.push(PendingDiskResult::Read {
                        path,
                        prev_source,
                        bytes,
                        sha,
                    });
                }
                Err(err) if err.code == ErrorCode::RootPaused => {
                    let items = self.list_attention_items(workspace_id)?;
                    return Ok(inactive_observation_report(
                        workspace_id,
                        ObservationStatus::Paused,
                        &now,
                        items,
                    ));
                }
                Err(err) if err.code == ErrorCode::RootRevoked => {
                    let items = self.list_attention_items(workspace_id)?;
                    return Ok(inactive_observation_report(
                        workspace_id,
                        ObservationStatus::Revoked,
                        &now,
                        items,
                    ));
                }
                Err(err) if err.code == ErrorCode::GrantIdentityMismatch => return Err(err),
                Err(err) if err.code == ErrorCode::NotFound => {
                    if let Some(prev) = prev_source {
                        pending.push(PendingDiskResult::Missing {
                            path,
                            prev_source: prev,
                        });
                    }
                }
                Err(err) => {
                    if let Some(prev) = prev_source {
                        pending.push(PendingDiskResult::Unreadable {
                            path,
                            prev_source: prev,
                            reason: err.code_str().to_string(),
                        });
                    } else {
                        skipped.push(format!("{path}:{}", err.code_str()));
                    }
                }
            }
        }

        let git_head_read = if cancel.is_cancelled() {
            None
        } else {
            let ws_identity = DirIdentity {
                dev: ws.dev.clone(),
                ino: ws.ino.clone(),
            };
            match reader::read_git_head_within_workspace(
                Path::new(&root.path),
                &messages::root_identity(&root),
                &ws.relative_path,
                &ws_identity,
                MAX_GIT_HEAD_BYTES,
                &gate,
            ) {
                Ok(Some(read)) => {
                    let text = String::from_utf8_lossy(&read.bytes).trim().to_string();
                    let sha = hex::encode(Sha256::digest(&read.bytes));
                    Some((text, sha))
                }
                Ok(None) => None,
                Err(err) if err.code == ErrorCode::RootPaused => {
                    let items = self.list_attention_items(workspace_id)?;
                    return Ok(inactive_observation_report(
                        workspace_id,
                        ObservationStatus::Paused,
                        &now,
                        items,
                    ));
                }
                Err(err) if err.code == ErrorCode::RootRevoked => {
                    let items = self.list_attention_items(workspace_id)?;
                    return Ok(inactive_observation_report(
                        workspace_id,
                        ObservationStatus::Revoked,
                        &now,
                        items,
                    ));
                }
                Err(err) if err.code == ErrorCode::GrantIdentityMismatch => return Err(err),
                Err(err) => {
                    skipped.push(format!(".git/HEAD:{}", err.code_str()));
                    None
                }
            }
        };

        self.with_immediate_tx(|tx| {
            let root_now = grant::load_root(tx, &root.id)?
                .ok_or_else(|| CoreError::new(ErrorCode::NotFound, root.id.as_str()))?;
            if let Some(status) = inactive_observation_status(root_now.status) {
                let facts = load_workspace_facts(tx, workspace_id)?;
                let items = derive_attention_items(&facts);
                return Ok(inactive_observation_report(
                    workspace_id,
                    status,
                    &now,
                    items,
                ));
            }

            let mut observer = load_observer_state(tx, workspace_id)?;
            let mut changed_files = Vec::new();
            let mut changed_paths = BTreeMap::<String, String>::new();

            for item in pending {
                match item {
                    PendingDiskResult::Read {
                        path,
                        prev_source: Some(prev),
                        bytes,
                        sha,
                    } => {
                        observer.missing_paths.remove(&path);
                        observer.unreadable_paths.remove(&path);
                        if sha != prev.content_sha256 {
                            let new_src = messages::insert_source(tx, &ws, &path, &bytes)?;
                            mark_prior_path_sources_stale(
                                tx,
                                workspace_id,
                                &path,
                                new_src.id.as_str(),
                                &mut observer,
                                "文件已变更，此摘录已过时",
                            )?;
                            observer.stale_source_ids.remove(new_src.id.as_str());
                            observer
                                .latest_source_by_path
                                .insert(path.clone(), new_src.id.as_str().to_string());
                            changed_paths.insert(path.clone(), format!("文件 {path} 内容已更新"));
                            changed_files.push(ObservedFileChange {
                                relative_path: path,
                                previous_source_id: Some(prev.id),
                                new_source_id: Some(new_src.id),
                                previous_sha256: Some(prev.content_sha256),
                                new_sha256: Some(sha),
                                freshness: SourceFreshness::Changed,
                                detail: "source content sha256 changed".to_string(),
                            });
                        } else {
                            observer.stale_source_ids.remove(prev.id.as_str());
                            observer
                                .latest_source_by_path
                                .insert(path, prev.id.as_str().to_string());
                        }
                    }
                    PendingDiskResult::Read {
                        path,
                        prev_source: None,
                        bytes,
                        sha,
                    } => {
                        observer.missing_paths.remove(&path);
                        observer.unreadable_paths.remove(&path);
                        let new_src = messages::insert_source(tx, &ws, &path, &bytes)?;
                        observer.stale_source_ids.remove(new_src.id.as_str());
                        observer
                            .latest_source_by_path
                            .insert(path.clone(), new_src.id.as_str().to_string());
                        changed_files.push(ObservedFileChange {
                            relative_path: path,
                            previous_source_id: None,
                            new_source_id: Some(new_src.id),
                            previous_sha256: None,
                            new_sha256: Some(sha),
                            freshness: SourceFreshness::Fresh,
                            detail: "new key file observed".to_string(),
                        });
                    }
                    PendingDiskResult::Missing { path, prev_source } => {
                        let already_missing = observer.missing_paths.contains_key(&path)
                            && observer.stale_source_ids.contains(prev_source.id.as_str());
                        observer
                            .stale_source_ids
                            .insert(prev_source.id.as_str().to_string());
                        observer
                            .missing_paths
                            .entry(path.clone())
                            .or_insert_with(|| now.clone());
                        observer.unreadable_paths.remove(&path);
                        if !already_missing {
                            search::mark_source_stale_if_indexed(
                                tx,
                                prev_source.id.as_str(),
                                "文件已缺失，此摘录已过时",
                            )?;
                            changed_paths.insert(path.clone(), format!("文件 {path} 已缺失"));
                            changed_files.push(ObservedFileChange {
                                relative_path: path,
                                previous_source_id: Some(prev_source.id),
                                new_source_id: None,
                                previous_sha256: Some(prev_source.content_sha256),
                                new_sha256: None,
                                freshness: SourceFreshness::Missing,
                                detail: "tracked source file missing on disk".to_string(),
                            });
                        }
                    }
                    PendingDiskResult::Unreadable {
                        path,
                        prev_source,
                        reason,
                    } => {
                        let already_unreadable = observer.unreadable_paths.contains_key(&path)
                            && observer.stale_source_ids.contains(prev_source.id.as_str());
                        observer
                            .stale_source_ids
                            .insert(prev_source.id.as_str().to_string());
                        observer
                            .unreadable_paths
                            .entry(path.clone())
                            .or_insert_with(|| now.clone());
                        observer.missing_paths.remove(&path);
                        if !already_unreadable {
                            search::mark_source_stale_if_indexed(
                                tx,
                                prev_source.id.as_str(),
                                "文件不可读，此摘录已过时",
                            )?;
                            changed_paths
                                .insert(path.clone(), format!("文件 {path} 不可读（{reason}）"));
                            changed_files.push(ObservedFileChange {
                                relative_path: path,
                                previous_source_id: Some(prev_source.id),
                                new_source_id: None,
                                previous_sha256: Some(prev_source.content_sha256),
                                new_sha256: None,
                                freshness: SourceFreshness::Unreadable,
                                detail: format!("tracked source unreadable: {reason}"),
                            });
                        }
                    }
                }
            }

            let mut git_head_changed = false;
            let mut current_git_head = observer.git_head.clone();
            if let Some((head_text, head_sha)) = git_head_read {
                if observer
                    .git_head_sha256
                    .as_deref()
                    .is_some_and(|prev| prev != head_sha)
                {
                    git_head_changed = true;
                    observer.git_head_changed_at = Some(now.clone());
                    let git_attn_id = attention_id(workspace_id, "git_head", "head");
                    observer.dismissed_attention_ids.remove(&git_attn_id);
                    observer
                        .attention_timestamps
                        .insert(git_attn_id, now.clone());
                }
                observer.git_head = Some(head_text.clone());
                observer.git_head_sha256 = Some(head_sha);
                current_git_head = Some(head_text);
            }

            let all_sources = messages::load_sources(tx, workspace_id, true)?;
            let source_by_id: BTreeMap<String, SourceRef> = all_sources
                .iter()
                .map(|s| (s.id.as_str().to_string(), s.clone()))
                .collect();
            let latest_map = latest_sources_map(&all_sources, &observer);

            let opinions = opinion::load_workspace_opinions(tx, workspace_id)?;
            let mut stale_opinion_ids = Vec::new();
            for op in &opinions {
                if !matches!(
                    op.status.as_str(),
                    "active" | "disputed" | "pending_revision"
                ) {
                    continue;
                }
                let affected_paths: Vec<String> = op
                    .evidence_refs
                    .iter()
                    .filter_map(|ev| source_by_id.get(ev))
                    .filter(|src| is_source_stale(src, &observer, &latest_map))
                    .map(|src| src.relative_path.clone())
                    .collect();
                if affected_paths.is_empty() {
                    continue;
                }
                let note = format!(
                    "观察到依据文件变化（{}），原观点已标记为过时，历史修订保留。",
                    affected_paths.join(", ")
                );
                let op_key = format!("obs_stale_{}_r{}", op.id, op.revision);
                if opinion::mark_opinion_stale_tx(tx, workspace_id, &op.id, &op_key, &note)? {
                    stale_opinion_ids.push(op.id.clone());
                    let attn_id = attention_id(workspace_id, "opinion", &op.id);
                    observer.dismissed_attention_ids.remove(&attn_id);
                    observer
                        .attention_timestamps
                        .entry(attn_id)
                        .or_insert_with(|| now.clone());
                }
            }

            observer.last_observed_at = Some(now.clone());
            save_observer_state(tx, workspace_id, &observer)?;

            let facts = load_workspace_facts(tx, workspace_id)?;
            let attention_items = derive_attention_items(&facts);
            for item in &attention_items {
                observer
                    .attention_timestamps
                    .entry(item.id.clone())
                    .or_insert_with(|| item.created_at.clone());
            }
            save_observer_state(tx, workspace_id, &observer)?;

            let detail =
                if changed_files.is_empty() && stale_opinion_ids.is_empty() && !git_head_changed {
                    "incremental check completed; no source changes detected".to_string()
                } else {
                    format!(
                    "observed {} file change(s), {} opinion(s) marked stale, git_head_changed={}",
                    changed_files.len(),
                    stale_opinion_ids.len(),
                    git_head_changed
                )
                };

            Ok(WorkspaceObservationReport {
                workspace_id: workspace_id.clone(),
                status: ObservationStatus::Observed,
                observed_at: now.clone(),
                checked_paths,
                changed_files,
                stale_opinion_ids,
                attention_items,
                git_head_changed,
                git_head: current_git_head,
                skipped,
                detail,
            })
        })
    }

    /// Derive deduplicated [`AttentionItem`] candidates from current Core state
    /// (stale opinions, changed/missing/unreadable tracked sources, git HEAD changes).
    pub fn list_attention_items(&self, workspace_id: &WorkspaceId) -> Result<Vec<AttentionItem>> {
        let facts = self.with_conn(|conn| load_workspace_facts(conn, workspace_id))?;
        Ok(derive_attention_items(&facts))
    }

    /// Dismiss an [`AttentionItem`] without mutating source facts or opinion history.
    pub fn dismiss_attention_item(
        &self,
        workspace_id: &WorkspaceId,
        attention_id: &str,
    ) -> Result<bool> {
        let trimmed = attention_id.trim();
        if trimmed.is_empty() {
            return Err(CoreError::new(
                ErrorCode::InvalidMessage,
                "attention id is empty",
            ));
        }
        self.with_immediate_tx(|tx| {
            memory::require_workspace(tx, workspace_id)?;
            let mut observer = load_observer_state(tx, workspace_id)?;
            let inserted = observer.dismissed_attention_ids.insert(trimmed.to_string());
            if inserted {
                save_observer_state(tx, workspace_id, &observer)?;
            }
            Ok(inserted)
        })
    }
}

fn load_workspace_facts(conn: &Connection, workspace_id: &WorkspaceId) -> Result<WorkspaceFacts> {
    let ws = workspace::load_workspace(conn, workspace_id)?
        .ok_or_else(|| CoreError::new(ErrorCode::WorkspaceNotFound, workspace_id.as_str()))?;
    let root = messages::root_for_workspace(conn, workspace_id)?;
    let available = root.status == RootStatus::Active;
    let checkpoint = match messages::load_checkpoint(conn, workspace_id) {
        Ok(cp) => Some(cp),
        Err(err) if err.code == ErrorCode::OnboardingNotFound => None,
        Err(err) => return Err(err),
    };
    let sources = messages::load_sources(conn, workspace_id, available)?;
    let memories = memory::load_workspace_memories(conn, workspace_id)?;
    let opinions = opinion::load_workspace_opinions(conn, workspace_id)?;
    let observer = load_observer_state(conn, workspace_id)?;
    Ok(WorkspaceFacts {
        ws,
        root_status: root.status,
        checkpoint,
        sources,
        memories,
        opinions,
        observer,
    })
}

fn load_observer_state(conn: &Connection, workspace_id: &WorkspaceId) -> Result<ObserverState> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT evidence_json FROM onboarding_runs WHERE workspace_id = ?1 AND generation = ?2",
            params![workspace_id.as_str(), ONBOARDING_GENERATION],
            |row| row.get(0),
        )
        .optional()?;
    let Some(raw) = raw else {
        return Ok(ObserverState::default());
    };
    let evidence: serde_json::Value =
        serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
    let Some(slot) = evidence.get("observerState") else {
        return Ok(ObserverState::default());
    };
    if slot.is_null() {
        return Ok(ObserverState::default());
    }
    Ok(serde_json::from_value(slot.clone()).unwrap_or_default())
}

fn save_observer_state(
    tx: &Transaction<'_>,
    workspace_id: &WorkspaceId,
    state: &ObserverState,
) -> Result<()> {
    let raw: Option<String> = tx
        .query_row(
            "SELECT evidence_json FROM onboarding_runs WHERE workspace_id = ?1 AND generation = ?2",
            params![workspace_id.as_str(), ONBOARDING_GENERATION],
            |row| row.get(0),
        )
        .optional()?;
    let Some(raw) = raw else {
        return Ok(());
    };
    let mut evidence: serde_json::Value =
        serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
    if !evidence.is_object() {
        evidence = serde_json::json!({});
    }
    evidence["observerState"] = serde_json::to_value(state)?;
    tx.execute(
        "UPDATE onboarding_runs SET evidence_json = ?1 WHERE workspace_id = ?2 AND generation = ?3",
        params![
            evidence.to_string(),
            workspace_id.as_str(),
            ONBOARDING_GENERATION
        ],
    )?;
    Ok(())
}

fn mark_prior_path_sources_stale(
    tx: &Transaction<'_>,
    workspace_id: &WorkspaceId,
    relative_path: &str,
    current_source_id: &str,
    observer: &mut ObserverState,
    label: &str,
) -> Result<()> {
    let mut stmt = tx.prepare(
        "SELECT id FROM source_refs WHERE workspace_id = ?1 AND relative_path = ?2 AND id != ?3",
    )?;
    let old_ids: Vec<String> = stmt
        .query_map(
            params![workspace_id.as_str(), relative_path, current_source_id],
            |row| row.get(0),
        )?
        .collect::<std::result::Result<_, _>>()?;
    drop(stmt);
    for old_id in old_ids {
        observer.stale_source_ids.insert(old_id.clone());
        search::mark_source_stale_if_indexed(tx, &old_id, label)?;
    }
    Ok(())
}

fn latest_sources_map(
    sources: &[SourceRef],
    observer: &ObserverState,
) -> BTreeMap<String, SourceRef> {
    let by_id: BTreeMap<&str, &SourceRef> = sources.iter().map(|s| (s.id.as_str(), s)).collect();
    let mut latest = BTreeMap::<String, SourceRef>::new();
    // `sources` is ordered by `observed_at ASC, id ASC`, so later items win by default.
    for src in sources {
        latest.insert(src.relative_path.clone(), src.clone());
    }
    // Explicit observer pointer wins over `observed_at` when content reverted to an older sha256.
    for (path, src_id) in &observer.latest_source_by_path {
        if let Some(src) = by_id.get(src_id.as_str()) {
            latest.insert(path.clone(), (*src).clone());
        }
    }
    latest
}

fn is_source_stale(
    src: &SourceRef,
    observer: &ObserverState,
    latest_by_path: &BTreeMap<String, SourceRef>,
) -> bool {
    if observer.stale_source_ids.contains(src.id.as_str())
        || observer.missing_paths.contains_key(&src.relative_path)
        || observer.unreadable_paths.contains_key(&src.relative_path)
    {
        return true;
    }
    latest_by_path
        .get(&src.relative_path)
        .is_some_and(|latest| latest.id != src.id)
}

fn project_context_pack(facts: &WorkspaceFacts) -> ContextPack {
    let latest_sources = latest_sources_map(&facts.sources, &facts.observer);
    let active_memories: Vec<&MemoryNote> = facts
        .memories
        .iter()
        .filter(|m| m.status != "retracted" && m.status != "superseded")
        .collect();
    let non_retracted_opinions: Vec<&OpinionView> = facts
        .opinions
        .iter()
        .filter(|o| o.status != "retracted")
        .collect();

    let empty =
        active_memories.is_empty() && non_retracted_opinions.is_empty() && facts.sources.is_empty();

    let stale_source_count = latest_sources
        .values()
        .filter(|s| is_source_stale(s, &facts.observer, &latest_sources))
        .count();

    let source_version = compute_source_version(facts, &latest_sources);
    let context_pack_revision = compute_context_pack_revision(facts, &source_version);

    let active_opinions: Vec<&OpinionView> = non_retracted_opinions
        .iter()
        .copied()
        .filter(|o| o.status == "active")
        .collect();
    let attention_opinions: Vec<&OpinionView> = non_retracted_opinions
        .iter()
        .copied()
        .filter(|o| matches!(o.status.as_str(), "disputed" | "pending_revision" | "stale"))
        .collect();
    let shelved_count = non_retracted_opinions
        .iter()
        .filter(|o| o.status == "shelved")
        .count();

    let identity = if empty {
        None
    } else {
        build_identity_text(&active_memories)
    };
    let overview = if empty {
        None
    } else {
        Some(build_overview_text(
            facts,
            &latest_sources,
            &active_opinions,
            &attention_opinions,
            shelved_count,
        ))
    };

    ContextPack {
        workspace_id: facts.ws.id.clone(),
        context_pack_revision,
        source_version,
        empty,
        identity,
        overview,
        root_status: root_status_str(facts.root_status).to_string(),
        memory_count: active_memories.len(),
        active_opinion_count: active_opinions.len(),
        attention_opinion_count: attention_opinions.len(),
        source_count: latest_sources.len(),
        stale_source_count,
    }
}

fn build_identity_text(memories: &[&MemoryNote]) -> Option<String> {
    let identities: Vec<&MemoryNote> = memories
        .iter()
        .copied()
        .filter(|m| m.kind == "identity")
        .take(MAX_PACK_IDENTITIES)
        .collect();
    let decisions: Vec<&MemoryNote> = memories
        .iter()
        .copied()
        .filter(|m| m.kind == "decision")
        .take(MAX_PACK_DECISIONS)
        .collect();
    let experiences: Vec<&MemoryNote> = memories
        .iter()
        .copied()
        .filter(|m| m.kind == "experience")
        .take(MAX_PACK_EXPERIENCES)
        .collect();

    if identities.is_empty() && decisions.is_empty() && experiences.is_empty() {
        return None;
    }

    let mut sections = Vec::new();
    append_memory_section(&mut sections, "identity", &identities);
    append_memory_section(&mut sections, "decision", &decisions);
    append_memory_section(&mut sections, "experience", &experiences);

    Some(truncate_chars(
        &sections.join("\n"),
        MAX_CONTEXT_IDENTITY_CHARS,
    ))
}

fn append_memory_section(out: &mut Vec<String>, label: &str, notes: &[&MemoryNote]) {
    if notes.is_empty() {
        return;
    }
    out.push(format!("[{label}]"));
    for note in notes {
        let text = sanitize_single_line(&note.text, MAX_PACK_ITEM_TEXT_CHARS);
        let refs = if note.source_refs.is_empty() {
            String::new()
        } else {
            format!(" refs:{}", note.source_refs.join(","))
        };
        out.push(format!(
            "- [{} r{} {}] {}{}",
            note.id, note.revision, note.status, text, refs
        ));
    }
}

fn build_overview_text(
    facts: &WorkspaceFacts,
    latest_sources: &BTreeMap<String, SourceRef>,
    active_opinions: &[&OpinionView],
    attention_opinions: &[&OpinionView],
    shelved_count: usize,
) -> String {
    let mut lines = Vec::new();
    lines.push(format!(
        "workspace: {} ({}) rootStatus:{}",
        facts.ws.display_name,
        facts.ws.id.as_str(),
        root_status_str(facts.root_status)
    ));
    if facts.root_status != RootStatus::Active {
        lines.push(format!(
            "directory_unavailable: local files are not accessible while directory is {}",
            root_status_str(facts.root_status)
        ));
    }

    if !latest_sources.is_empty() {
        lines.push("[local_fact]".to_string());
        for src in latest_sources.values().take(MAX_PACK_SOURCES) {
            let short_sha: String = src.content_sha256.chars().take(8).collect();
            if facts.root_status != RootStatus::Active {
                lines.push(format!(
                    "- [{} {}] unavailable ({})",
                    src.id.as_str(),
                    src.relative_path,
                    root_status_str(facts.root_status)
                ));
                continue;
            }
            let freshness = source_freshness_label(src, &facts.observer, latest_sources);
            let excerpt = src
                .excerpt
                .as_deref()
                .map(|t| sanitize_single_line(t, MAX_PACK_EXCERPT_CHARS))
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| {
                    if src.binary {
                        "<binary>".to_string()
                    } else {
                        "<empty>".to_string()
                    }
                });
            lines.push(format!(
                "- [{} {} sha:{} {}] {}",
                src.id.as_str(),
                src.relative_path,
                short_sha,
                freshness,
                excerpt
            ));
        }
    }

    if !active_opinions.is_empty() {
        lines.push("[opinions:active]".to_string());
        for op in active_opinions.iter().take(MAX_PACK_OPINIONS_PER_BUCKET) {
            let summary = sanitize_single_line(&op.summary, MAX_PACK_ITEM_TEXT_CHARS);
            lines.push(format!(
                "- [{} r{} active] {} (evidence:{})",
                op.id,
                op.revision,
                summary,
                op.evidence_refs.join(",")
            ));
        }
    }

    if !attention_opinions.is_empty() {
        lines.push("[opinions:attention]".to_string());
        for op in attention_opinions.iter().take(MAX_PACK_OPINIONS_PER_BUCKET) {
            let summary = sanitize_single_line(&op.summary, MAX_PACK_ITEM_TEXT_CHARS);
            lines.push(format!(
                "- [{} r{} {}] {} (evidence:{})",
                op.id,
                op.revision,
                op.status,
                summary,
                op.evidence_refs.join(",")
            ));
        }
    }

    if shelved_count > 0 {
        lines.push(format!("[opinions:shelved] count={shelved_count}"));
    }

    if let Some(git_head) = facts.observer.git_head.as_deref() {
        if facts.root_status == RootStatus::Active {
            lines.push(format!("git_head: {}", sanitize_single_line(git_head, 120)));
        }
    }

    truncate_chars(&lines.join("\n"), MAX_CONTEXT_OVERVIEW_CHARS)
}

fn source_freshness_label(
    src: &SourceRef,
    observer: &ObserverState,
    latest_by_path: &BTreeMap<String, SourceRef>,
) -> &'static str {
    if observer.missing_paths.contains_key(&src.relative_path) {
        "missing"
    } else if observer.unreadable_paths.contains_key(&src.relative_path) {
        "unreadable"
    } else if is_source_stale(src, observer, latest_by_path) {
        "stale"
    } else {
        "fresh"
    }
}

fn compute_source_version(
    facts: &WorkspaceFacts,
    latest_sources: &BTreeMap<String, SourceRef>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(root_status_str(facts.root_status).as_bytes());
    hasher.update(b"|");
    for src in latest_sources.values() {
        hasher.update(src.id.as_str().as_bytes());
        hasher.update(b":");
        hasher.update(src.relative_path.as_bytes());
        hasher.update(b":");
        hasher.update(src.content_sha256.as_bytes());
        hasher.update(b":");
        hasher.update(source_freshness_label(src, &facts.observer, latest_sources).as_bytes());
        hasher.update(b";");
    }
    if let Some(sha) = facts.observer.git_head_sha256.as_deref() {
        hasher.update(b"git:");
        hasher.update(sha.as_bytes());
    }
    let hex = hex::encode(hasher.finalize());
    format!("srcv_{}", &hex[..24])
}

fn compute_context_pack_revision(facts: &WorkspaceFacts, source_version: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(facts.ws.id.as_str().as_bytes());
    hasher.update(b"|");
    hasher.update(source_version.as_bytes());
    hasher.update(b"|");
    for m in &facts.memories {
        hasher.update(m.id.as_bytes());
        hasher.update(b":");
        hasher.update(m.revision.to_string().as_bytes());
        hasher.update(b":");
        hasher.update(m.status.as_bytes());
        hasher.update(b";");
    }
    hasher.update(b"|");
    for o in &facts.opinions {
        hasher.update(o.id.as_bytes());
        hasher.update(b":");
        hasher.update(o.revision.to_string().as_bytes());
        hasher.update(b":");
        hasher.update(o.status.as_bytes());
        hasher.update(b";");
    }
    let hex = hex::encode(hasher.finalize());
    format!("pack_{}", &hex[..24])
}

fn project_narrative_state(facts: &WorkspaceFacts) -> NarrativeState {
    let latest_sources = latest_sources_map(&facts.sources, &facts.observer);
    let non_retracted_opinions: Vec<&OpinionView> = facts
        .opinions
        .iter()
        .filter(|o| o.status != "retracted")
        .collect();
    let observed_at = latest_observed_timestamp(facts);

    match facts.root_status {
        RootStatus::Revoked => {
            return NarrativeState {
                availability: NarrativeAvailability::Unknown,
                flame: FlameStage::Neutral,
                stage_label: "目录授权已撤销".to_string(),
                narrative_reason:
                    "工作空间目录授权已撤销，无法验证当前项目文件状态，不将未知当作停滞。"
                        .to_string(),
                basis_refs: Vec::new(),
                observed_at,
                stale: !facts.sources.is_empty() || !non_retracted_opinions.is_empty(),
            };
        }
        RootStatus::Paused => {
            return NarrativeState {
                availability: NarrativeAvailability::Unknown,
                flame: FlameStage::Neutral,
                stage_label: "观察已暂停".to_string(),
                narrative_reason: "目录观察已暂停，当前无法验证文件新鲜度，不将暂停视为项目停滞。"
                    .to_string(),
                basis_refs: Vec::new(),
                observed_at,
                stale: !facts.sources.is_empty() || !non_retracted_opinions.is_empty(),
            };
        }
        RootStatus::Active => {}
    }

    let active_decisions: Vec<&MemoryNote> = facts
        .memories
        .iter()
        .filter(|m| m.kind == "decision" && m.status == "active")
        .collect();
    let active_identities: Vec<&MemoryNote> = facts
        .memories
        .iter()
        .filter(|m| m.kind == "identity" && m.status == "active")
        .collect();
    let active_experiences: Vec<&MemoryNote> = facts
        .memories
        .iter()
        .filter(|m| m.kind == "experience" && m.status == "active")
        .collect();

    let active_opinions: Vec<&OpinionView> = non_retracted_opinions
        .iter()
        .copied()
        .filter(|o| o.status == "active")
        .collect();
    let stale_opinions: Vec<&OpinionView> = non_retracted_opinions
        .iter()
        .copied()
        .filter(|o| o.status == "stale")
        .collect();
    let attention_opinions: Vec<&OpinionView> = non_retracted_opinions
        .iter()
        .copied()
        .filter(|o| matches!(o.status.as_str(), "disputed" | "pending_revision"))
        .collect();

    let any_stale = !stale_opinions.is_empty()
        || !facts.observer.missing_paths.is_empty()
        || !facts.observer.unreadable_paths.is_empty()
        || latest_sources
            .values()
            .any(|src| is_source_stale(src, &facts.observer, &latest_sources));

    let cp = facts.checkpoint.as_ref();
    let selective_read_done = cp.is_some_and(|c| c.selective_read_done);
    let model_analyzed = cp.is_some_and(|c| c.model_analyzed);
    let opening_presented = cp.is_some_and(|c| c.opening_presented);

    let has_any_facts = !facts.sources.is_empty()
        || !active_decisions.is_empty()
        || !active_identities.is_empty()
        || !active_experiences.is_empty()
        || !non_retracted_opinions.is_empty()
        || selective_read_done
        || model_analyzed
        || opening_presented;

    if !has_any_facts {
        return NarrativeState {
            availability: NarrativeAvailability::Unknown,
            flame: FlameStage::Neutral,
            stage_label: "尚无已核验观察".to_string(),
            narrative_reason: "尚未读取关键文件或沉淀项目决定，保持中性，不凭空推断项目状态。"
                .to_string(),
            basis_refs: Vec::new(),
            observed_at: None,
            stale: false,
        };
    }

    let basis_refs = collect_basis_refs(
        &active_decisions,
        &active_identities,
        &active_opinions,
        &stale_opinions,
        &attention_opinions,
        &latest_sources,
    );

    if !any_stale
        && attention_opinions.is_empty()
        && !active_decisions.is_empty()
        && !active_opinions.is_empty()
        && !latest_sources.is_empty()
        && (active_decisions.len() >= 2
            || !active_identities.is_empty()
            || !active_experiences.is_empty()
            || opening_presented)
    {
        return NarrativeState {
            availability: NarrativeAvailability::Known,
            flame: FlameStage::Milestone,
            stage_label: "金色暖光 · 已验证里程碑".to_string(),
            narrative_reason: format!(
                "已核验 {} 条当前决定、{} 条有效观点与 {} 份新鲜来源文件，关键脉络达成可追溯一致。",
                active_decisions.len(),
                active_opinions.len(),
                latest_sources.len()
            ),
            basis_refs,
            observed_at,
            stale: false,
        };
    }

    if !any_stale && !active_decisions.is_empty() {
        return NarrativeState {
            availability: NarrativeAvailability::Known,
            flame: FlameStage::Bright,
            stage_label: "舒展火光 · 关键脉络推进".to_string(),
            narrative_reason: format!(
                "已记录 {} 条明确用户决定与 {} 份当前来源，项目脉络与证据保持一致。",
                active_decisions.len(),
                latest_sources.len()
            ),
            basis_refs,
            observed_at,
            stale: false,
        };
    }

    if !active_opinions.is_empty()
        || !attention_opinions.is_empty()
        || !stale_opinions.is_empty()
        || model_analyzed
        || opening_presented
        || (any_stale && !active_decisions.is_empty())
    {
        let (stage_label, narrative_reason) = if any_stale {
            (
                "稳定小火 · 证据待复核".to_string(),
                "已有项目分析或决定，但部分依据文件发生变更或缺失，需复核更新后再确认推进。"
                    .to_string(),
            )
        } else {
            (
                "稳定小火 · 持续理解中".to_string(),
                format!(
                    "已形成 {} 条结构化观点，正围绕 {} 份已读来源持续理解项目。",
                    active_opinions.len() + attention_opinions.len(),
                    latest_sources.len()
                ),
            )
        };
        return NarrativeState {
            availability: NarrativeAvailability::Known,
            flame: FlameStage::Gentle,
            stage_label,
            narrative_reason,
            basis_refs,
            observed_at,
            stale: any_stale,
        };
    }

    let (stage_label, narrative_reason) = if any_stale {
        (
            "低伏微光 · 依据已变化".to_string(),
            "已建立项目边界并读取过来源文件，但部分文件自上次观察后已变化或不可读。".to_string(),
        )
    } else {
        (
            "低伏微光 · 已有基础认识".to_string(),
            format!(
                "已建立项目边界并读取 {} 份来源文件，尚无已提交观点或用户决定。",
                latest_sources.len()
            ),
        )
    };
    NarrativeState {
        availability: NarrativeAvailability::Known,
        flame: FlameStage::Ember,
        stage_label,
        narrative_reason,
        basis_refs,
        observed_at,
        stale: any_stale,
    }
}

fn collect_basis_refs(
    decisions: &[&MemoryNote],
    identities: &[&MemoryNote],
    active_opinions: &[&OpinionView],
    stale_opinions: &[&OpinionView],
    attention_opinions: &[&OpinionView],
    latest_sources: &BTreeMap<String, SourceRef>,
) -> Vec<String> {
    let mut refs = Vec::new();
    let mut seen = BTreeSet::new();
    let mut push = |id: &str| {
        if refs.len() < 16 && seen.insert(id.to_string()) {
            refs.push(id.to_string());
        }
    };
    for m in decisions.iter().chain(identities.iter()) {
        push(&m.id);
    }
    for op in active_opinions
        .iter()
        .chain(stale_opinions.iter())
        .chain(attention_opinions.iter())
    {
        push(&op.id);
    }
    for src in latest_sources.values() {
        push(src.id.as_str());
    }
    refs
}

fn latest_observed_timestamp(facts: &WorkspaceFacts) -> Option<String> {
    facts
        .sources
        .iter()
        .map(|s| s.observed_at.as_str())
        .chain(facts.memories.iter().map(|m| m.observed_at.as_str()))
        .chain(facts.opinions.iter().map(|o| o.last_updated_at.as_str()))
        .chain(facts.observer.last_observed_at.as_deref())
        .max()
        .map(str::to_string)
}

fn derive_attention_items(facts: &WorkspaceFacts) -> Vec<AttentionItem> {
    let latest_sources = latest_sources_map(&facts.sources, &facts.observer);
    let source_by_id: BTreeMap<&str, &SourceRef> =
        facts.sources.iter().map(|s| (s.id.as_str(), s)).collect();
    let mut items = Vec::new();
    let mut covered_paths = BTreeSet::new();

    // 1. Stale opinions take precedence and cover their affected source paths (dedup).
    for op in &facts.opinions {
        if op.status != "stale" {
            continue;
        }
        let mut target_evidence_id = None;
        let mut affected_paths = Vec::new();
        for ev in &op.evidence_refs {
            if let Some(src) = source_by_id.get(ev.as_str()) {
                covered_paths.insert(src.relative_path.clone());
                affected_paths.push(src.relative_path.clone());
                if target_evidence_id.is_none() {
                    target_evidence_id = latest_sources
                        .get(&src.relative_path)
                        .map(|latest| latest.id.as_str().to_string())
                        .or_else(|| Some(src.id.as_str().to_string()));
                }
            }
        }
        let id = attention_id(&facts.ws.id, "opinion", &op.id);
        let created_at = facts
            .observer
            .attention_timestamps
            .get(&id)
            .cloned()
            .unwrap_or_else(|| op.last_updated_at.clone());
        let why_now = if affected_paths.is_empty() {
            "所依据的本地来源自上次分析后发生变化，原观点已标记为待复核。".to_string()
        } else {
            format!(
                "依据文件 {} 已变更或不可读，原观点可能不再适用。",
                affected_paths.join(", ")
            )
        };
        items.push(AttentionItem {
            id: id.clone(),
            workspace_id: facts.ws.id.clone(),
            workspace_name: facts.ws.display_name.clone(),
            conversation_id: facts.ws.conversation_id.clone(),
            headline: format!("观点依据已变化，待复核：{}", op.title),
            why_now,
            target_opinion_id: Some(op.id.clone()),
            target_evidence_id,
            created_at,
            dismissed: facts.observer.dismissed_attention_ids.contains(&id),
        });
    }

    // 2. Changed/missing/unreadable tracked sources not already represented by a stale opinion.
    if facts.root_status == RootStatus::Active {
        for (path, latest) in &latest_sources {
            if covered_paths.contains(path) {
                continue;
            }
            let missing_at = facts.observer.missing_paths.get(path);
            let unreadable_at = facts.observer.unreadable_paths.get(path);
            let has_older_stale = facts.sources.iter().any(|s| {
                &s.relative_path == path && facts.observer.stale_source_ids.contains(s.id.as_str())
            });
            if missing_at.is_none() && unreadable_at.is_none() && !has_older_stale {
                continue;
            }
            let id = attention_id(&facts.ws.id, "source", path);
            let (headline, why_now, fallback_ts) = if let Some(ts) = missing_at {
                (
                    format!("已追踪文件已缺失：{path}"),
                    format!("本地文件 {path} 在最新检查中已不存在，相关记忆摘录已标为过时。"),
                    ts.clone(),
                )
            } else if let Some(ts) = unreadable_at {
                (
                    format!("已追踪文件不可读：{path}"),
                    format!("本地文件 {path} 当前无法安全读取，相关记忆摘录已标为过时。"),
                    ts.clone(),
                )
            } else {
                (
                    format!("已追踪文件已更新：{path}"),
                    format!("本地文件 {path} 内容指纹已变化，已保存新版本快照，旧摘录已标为历史。"),
                    latest.observed_at.clone(),
                )
            };
            let created_at = facts
                .observer
                .attention_timestamps
                .get(&id)
                .cloned()
                .unwrap_or(fallback_ts);
            items.push(AttentionItem {
                id: id.clone(),
                workspace_id: facts.ws.id.clone(),
                workspace_name: facts.ws.display_name.clone(),
                conversation_id: facts.ws.conversation_id.clone(),
                headline,
                why_now,
                target_opinion_id: None,
                target_evidence_id: Some(latest.id.as_str().to_string()),
                created_at,
                dismissed: facts.observer.dismissed_attention_ids.contains(&id),
            });
        }
    }

    // 3. Git HEAD change if observed.
    if let (Some(head), Some(changed_at)) = (
        facts.observer.git_head.as_deref(),
        facts.observer.git_head_changed_at.as_deref(),
    ) {
        if facts.root_status == RootStatus::Active {
            let id = attention_id(&facts.ws.id, "git_head", "head");
            let created_at = facts
                .observer
                .attention_timestamps
                .get(&id)
                .cloned()
                .unwrap_or_else(|| changed_at.to_string());
            items.push(AttentionItem {
                id: id.clone(),
                workspace_id: facts.ws.id.clone(),
                workspace_name: facts.ws.display_name.clone(),
                conversation_id: facts.ws.conversation_id.clone(),
                headline: "Git HEAD 状态已变化".to_string(),
                why_now: format!(
                    "检测到仓库 .git/HEAD 已变更为 `{}`，可按需核验相关结构与观点。",
                    sanitize_single_line(head, 80)
                ),
                target_opinion_id: None,
                target_evidence_id: None,
                created_at,
                dismissed: facts.observer.dismissed_attention_ids.contains(&id),
            });
        }
    }

    items
}

fn attention_id(workspace_id: &WorkspaceId, kind: &str, key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(workspace_id.as_str().as_bytes());
    hasher.update(b"|");
    hasher.update(kind.as_bytes());
    hasher.update(b"|");
    hasher.update(key.as_bytes());
    let hex = hex::encode(hasher.finalize());
    format!("attn_{}", &hex[..24])
}

fn inactive_observation_status(status: RootStatus) -> Option<ObservationStatus> {
    match status {
        RootStatus::Active => None,
        RootStatus::Paused => Some(ObservationStatus::Paused),
        RootStatus::Revoked => Some(ObservationStatus::Revoked),
    }
}

fn inactive_observation_report(
    workspace_id: &WorkspaceId,
    status: ObservationStatus,
    observed_at: &str,
    attention_items: Vec<AttentionItem>,
) -> WorkspaceObservationReport {
    let detail = match status {
        ObservationStatus::Paused => "directory authorization is paused; sources unchanged",
        ObservationStatus::Revoked => "directory authorization is revoked; sources unchanged",
        ObservationStatus::Unavailable => "directory unavailable; sources unchanged",
        ObservationStatus::Observed => "observed",
    };
    WorkspaceObservationReport {
        workspace_id: workspace_id.clone(),
        status,
        observed_at: observed_at.to_string(),
        checked_paths: 0,
        changed_files: Vec::new(),
        stale_opinion_ids: Vec::new(),
        attention_items,
        git_head_changed: false,
        git_head: None,
        skipped: Vec::new(),
        detail: detail.to_string(),
    }
}

fn root_status_str(status: RootStatus) -> &'static str {
    match status {
        RootStatus::Active => "active",
        RootStatus::Paused => "paused",
        RootStatus::Revoked => "revoked",
    }
}

fn key_file_priority(name: &str) -> u8 {
    if name.eq_ignore_ascii_case("readme.md") {
        0
    } else if name.eq_ignore_ascii_case("readme") {
        1
    } else if name.eq_ignore_ascii_case("readme.txt") {
        2
    } else {
        3
    }
}

fn sanitize_single_line(text: &str, max_chars: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_chars(&collapsed, max_chars)
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let count = text.chars().count();
    if count <= max_chars {
        return text.to_string();
    }
    if max_chars <= 3 {
        return text.chars().take(max_chars).collect();
    }
    let mut out: String = text.chars().take(max_chars - 3).collect();
    out.push_str("...");
    out
}
