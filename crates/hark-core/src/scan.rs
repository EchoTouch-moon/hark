use std::collections::{BTreeMap, VecDeque};

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, ErrorCode, Result};
use crate::grant::{self, AuthorizedRoot};
use crate::ids::{CandidateId, RootId, ScanId};
use crate::limits::{
    ABSOLUTE_MAX_DEPTH, ABSOLUTE_MAX_ENTRIES, ABSOLUTE_MAX_FILE_BYTES, ABSOLUTE_MAX_TOTAL_BYTES,
    DEFAULT_MAX_DEPTH, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_TOTAL_BYTES,
    MAX_IGNORED_RECORDS,
};
use crate::policy::{is_manifest_name, is_monorepo_marker_name};
use crate::reader::{self, ChildInspect};
use crate::CancelFlag;
use crate::Core;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanBudget {
    pub max_entries: u32,
    pub max_depth: u32,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
}

impl Default for ScanBudget {
    fn default() -> Self {
        Self {
            max_entries: DEFAULT_MAX_ENTRIES,
            max_depth: DEFAULT_MAX_DEPTH,
            max_file_bytes: DEFAULT_MAX_FILE_BYTES,
            max_total_bytes: DEFAULT_MAX_TOTAL_BYTES,
        }
    }
}

impl ScanBudget {
    pub fn validate(&self) -> Result<()> {
        if self.max_entries == 0
            || self.max_file_bytes == 0
            || self.max_total_bytes == 0
            || self.max_entries > ABSOLUTE_MAX_ENTRIES
            || self.max_depth > ABSOLUTE_MAX_DEPTH
            || self.max_file_bytes > ABSOLUTE_MAX_FILE_BYTES
            || self.max_total_bytes > ABSOLUTE_MAX_TOTAL_BYTES
        {
            return Err(CoreError::new(
                ErrorCode::BudgetRejected,
                "scan budget is empty or above the absolute cap",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanStatus {
    Completed,
    Limited,
    Cancelled,
    Failed,
}

impl ScanStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Limited => "limited",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "completed" => Ok(Self::Completed),
            "limited" => Ok(Self::Limited),
            "cancelled" => Ok(Self::Cancelled),
            "failed" => Ok(Self::Failed),
            _ => Err(CoreError::new(ErrorCode::Sqlite, "unknown scan status")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateRole {
    SingleRoot,
    IndependentProject,
    ModuleHint,
}

impl CandidateRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::SingleRoot => "single_root",
            Self::IndependentProject => "independent_project",
            Self::ModuleHint => "module_hint",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "single_root" => Ok(Self::SingleRoot),
            "independent_project" => Ok(Self::IndependentProject),
            "module_hint" => Ok(Self::ModuleHint),
            _ => Err(CoreError::new(ErrorCode::Sqlite, "unknown candidate role")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoredEntry {
    pub relative_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCandidate {
    pub id: CandidateId,
    pub relative_path: String,
    pub role: CandidateRole,
    pub evidence: Vec<String>,
    pub suggested: bool,
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialScan {
    pub id: ScanId,
    pub root_id: RootId,
    pub status: ScanStatus,
    pub coverage: String,
    pub limits_hit: Vec<String>,
    pub ignored: Vec<IgnoredEntry>,
    pub candidates: Vec<ScanCandidate>,
    pub default_single_project: bool,
    pub files_seen: u32,
    pub dirs_seen: u32,
    pub created_at: String,
    pub finished_at: String,
}

struct DirFacts {
    evidence: Vec<String>,
}

impl Core {
    pub fn run_initial_scan(
        &self,
        root_id: &RootId,
        budget: &ScanBudget,
        cancel: &CancelFlag,
    ) -> Result<InitialScan> {
        budget.validate()?;
        let root = self.get_root(root_id)?;
        grant::require_active(&root)?;
        let identity = reader::DirIdentity {
            dev: root.dev.clone(),
            ino: root.ino.clone(),
        };
        // Re-open before walking so a replaced path cannot be scanned under the old grant.
        let _ = reader::identify_relative(std::path::Path::new(&root.path), &identity, "")?;
        let walked = walk_scan(&root, &identity, budget, cancel)?;
        let root_now = self.get_root(root_id)?;
        grant::require_active(&root_now)?;
        self.with_tx(|tx| persist_scan(tx, &root_now, budget, &walked))
    }

    pub fn get_scan(&self, scan_id: &ScanId) -> Result<InitialScan> {
        self.with_conn(|conn| load_scan(conn, scan_id))
    }
}

struct Walked {
    status: ScanStatus,
    coverage: &'static str,
    limits_hit: Vec<String>,
    ignored: Vec<IgnoredEntry>,
    facts: BTreeMap<String, DirFacts>,
    files_seen: u32,
    dirs_seen: u32,
}

fn walk_scan(
    root: &AuthorizedRoot,
    identity: &reader::DirIdentity,
    budget: &ScanBudget,
    cancel: &CancelFlag,
) -> Result<Walked> {
    let root_path = std::path::Path::new(&root.path);
    let mut facts: BTreeMap<String, DirFacts> = BTreeMap::new();
    facts.insert(
        String::new(),
        DirFacts {
            evidence: Vec::new(),
        },
    );
    let mut ignored = Vec::new();
    let mut limits_hit = Vec::new();
    let mut entries = 1_u32;
    let mut files_seen = 0_u32;
    let mut dirs_seen = 1_u32;
    let mut total_read = 0_u64;
    let mut cancelled = cancel.is_cancelled();
    let mut queue = VecDeque::from([(String::new(), 0_u32)]);
    let mut stop = cancelled;

    while let Some((rel, depth)) = queue.pop_front() {
        if stop {
            break;
        }
        if cancel.is_cancelled() {
            cancelled = true;
            break;
        }
        if depth >= budget.max_depth {
            push_ignored(&mut ignored, &rel, "depth_capped");
            if !limits_hit.iter().any(|item| item == "max_depth") {
                limits_hit.push("max_depth".to_string());
            }
            continue;
        }
        let children = reader::inspect_directory(root_path, identity, &rel)?;
        for child in children {
            cancel.tick();
            if cancel.is_cancelled() {
                cancelled = true;
                stop = true;
                break;
            }
            if entries >= budget.max_entries {
                if !limits_hit.contains(&"max_entries".to_string()) {
                    limits_hit.push("max_entries".to_string());
                }
                stop = true;
                break;
            }
            entries += 1;
            match child {
                ChildInspect::Rejected { name, reason } => {
                    let child_rel = child_rel(&rel, &name);
                    if name.eq_ignore_ascii_case(".git") {
                        facts
                            .entry(rel.clone())
                            .or_insert_with(|| DirFacts {
                                evidence: Vec::new(),
                            })
                            .evidence
                            .push("git_entry".to_string());
                    }
                    push_ignored(&mut ignored, &child_rel, reason.as_str());
                }
                ChildInspect::Dir { name } => {
                    dirs_seen += 1;
                    let child_rel = child_rel(&rel, &name);
                    facts.entry(child_rel.clone()).or_default();
                    if depth + 1 > budget.max_depth {
                        push_ignored(&mut ignored, &child_rel, "depth_capped");
                        if !limits_hit.iter().any(|item| item == "max_depth") {
                            limits_hit.push("max_depth".to_string());
                        }
                    } else {
                        queue.push_back((child_rel, depth + 1));
                    }
                }
                ChildInspect::File { name, len: _ } => {
                    files_seen += 1;
                    let child_rel = child_rel(&rel, &name);
                    if is_manifest_name(&name) || is_monorepo_marker_name(&name) {
                        let slot = facts.entry(rel.clone()).or_insert_with(|| DirFacts {
                            evidence: Vec::new(),
                        });
                        slot.evidence.push(format!("marker:{name}"));
                        if rel.is_empty() && is_monorepo_marker_name(&name) {
                            slot.evidence.push(format!("monorepo:{name}"));
                        }
                    }
                    if rel.is_empty()
                        && (name.eq_ignore_ascii_case("package.json")
                            || name.eq_ignore_ascii_case("Cargo.toml"))
                    {
                        match read_manifest(
                            root_path,
                            identity,
                            &name,
                            budget,
                            &mut total_read,
                            &mut limits_hit,
                        ) {
                            Ok(Some(flag)) => {
                                facts.entry(String::new()).or_default().evidence.push(flag);
                            }
                            Ok(None) => {}
                            Err(err) => {
                                push_ignored(&mut ignored, &child_rel, err.code_str());
                            }
                        }
                    }
                }
            }
        }
    }

    let status = if cancelled {
        ScanStatus::Cancelled
    } else if limits_hit.is_empty() {
        ScanStatus::Completed
    } else {
        ScanStatus::Limited
    };
    let coverage = if status == ScanStatus::Completed {
        "full"
    } else {
        "partial"
    };
    Ok(Walked {
        status,
        coverage,
        limits_hit,
        ignored,
        facts,
        files_seen,
        dirs_seen,
    })
}

impl Default for DirFacts {
    fn default() -> Self {
        Self {
            evidence: Vec::new(),
        }
    }
}

fn read_manifest(
    root: &std::path::Path,
    identity: &reader::DirIdentity,
    name: &str,
    budget: &ScanBudget,
    total_read: &mut u64,
    limits_hit: &mut Vec<String>,
) -> Result<Option<String>> {
    if *total_read >= budget.max_total_bytes {
        if !limits_hit.iter().any(|s| s == "max_total_bytes") {
            limits_hit.push("max_total_bytes".to_string());
        }
        return Ok(None);
    }
    let remaining = budget.max_total_bytes - *total_read;
    let cap = budget.max_file_bytes.min(remaining);
    let read = reader::read_file(root, identity, name, cap)?;
    *total_read += read.bytes.len() as u64;
    if read.truncated {
        if !limits_hit.iter().any(|s| s == "max_file_bytes") {
            limits_hit.push("max_file_bytes".to_string());
        }
        return Ok(None);
    }
    let text = String::from_utf8(read.bytes).unwrap_or_default();
    if name.eq_ignore_ascii_case("package.json") {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
            if value.get("workspaces").is_some() {
                return Ok(Some("monorepo:package_workspaces".to_string()));
            }
        }
    }
    if name.eq_ignore_ascii_case("Cargo.toml") {
        for line in text.lines() {
            if line.trim() == "[workspace]" {
                return Ok(Some("monorepo:cargo_workspace".to_string()));
            }
        }
    }
    Ok(None)
}

fn child_rel(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn push_ignored(ignored: &mut Vec<IgnoredEntry>, path: &str, reason: &str) {
    if ignored.len() >= MAX_IGNORED_RECORDS {
        return;
    }
    ignored.push(IgnoredEntry {
        relative_path: path.to_string(),
        reason: reason.to_string(),
    });
}

fn persist_scan(
    tx: &rusqlite::Transaction<'_>,
    root: &AuthorizedRoot,
    budget: &ScanBudget,
    walked: &Walked,
) -> Result<InitialScan> {
    let id = ScanId::new();
    let now = Utc::now().to_rfc3339();
    let monorepo = walked
        .facts
        .get("")
        .map(|f| f.evidence.iter().any(|e| e.starts_with("monorepo:")))
        .unwrap_or(false);
    let mut candidates = Vec::new();
    let mut root_evidence = walked
        .facts
        .get("")
        .map(|f| f.evidence.clone())
        .unwrap_or_default();
    root_evidence.push("default_single_project".to_string());
    root_evidence.sort();
    root_evidence.dedup();
    candidates.push(ScanCandidate {
        id: CandidateId::new(),
        relative_path: String::new(),
        role: CandidateRole::SingleRoot,
        evidence: root_evidence,
        suggested: true,
        workspace_id: None,
    });
    for (rel, facts) in &walked.facts {
        if rel.is_empty() {
            continue;
        }
        let independent = facts
            .evidence
            .iter()
            .any(|e| e == "git_entry" || e.starts_with("marker:"));
        if !independent {
            continue;
        }
        let mut evidence = facts.evidence.clone();
        evidence.sort();
        evidence.dedup();
        let role = if monorepo {
            CandidateRole::ModuleHint
        } else {
            CandidateRole::IndependentProject
        };
        candidates.push(ScanCandidate {
            id: CandidateId::new(),
            relative_path: rel.clone(),
            role,
            evidence,
            suggested: false,
            workspace_id: None,
        });
    }
    tx.execute(
        "INSERT INTO scan_sessions (
            id, root_id, status, coverage, budget_json, limits_hit_json, ignored_json,
            files_seen, dirs_seen, created_at, finished_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![
            id.as_str(),
            root.id.as_str(),
            walked.status.as_str(),
            walked.coverage,
            serde_json::to_string(budget)?,
            serde_json::to_string(&walked.limits_hit)?,
            serde_json::to_string(&walked.ignored)?,
            walked.files_seen,
            walked.dirs_seen,
            now,
        ],
    )?;
    for candidate in &candidates {
        tx.execute(
            "INSERT INTO scan_candidates (
                id, scan_id, relative_path, role, evidence_json, suggested, workspace_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![
                candidate.id.as_str(),
                id.as_str(),
                candidate.relative_path,
                candidate.role.as_str(),
                serde_json::to_string(&candidate.evidence)?,
                if candidate.suggested { 1 } else { 0 },
            ],
        )?;
    }
    Ok(InitialScan {
        id,
        root_id: root.id.clone(),
        status: walked.status,
        coverage: walked.coverage.to_string(),
        limits_hit: walked.limits_hit.clone(),
        ignored: walked.ignored.clone(),
        candidates,
        default_single_project: true,
        files_seen: walked.files_seen,
        dirs_seen: walked.dirs_seen,
        created_at: now.clone(),
        finished_at: now,
    })
}

pub(crate) fn load_scan(conn: &rusqlite::Connection, scan_id: &ScanId) -> Result<InitialScan> {
    let row = conn
        .query_row(
            "SELECT id, root_id, status, coverage, budget_json, limits_hit_json, ignored_json, files_seen, dirs_seen, created_at, finished_at
             FROM scan_sessions WHERE id = ?1",
            params![scan_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| CoreError::new(ErrorCode::NotFound, scan_id.as_str()))?;
    let mut stmt = conn.prepare(
        "SELECT id, relative_path, role, evidence_json, suggested, workspace_id
         FROM scan_candidates WHERE scan_id = ?1 ORDER BY relative_path, id",
    )?;
    let cand_rows = stmt.query_map(params![scan_id.as_str()], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    })?;
    let mut candidates = Vec::new();
    for cand in cand_rows {
        let (id, relative_path, role, evidence, suggested, workspace_id) = cand?;
        candidates.push(ScanCandidate {
            id: CandidateId::from_trusted(id),
            relative_path,
            role: CandidateRole::parse(&role)?,
            evidence: serde_json::from_str(&evidence)?,
            suggested: suggested == 1,
            workspace_id,
        });
    }
    Ok(InitialScan {
        id: ScanId::from_trusted(row.0),
        root_id: RootId::from_trusted(row.1),
        status: ScanStatus::parse(&row.2)?,
        coverage: row.3,
        limits_hit: serde_json::from_str(&row.4)?,
        ignored: serde_json::from_str(&row.5)?,
        candidates,
        default_single_project: true,
        files_seen: row.6 as u32,
        dirs_seen: row.7 as u32,
        created_at: row.8,
        finished_at: row.9,
    })
}
