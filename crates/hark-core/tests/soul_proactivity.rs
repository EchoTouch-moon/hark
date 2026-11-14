#![cfg(unix)]

//! Integration tests for Hark Soul & Proactivity in `hark-core`:
//! - L0/L1 Workspace Context Pack (`build_context_pack`)
//! - Verifiable `NarrativeState` (`workspace_narrative_state`)
//! - Bounded Incremental Observer & Attention projection (`observe_workspace_changes`, `list_attention_items`)

use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

use hark_core::{
    reader_open_attempts, reset_reader_work_counters, CancelFlag, ConfirmImport, Core, FlameStage,
    ImportMode, MemoryCallContext, MemoryCaller, MemoryChangeProposal, MemoryNoteKind,
    MemoryOperation, MemorySearchInput, NarrativeAvailability, ObservationStatus,
    OpinionChangeProposal, OpinionFeedbackAction, OpinionFeedbackInput, ScanBudget,
    SourceFreshness, Workspace, WorkspaceId, OUTCOME_COMMITTED,
};

struct Db {
    _dir: tempfile::TempDir,
    path: PathBuf,
    core: Core,
}

impl Db {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hark.db");
        let core = Core::open(&path).unwrap();
        Self {
            _dir: dir,
            path,
            core,
        }
    }

    fn reopen(&mut self) {
        self.core = Core::open(&self.path).unwrap();
    }
}

fn project(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "hark-soul-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    root
}

fn cleanup(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

fn default_budget() -> ScanBudget {
    ScanBudget {
        max_entries: 100,
        max_depth: 3,
        max_file_bytes: 32 * 1024,
        max_total_bytes: 128 * 1024,
    }
}

fn setup_workspace(
    name: &str,
    files: &[(&str, &str)],
) -> (Db, PathBuf, hark_core::RootId, Workspace) {
    let db = Db::new();
    let root_path = project(name);
    for (rel, content) in files {
        let full = root_path.join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(full, content).unwrap();
    }
    let root = db.core.authorize_directory(&root_path).unwrap();
    let scan = db
        .core
        .run_initial_scan(&root.id, &default_budget(), &CancelFlag::new())
        .unwrap();
    let ws = db
        .core
        .confirm_import(&ConfirmImport {
            root_id: root.id.clone(),
            scan_id: scan.id,
            mode: ImportMode::SingleProject,
            enable_model_initial_read: false,
        })
        .unwrap()
        .workspaces
        .into_iter()
        .next()
        .unwrap();
    (db, root_path, root.id, ws)
}

fn ctx(ws: &WorkspaceId, op: &str, msg_id: Option<hark_core::MessageId>) -> MemoryCallContext {
    MemoryCallContext {
        workspace_id: ws.clone(),
        operation_id: op.to_string(),
        current_user_message_id: msg_id,
        caller: MemoryCaller::User,
    }
}

#[test]
fn empty_workspace_context_pack_and_neutral_narrative_ignore_message_counts() {
    let (db, root_path, _root_id, ws) = setup_workspace("empty", &[]);

    let pack = db.core.build_context_pack(&ws.id).unwrap();
    assert!(pack.empty);
    assert!(pack.identity.is_none());
    assert!(pack.overview.is_none());
    assert!(!pack.context_pack_revision.is_empty());
    assert!(!pack.source_version.is_empty());
    let snap = pack.to_snapshot();
    assert!(snap.empty);
    assert_eq!(snap.context_pack_revision, pack.context_pack_revision);

    let narrative = db.core.workspace_narrative_state(&ws.id).unwrap();
    assert_eq!(narrative.availability, NarrativeAvailability::Unknown);
    assert_eq!(narrative.flame, FlameStage::Neutral);
    assert!(!narrative.stale);
    assert!(narrative.basis_refs.is_empty());
    assert!(narrative.observed_at.is_none());

    assert!(db.core.list_attention_items(&ws.id).unwrap().is_empty());

    // Appending many chat messages without verified reads/decisions/opinions
    // must never inflate NarrativeState or ContextPack.
    for i in 0..15 {
        db.core
            .append_user_message(
                &ws.id,
                &format!("普通聊天消息 {i}，没有沉淀任何决定或文件读取"),
            )
            .unwrap();
    }
    let narrative_after = db.core.workspace_narrative_state(&ws.id).unwrap();
    assert_eq!(narrative_after.availability, NarrativeAvailability::Unknown);
    assert_eq!(narrative_after.flame, FlameStage::Neutral);
    assert!(!narrative_after.stale);

    let pack_after = db.core.build_context_pack(&ws.id).unwrap();
    assert!(pack_after.empty);

    cleanup(&root_path);
}

#[test]
fn l0_l1_context_pack_prioritizes_memories_separates_opinions_and_respects_budget() {
    let (db, root_path, root_id, ws) = setup_workspace(
        "pack",
        &[
            (
                "README.md",
                "# Hark Soul\nDesktop cognitive core in Rust with SQLite FTS5.\n",
            ),
            (
                "Cargo.toml",
                "[package]\nname = \"hark-soul\"\nversion = \"0.1.0\"\n",
            ),
        ],
    );

    let read = db
        .core
        .selective_key_read(&ws.id, &default_budget(), &CancelFlag::new())
        .unwrap();
    assert_eq!(read.sources.len(), 2);
    let readme_src = read
        .sources
        .iter()
        .find(|s| s.relative_path == "README.md")
        .unwrap()
        .clone();
    let cargo_src = read
        .sources
        .iter()
        .find(|s| s.relative_path == "Cargo.toml")
        .unwrap()
        .clone();

    let u1 = db
        .core
        .append_user_message(&ws.id, "项目定位是本地桌面对话炉心 Hark。我们决定使用 Rust Core 负责全部写入与权限校验。记住这点，这是经验。")
        .unwrap();

    // Add identity, decision, and experience memories.
    let m_id = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-id", Some(u1.id.clone())),
            &MemoryChangeProposal {
                operation: MemoryOperation::Add,
                kind: MemoryNoteKind::Identity,
                content: "本地桌面对话炉心 Hark".to_string(),
                source_refs: Vec::new(),
                target_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert_eq!(m_id.outcome, OUTCOME_COMMITTED);

    let m_dec = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-dec", Some(u1.id.clone())),
            &MemoryChangeProposal {
                operation: MemoryOperation::Add,
                kind: MemoryNoteKind::Decision,
                content: "使用 Rust Core 负责全部写入与权限校验".to_string(),
                source_refs: Vec::new(),
                target_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert_eq!(m_dec.outcome, OUTCOME_COMMITTED);

    let m_exp = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-exp", Some(u1.id.clone())),
            &MemoryChangeProposal {
                operation: MemoryOperation::Add,
                kind: MemoryNoteKind::Experience,
                content: "使用 Rust Core 负责全部写入与权限校验".to_string(),
                source_refs: Vec::new(),
                target_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert_eq!(m_exp.outcome, OUTCOME_COMMITTED);

    // Add one active opinion, one disputed opinion, and one retracted opinion.
    let op_active = db
        .core
        .opinion_propose_change(
            &ctx(&ws.id, "op-opn-1", None),
            &OpinionChangeProposal {
                operation: MemoryOperation::Add,
                summary: "README.md 明确项目采用 Rust Core 与 SQLite FTS5。".to_string(),
                evidence_refs: vec![readme_src.id.as_str().to_string()],
                counter_arguments: vec!["暂未验证 Windows 构建".to_string()],
                uncertainties: vec!["是否包含外部搜索配置".to_string()],
                target_opinion_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert_eq!(op_active.outcome, OUTCOME_COMMITTED);

    let op_disp = db
        .core
        .opinion_propose_change(
            &ctx(&ws.id, "op-opn-2", None),
            &OpinionChangeProposal {
                operation: MemoryOperation::Add,
                summary: "Cargo.toml 当前包名为 hark-soul，建议后续对齐 workspace 命名。"
                    .to_string(),
                evidence_refs: vec![cargo_src.id.as_str().to_string()],
                counter_arguments: Vec::new(),
                uncertainties: Vec::new(),
                target_opinion_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    let op_disp_id = op_disp.opinion_id.unwrap();
    db.core
        .submit_opinion_feedback(&OpinionFeedbackInput {
            request_id: "fb-rebut-1".to_string(),
            workspace_id: ws.id.clone(),
            opinion_id: op_disp_id.clone(),
            expected_revision: 1,
            action: OpinionFeedbackAction::Rebut,
            user_comment: Some("当前命名已是预期配置".to_string()),
            caller: MemoryCaller::User,
        })
        .unwrap();

    let op_ret = db
        .core
        .opinion_propose_change(
            &ctx(&ws.id, "op-opn-3", None),
            &OpinionChangeProposal {
                operation: MemoryOperation::Add,
                summary: "Hark Soul 的 SQLite FTS5 这条临时猜测将被撤回。".to_string(),
                evidence_refs: vec![readme_src.id.as_str().to_string()],
                counter_arguments: Vec::new(),
                uncertainties: Vec::new(),
                target_opinion_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert_eq!(op_ret.outcome, OUTCOME_COMMITTED);
    let op_ret_id = op_ret.opinion_id.unwrap();
    db.core
        .opinion_propose_change(
            &ctx(&ws.id, "op-opn-3-retract", None),
            &OpinionChangeProposal {
                operation: MemoryOperation::Retract,
                summary: "撤回".to_string(),
                evidence_refs: vec![readme_src.id.as_str().to_string()],
                counter_arguments: Vec::new(),
                uncertainties: Vec::new(),
                target_opinion_id: Some(op_ret_id.clone()),
                expected_revision: Some(1),
            },
        )
        .unwrap();

    let pack = db.core.build_context_pack(&ws.id).unwrap();
    assert!(!pack.empty);
    assert_eq!(pack.memory_count, 3);
    assert_eq!(pack.active_opinion_count, 1);
    assert_eq!(pack.attention_opinion_count, 1);
    assert_eq!(pack.source_count, 2);
    assert_eq!(pack.stale_source_count, 0);

    let identity = pack.identity.as_deref().unwrap();
    assert!(identity.chars().count() <= 2000);
    assert!(identity.contains("[identity]"));
    assert!(identity.contains("[decision]"));
    assert!(identity.contains("[experience]"));
    assert!(identity.contains(m_id.memory_id.as_deref().unwrap()));
    assert!(identity.contains(m_dec.memory_id.as_deref().unwrap()));

    let overview = pack.overview.as_deref().unwrap();
    assert!(overview.chars().count() <= 4000);
    assert!(overview.contains("[local_fact]"));
    assert!(overview.contains(readme_src.id.as_str()));
    assert!(overview.contains("[opinions:active]"));
    assert!(overview.contains(op_active.opinion_id.as_deref().unwrap()));
    assert!(overview.contains("[opinions:attention]"));
    assert!(overview.contains(&op_disp_id));
    assert!(
        !overview.contains(&op_ret_id),
        "retracted opinion must not be active/attention"
    );

    // Deterministic revision when nothing changed.
    let pack_again = db.core.build_context_pack(&ws.id).unwrap();
    assert_eq!(pack.context_pack_revision, pack_again.context_pack_revision);
    assert_eq!(pack.source_version, pack_again.source_version);

    // Pausing directory omits file excerpts from overview and changes revision.
    db.core.pause_directory(&root_id).unwrap();
    let paused_pack = db.core.build_context_pack(&ws.id).unwrap();
    let paused_overview = paused_pack.overview.as_deref().unwrap();
    assert!(paused_overview.contains("directory_unavailable"));
    assert!(!paused_overview.contains("Desktop cognitive core in Rust"));
    assert_ne!(paused_pack.source_version, pack.source_version);

    cleanup(&root_path);
}

#[test]
fn narrative_stages_follow_verifiable_facts_and_downgrade_when_stale_or_paused() {
    let (db, root_path, root_id, ws) = setup_workspace(
        "narrative",
        &[(
            "README.md",
            "# Stage Test\nInitial project overview for Hark.\n",
        )],
    );

    // 1. Neutral before any reads/memories.
    let n0 = db.core.workspace_narrative_state(&ws.id).unwrap();
    assert_eq!(n0.availability, NarrativeAvailability::Unknown);
    assert_eq!(n0.flame, FlameStage::Neutral);

    // 2. Ember after selective read.
    let read = db
        .core
        .selective_key_read(&ws.id, &default_budget(), &CancelFlag::new())
        .unwrap();
    let readme_src = &read.sources[0];
    let n1 = db.core.workspace_narrative_state(&ws.id).unwrap();
    assert_eq!(n1.availability, NarrativeAvailability::Known);
    assert_eq!(n1.flame, FlameStage::Ember);
    assert!(!n1.stale);
    assert!(n1.basis_refs.contains(&readme_src.id.as_str().to_string()));

    // 3. Gentle after an active opinion is created.
    let opn_res = db
        .core
        .opinion_propose_change(
            &ctx(&ws.id, "op-nar-opn", None),
            &OpinionChangeProposal {
                operation: MemoryOperation::Add,
                summary: "Stage Test 说明 Hark 处于 Initial project overview 阶段。".to_string(),
                evidence_refs: vec![readme_src.id.as_str().to_string()],
                counter_arguments: Vec::new(),
                uncertainties: Vec::new(),
                target_opinion_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert_eq!(opn_res.outcome, OUTCOME_COMMITTED);
    let n2 = db.core.workspace_narrative_state(&ws.id).unwrap();
    assert_eq!(n2.availability, NarrativeAvailability::Known);
    assert_eq!(n2.flame, FlameStage::Gentle);

    // 4. Bright after 1 committed decision (without identity/experience yet? wait: active_opinion + 1 decision without identity/2nd decision -> Bright!).
    let u1 = db
        .core
        .append_user_message(&ws.id, "我们决定优先交付 Hark 核心引擎")
        .unwrap();
    db.core
        .memory_propose_change(
            &ctx(&ws.id, "op-nar-dec1", Some(u1.id.clone())),
            &MemoryChangeProposal {
                operation: MemoryOperation::Add,
                kind: MemoryNoteKind::Decision,
                content: "优先交付 Hark 核心引擎".to_string(),
                source_refs: Vec::new(),
                target_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    let n3 = db.core.workspace_narrative_state(&ws.id).unwrap();
    assert_eq!(n3.availability, NarrativeAvailability::Known);
    assert_eq!(n3.flame, FlameStage::Bright);
    assert!(!n3.stale);

    // 5. Milestone after identity (or 2nd decision) joins fresh sources + active opinion + decision.
    let u2 = db
        .core
        .append_user_message(&ws.id, "Hark 是本地优先桌面伙伴")
        .unwrap();
    db.core
        .memory_propose_change(
            &ctx(&ws.id, "op-nar-id", Some(u2.id)),
            &MemoryChangeProposal {
                operation: MemoryOperation::Add,
                kind: MemoryNoteKind::Identity,
                content: "Hark 是本地优先桌面伙伴".to_string(),
                source_refs: Vec::new(),
                target_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    let n4 = db.core.workspace_narrative_state(&ws.id).unwrap();
    assert_eq!(n4.availability, NarrativeAvailability::Known);
    assert_eq!(n4.flame, FlameStage::Milestone);
    assert!(!n4.stale);

    // 6. Modifying README.md and running observer marks evidence/opinion stale -> must NOT stay Milestone!
    fs::write(
        root_path.join("README.md"),
        "# Stage Test\nArchitecture pivoted significantly.\n",
    )
    .unwrap();
    db.core
        .observe_workspace_changes(&ws.id, &default_budget(), &CancelFlag::new())
        .unwrap();
    let n5 = db.core.workspace_narrative_state(&ws.id).unwrap();
    assert!(n5.stale);
    assert_ne!(n5.flame, FlameStage::Milestone);
    assert_eq!(n5.flame, FlameStage::Gentle);

    // 7. Pausing and revoking return Unknown/Neutral honestly.
    db.core.pause_directory(&root_id).unwrap();
    let n_paused = db.core.workspace_narrative_state(&ws.id).unwrap();
    assert_eq!(n_paused.availability, NarrativeAvailability::Unknown);
    assert_eq!(n_paused.flame, FlameStage::Neutral);
    assert!(n_paused.stale);

    db.core.revoke_directory(&root_id).unwrap();
    let n_revoked = db.core.workspace_narrative_state(&ws.id).unwrap();
    assert_eq!(n_revoked.availability, NarrativeAvailability::Unknown);
    assert_eq!(n_revoked.flame, FlameStage::Neutral);
    assert!(n_revoked.stale);

    cleanup(&root_path);
}

#[test]
fn incremental_observer_marks_stale_opinions_preserves_history_and_deduplicates_attention() {
    let (mut db, root_path, _root_id, ws) = setup_workspace(
        "observer",
        &[
            ("README.md", "# Project Alpha\nUses SQLite and Rust core.\n"),
            (
                "Cargo.toml",
                "[package]\nname = \"alpha\"\nversion = \"0.1.0\"\n",
            ),
            (".git/HEAD", "ref: refs/heads/main\n"),
        ],
    );

    let read = db
        .core
        .selective_key_read(&ws.id, &default_budget(), &CancelFlag::new())
        .unwrap();
    let readme_src = read
        .sources
        .iter()
        .find(|s| s.relative_path == "README.md")
        .unwrap()
        .clone();
    let cargo_src = read
        .sources
        .iter()
        .find(|s| s.relative_path == "Cargo.toml")
        .unwrap()
        .clone();

    let opn_receipt = db
        .core
        .opinion_propose_change(
            &ctx(&ws.id, "op-obs-opn", None),
            &OpinionChangeProposal {
                operation: MemoryOperation::Add,
                summary: "README.md 显示 Project Alpha 基于 SQLite 与 Rust core。".to_string(),
                evidence_refs: vec![readme_src.id.as_str().to_string()],
                counter_arguments: Vec::new(),
                uncertainties: Vec::new(),
                target_opinion_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    let opinion_id = opn_receipt.opinion_id.unwrap();

    // First observation: establishes git HEAD baseline; no file changes yet.
    let r1 = db
        .core
        .observe_workspace_changes(&ws.id, &default_budget(), &CancelFlag::new())
        .unwrap();
    assert_eq!(r1.status, ObservationStatus::Observed);
    assert!(r1.changed_files.is_empty());
    assert!(r1.stale_opinion_ids.is_empty());
    assert!(!r1.git_head_changed);
    assert_eq!(r1.git_head.as_deref(), Some("ref: refs/heads/main"));

    // Modify README.md, delete Cargo.toml, switch .git/HEAD, and add ARCHITECTURE.md.
    fs::write(
        root_path.join("README.md"),
        "# Project Alpha\nSwitched storage backend to Postgres.\n",
    )
    .unwrap();
    fs::remove_file(root_path.join("Cargo.toml")).unwrap();
    fs::write(root_path.join(".git/HEAD"), "ref: refs/heads/feature-pg\n").unwrap();
    fs::write(
        root_path.join("ARCHITECTURE.md"),
        "# Architecture\nNew architecture doc.\n",
    )
    .unwrap();

    let r2 = db
        .core
        .observe_workspace_changes(&ws.id, &default_budget(), &CancelFlag::new())
        .unwrap();
    assert_eq!(r2.status, ObservationStatus::Observed);
    assert!(r2.git_head_changed);
    assert_eq!(r2.git_head.as_deref(), Some("ref: refs/heads/feature-pg"));
    assert_eq!(r2.stale_opinion_ids, vec![opinion_id.clone()]);

    let readme_change = r2
        .changed_files
        .iter()
        .find(|c| c.relative_path == "README.md")
        .unwrap();
    assert_eq!(readme_change.freshness, SourceFreshness::Changed);
    assert_eq!(
        readme_change.previous_source_id.as_ref(),
        Some(&readme_src.id)
    );
    let new_readme_src_id = readme_change.new_source_id.as_ref().unwrap().clone();
    assert_ne!(new_readme_src_id, readme_src.id);

    let cargo_change = r2
        .changed_files
        .iter()
        .find(|c| c.relative_path == "Cargo.toml")
        .unwrap();
    assert_eq!(cargo_change.freshness, SourceFreshness::Missing);
    assert_eq!(
        cargo_change.previous_source_id.as_ref(),
        Some(&cargo_src.id)
    );
    assert!(cargo_change.new_source_id.is_none());

    let arch_change = r2
        .changed_files
        .iter()
        .find(|c| c.relative_path == "ARCHITECTURE.md")
        .unwrap();
    assert_eq!(arch_change.freshness, SourceFreshness::Fresh);
    assert!(arch_change.new_source_id.is_some());

    // Opinion is marked stale with full revision history preserved and judgment_generated=false.
    let op_view = db.core.get_opinion(&opinion_id).unwrap();
    assert_eq!(op_view.status, "stale");
    assert_eq!(op_view.revision, 2);
    assert!(!op_view.judgment_generated);
    assert_eq!(op_view.history.len(), 2);
    assert_eq!(op_view.history[0].status, "active");
    assert_eq!(op_view.history[1].status, "stale");

    // Old source excerpt in search index is marked historical.
    let search_res = db
        .core
        .search_workspace_memory(&MemorySearchInput {
            workspace_id: ws.id.clone(),
            query: "SQLite".to_string(),
            kinds: Some(vec!["local_fact".to_string()]),
            cursor: None,
        })
        .unwrap();
    let old_doc = search_res
        .items
        .iter()
        .find(|item| item.source_ref_id.as_deref() == Some(readme_src.id.as_str()))
        .unwrap();
    assert!(old_doc.historical);

    // Attention items: 1 for stale opinion (covering README.md), 1 for missing Cargo.toml, 1 for git HEAD.
    assert_eq!(r2.attention_items.len(), 3, "{:?}", r2.attention_items);
    let op_attn = r2
        .attention_items
        .iter()
        .find(|a| a.target_opinion_id.as_deref() == Some(opinion_id.as_str()))
        .unwrap();
    assert_eq!(
        op_attn.target_evidence_id.as_deref(),
        Some(new_readme_src_id.as_str())
    );
    assert!(!op_attn.dismissed);

    // Running observer again without new changes must NOT add duplicate revisions or duplicate attention items.
    let r3 = db
        .core
        .observe_workspace_changes(&ws.id, &default_budget(), &CancelFlag::new())
        .unwrap();
    assert!(r3.changed_files.is_empty());
    assert!(r3.stale_opinion_ids.is_empty());
    assert!(!r3.git_head_changed);
    assert_eq!(r3.attention_items.len(), 3);
    let op_view_after = db.core.get_opinion(&opinion_id).unwrap();
    assert_eq!(op_view_after.revision, 2);

    // Reopening Core preserves all state and attention items.
    db.reopen();
    let listed_after_reopen = db.core.list_attention_items(&ws.id).unwrap();
    assert_eq!(listed_after_reopen.len(), 3);
    assert_eq!(db.core.get_opinion(&opinion_id).unwrap().status, "stale");

    // Dismissing an attention item persists across reopen.
    assert!(db.core.dismiss_attention_item(&ws.id, &op_attn.id).unwrap());
    db.reopen();
    let after_dismiss = db.core.list_attention_items(&ws.id).unwrap();
    assert!(
        after_dismiss
            .iter()
            .find(|a| a.id == op_attn.id)
            .unwrap()
            .dismissed
    );

    cleanup(&root_path);
}

#[test]
fn observer_refuses_symlinks_and_paused_or_revoked_directories_without_modifying_sources() {
    let (db, root_path, root_id, ws) = setup_workspace(
        "refusal",
        &[("README.md", "# Safe Root\nOriginal content.\n")],
    );

    let read = db
        .core
        .selective_key_read(&ws.id, &default_budget(), &CancelFlag::new())
        .unwrap();
    assert_eq!(read.sources.len(), 1);
    let orig_sources = db.core.list_source_refs(&ws.id).unwrap();

    // Pause directory -> observer must return Paused without any reader opens or source changes.
    fs::write(root_path.join("README.md"), "# Modified while paused\n").unwrap();
    db.core.pause_directory(&root_id).unwrap();
    reset_reader_work_counters();
    let paused_report = db
        .core
        .observe_workspace_changes(&ws.id, &default_budget(), &CancelFlag::new())
        .unwrap();
    assert_eq!(paused_report.status, ObservationStatus::Paused);
    assert_eq!(paused_report.checked_paths, 0);
    assert!(paused_report.changed_files.is_empty());
    assert_eq!(reader_open_attempts(), 0);

    // Resume, then replace README.md with a symlink -> reader rejects symlink and marks Unreadable.
    db.core.resume_directory(&root_id).unwrap();
    let outside = project("outside-secret");
    fs::write(outside.join("secret.txt"), "do not read me").unwrap();
    fs::remove_file(root_path.join("README.md")).unwrap();
    symlink(outside.join("secret.txt"), root_path.join("README.md")).unwrap();

    let sym_report = db
        .core
        .observe_workspace_changes(&ws.id, &default_budget(), &CancelFlag::new())
        .unwrap();
    assert_eq!(sym_report.status, ObservationStatus::Observed);
    let readme_sym = sym_report
        .changed_files
        .iter()
        .find(|c| c.relative_path == "README.md")
        .unwrap();
    assert_eq!(readme_sym.freshness, SourceFreshness::Unreadable);
    assert!(readme_sym.new_source_id.is_none());

    // Sources count did not add outside secret content.
    assert_eq!(
        db.core.list_source_refs(&ws.id).unwrap().len(),
        orig_sources.len()
    );

    // Revoke directory -> observer returns Revoked without opening files.
    db.core.revoke_directory(&root_id).unwrap();
    reset_reader_work_counters();
    let revoked_report = db
        .core
        .observe_workspace_changes(&ws.id, &default_budget(), &CancelFlag::new())
        .unwrap();
    assert_eq!(revoked_report.status, ObservationStatus::Revoked);
    assert_eq!(revoked_report.checked_paths, 0);
    assert!(revoked_report.changed_files.is_empty());
    assert_eq!(reader_open_attempts(), 0);

    cleanup(&outside);
    cleanup(&root_path);
}
