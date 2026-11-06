#![cfg(unix)]

//! Memory, opinion, feedback, and search. Synthetic temp data only. No model call.

use std::fs;
use std::path::{Path, PathBuf};

use hark_core::{
    ConfirmImport, Core, ErrorCode, ImportMode, MemoryCallContext, MemoryCaller,
    MemoryChangeProposal, MemoryNoteKind, MemoryOperation, MemorySearchInput, MessageId,
    OpinionChangeProposal, OpinionFeedbackAction, OpinionFeedbackInput, ScanBudget, Workspace,
    WorkspaceId, OUTCOME_COMMITTED, OUTCOME_NEEDS_CLARIFICATION, OUTCOME_NOOP,
};

const V1: &str = include_str!("../migrations/0001_init.sql");
const V2: &str = include_str!("../migrations/0002_opening_run.sql");
const V3: &str = include_str!("../migrations/0003_conversation_run.sql");

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
        "hark-memory-{name}-{}-{}",
        std::process::id(),
        uuid_tail()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    root
}

fn uuid_tail() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string()
}

fn cleanup(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

fn ready(name: &str, readme: &str) -> (Db, PathBuf, Workspace) {
    let db = Db::new();
    let root_path = project(name);
    fs::write(root_path.join("README.md"), readme).unwrap();
    let root = db.core.authorize_directory(&root_path).unwrap();
    let scan = db
        .core
        .run_initial_scan(
            &root.id,
            &ScanBudget {
                max_entries: 50,
                max_depth: 3,
                max_file_bytes: 16 * 1024,
                max_total_bytes: 64 * 1024,
            },
            &hark_core::CancelFlag::new(),
        )
        .unwrap();
    let ws = db
        .core
        .confirm_import(&ConfirmImport {
            root_id: root.id,
            scan_id: scan.id,
            mode: ImportMode::SingleProject,
            enable_model_initial_read: false,
        })
        .unwrap()
        .workspaces
        .into_iter()
        .next()
        .unwrap();
    (db, root_path, ws)
}

fn ctx(ws: &WorkspaceId, operation_id: &str, message: Option<MessageId>) -> MemoryCallContext {
    MemoryCallContext {
        workspace_id: ws.clone(),
        operation_id: operation_id.to_string(),
        current_user_message_id: message,
        caller: MemoryCaller::User,
    }
}

fn add_decision(content: &str) -> MemoryChangeProposal {
    MemoryChangeProposal {
        operation: MemoryOperation::Add,
        kind: MemoryNoteKind::Decision,
        content: content.to_string(),
        source_refs: Vec::new(),
        target_id: None,
        expected_revision: None,
    }
}

#[test]
fn save_revise_feedback_revert_conflict_and_reopen() {
    let (mut db, root_path, ws) = ready("lifecycle", "synthetic readme\n");
    let original = db
        .core
        .append_user_message(&ws.id, "我们决定先用 Tauri 做桌面壳")
        .unwrap();
    let saved = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-save", Some(original.id.clone())),
            &add_decision("先用 Tauri 做桌面壳"),
        )
        .unwrap();
    assert_eq!(saved.outcome, OUTCOME_COMMITTED);
    assert!(saved.recorded);
    assert!(saved.revision_id.is_some());
    assert!(saved.source_ids.iter().any(|id| id == original.id.as_str()));
    assert_eq!(
        saved.source_message_id.as_deref(),
        Some(original.id.as_str())
    );

    let changed = db
        .core
        .append_user_message(&ws.id, "改为先用 Tauri，Electron 不做了")
        .unwrap();
    let revised = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-revise", Some(changed.id.clone())),
            &MemoryChangeProposal {
                operation: MemoryOperation::Revise,
                kind: MemoryNoteKind::Decision,
                content: "先用 Tauri，Electron 不做了".to_string(),
                source_refs: Vec::new(),
                target_id: saved.memory_id.clone(),
                expected_revision: saved.revision,
            },
        )
        .unwrap();
    assert!(revised.recorded);
    assert_eq!(revised.revision, Some(2));

    let opinion = db
        .core
        .opinion_propose_change(
            &ctx(&ws.id, "op-opinion", Some(original.id.clone())),
            &OpinionChangeProposal {
                operation: MemoryOperation::Add,
                summary: "先用 Tauri 做桌面壳".to_string(),
                evidence_refs: vec![original.id.as_str().to_string()],
                counter_arguments: vec!["打包链路还没跑过".to_string()],
                uncertainties: vec!["Windows 打包未验证".to_string()],
                target_opinion_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert!(opinion.recorded);
    assert_eq!(db.core.list_workspace_memories(&ws.id).unwrap().len(), 1);
    let opinion_id = opinion.opinion_id.clone().unwrap();
    let listed = db.core.list_workspace_opinions(&ws.id).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, opinion_id);
    let view = db.core.get_opinion(&opinion_id).unwrap();
    assert_eq!(view.summary, "先用 Tauri 做桌面壳");
    assert!(view.judgment_generated);

    let revised_feedback = db
        .core
        .submit_opinion_feedback(&OpinionFeedbackInput {
            request_id: "fb-revise".to_string(),
            workspace_id: ws.id.clone(),
            opinion_id: opinion_id.clone(),
            expected_revision: view.revision,
            action: OpinionFeedbackAction::Revise,
            user_comment: Some("先别下结论".to_string()),
            caller: MemoryCaller::User,
        })
        .unwrap();
    assert_eq!(revised_feedback.status, "pending_revision");
    assert!(!revised_feedback.judgment_generated);
    assert_eq!(revised_feedback.summary, view.summary);
    assert_eq!(
        revised_feedback.user_feedback_note.as_deref(),
        Some("先别下结论")
    );
    assert!(revised_feedback
        .history
        .iter()
        .any(|entry| entry.note.contains("未生成新判断")));
    let replayed_feedback = db
        .core
        .submit_opinion_feedback(&OpinionFeedbackInput {
            request_id: "fb-revise".to_string(),
            workspace_id: ws.id.clone(),
            opinion_id: opinion_id.clone(),
            expected_revision: revised_feedback.revision,
            action: OpinionFeedbackAction::Revise,
            user_comment: Some("另一句不该再写一次".to_string()),
            caller: MemoryCaller::User,
        })
        .unwrap();
    assert!(replayed_feedback.replayed);
    assert_eq!(replayed_feedback.revision, revised_feedback.revision);
    assert_eq!(
        replayed_feedback.user_feedback_note.as_deref(),
        Some("先别下结论")
    );

    let shelved = db
        .core
        .submit_opinion_feedback(&OpinionFeedbackInput {
            request_id: "fb-shelve".to_string(),
            workspace_id: ws.id.clone(),
            opinion_id: opinion_id.clone(),
            expected_revision: revised_feedback.revision,
            action: OpinionFeedbackAction::Shelve,
            user_comment: Some("先搁置".to_string()),
            caller: MemoryCaller::User,
        })
        .unwrap();
    assert_eq!(shelved.status, "shelved");
    assert!(shelved
        .history
        .iter()
        .any(|entry| entry.note.contains("不是否定事实")));
    let decision = db
        .core
        .get_memory(&ws.id, saved.memory_id.as_ref().unwrap())
        .unwrap();
    assert_eq!(decision.text, "先用 Tauri，Electron 不做了");

    let reverted = db
        .core
        .revert_memory_operation(&ws.id, "op-revise")
        .unwrap();
    assert!(reverted.reverted);
    assert!(!reverted.recorded);
    assert_eq!(reverted.outcome, "reverted");
    let restored = db
        .core
        .get_memory(&ws.id, saved.memory_id.as_ref().unwrap())
        .unwrap();
    assert_eq!(restored.text, "先用 Tauri 做桌面壳");
    assert!(restored
        .history
        .iter()
        .any(|entry| { entry.historical && entry.content.contains("Electron") }));
    let conflict = db
        .core
        .revert_memory_operation(&ws.id, "op-save")
        .unwrap_err();
    assert_eq!(conflict.code, ErrorCode::ConflictRevision);
    let untouched = db
        .core
        .get_memory(&ws.id, saved.memory_id.as_ref().unwrap())
        .unwrap();
    assert_eq!(untouched.revision, restored.revision);
    assert_eq!(untouched.text, restored.text);
    let original_body = db
        .core
        .list_conversation(&ws.id)
        .unwrap()
        .into_iter()
        .find(|event| event.id == original.id)
        .unwrap();
    assert_eq!(original_body.body, "我们决定先用 Tauri 做桌面壳");

    db.reopen();
    let after = db
        .core
        .get_memory(&ws.id, saved.memory_id.as_ref().unwrap())
        .unwrap();
    assert_eq!(after.text, "先用 Tauri 做桌面壳");
    let opinion_after = db.core.get_opinion(&opinion_id).unwrap();
    assert_eq!(opinion_after.status, "shelved");
    assert_eq!(
        opinion_after
            .history
            .iter()
            .find(|entry| entry.revision == revised_feedback.revision)
            .unwrap()
            .note
            .contains("未生成新判断"),
        true
    );
    cleanup(&root_path);
}

#[test]
fn replay_same_operation_does_not_write_a_second_revision() {
    let (db, root_path, ws) = ready("replay", "synthetic\n");
    let message = db
        .core
        .append_user_message(&ws.id, "我们决定先用 Tauri 做桌面壳")
        .unwrap();
    let first = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-replay", Some(message.id.clone())),
            &add_decision("先用 Tauri 做桌面壳"),
        )
        .unwrap();
    let second = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-replay", Some(message.id)),
            &add_decision("已彻底切换到 Electron"),
        )
        .unwrap();
    assert!(second.replayed);
    assert_eq!(second.outcome, first.outcome);
    assert_eq!(second.memory_id, first.memory_id);
    assert_eq!(second.revision_id, first.revision_id);
    assert_eq!(second.content.as_deref(), Some("先用 Tauri 做桌面壳"));
    assert_eq!(db.core.list_workspace_memories(&ws.id).unwrap().len(), 1);
    cleanup(&root_path);
}

#[test]
fn cross_workspace_and_missing_source_are_rejected() {
    let (db, root_a, ws_a) = ready("scope-a", "a\n");
    let root_b = project("scope-b");
    fs::write(root_b.join("README.md"), "b\n").unwrap();
    let other_root = db.core.authorize_directory(&root_b).unwrap();
    let scan = db
        .core
        .run_initial_scan(
            &other_root.id,
            &ScanBudget {
                max_entries: 20,
                max_depth: 2,
                max_file_bytes: 8 * 1024,
                max_total_bytes: 32 * 1024,
            },
            &hark_core::CancelFlag::new(),
        )
        .unwrap();
    let ws_b = db
        .core
        .confirm_import(&ConfirmImport {
            root_id: other_root.id,
            scan_id: scan.id,
            mode: ImportMode::SingleProject,
            enable_model_initial_read: false,
        })
        .unwrap()
        .workspaces
        .into_iter()
        .next()
        .unwrap();
    let foreign = db
        .core
        .append_user_message(&ws_b.id, "另一个空间决定用 Bun")
        .unwrap();
    let local = db
        .core
        .append_user_message(&ws_a.id, "本空间先用 Tauri")
        .unwrap();
    let crossed = db.core.memory_propose_change(
        &ctx(&ws_a.id, "op-cross", Some(local.id.clone())),
        &MemoryChangeProposal {
            operation: MemoryOperation::Add,
            kind: MemoryNoteKind::Decision,
            content: "另一个空间决定用 Bun".to_string(),
            source_refs: vec![foreign.id.as_str().to_string()],
            target_id: None,
            expected_revision: None,
        },
    );
    assert_eq!(crossed.unwrap_err().code, ErrorCode::CrossWorkspaceRef);
    let missing = db.core.memory_propose_change(
        &ctx(&ws_a.id, "op-missing", Some(local.id)),
        &MemoryChangeProposal {
            operation: MemoryOperation::Add,
            kind: MemoryNoteKind::Identity,
            content: "不存在的来源".to_string(),
            source_refs: vec!["src_0123456789abcdef0123456789abcdef".to_string()],
            target_id: None,
            expected_revision: None,
        },
    );
    assert_eq!(missing.unwrap_err().code, ErrorCode::SourceRefNotFound);
    assert!(db
        .core
        .list_workspace_memories(&ws_a.id)
        .unwrap()
        .is_empty());
    cleanup(&root_a);
    cleanup(&root_b);
}

#[test]
fn clarification_does_not_record_a_false_decision() {
    let (db, root_path, ws) = ready("clarify", "stack: Tauri\n");
    let message = db
        .core
        .append_user_message(&ws.id, "先试 Bun，Node 保底")
        .unwrap();
    let receipt = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-bun", Some(message.id.clone())),
            &add_decision("已彻底切换 Bun"),
        )
        .unwrap();
    assert_eq!(receipt.outcome, OUTCOME_NEEDS_CLARIFICATION);
    assert!(!receipt.recorded);
    assert!(receipt.memory_id.is_none());
    assert!(receipt.retained_quote.unwrap().contains("先试 Bun"));
    assert!(db.core.list_workspace_memories(&ws.id).unwrap().is_empty());
    assert_eq!(
        db.core
            .list_conversation(&ws.id)
            .unwrap()
            .iter()
            .find(|event| event.id == message.id)
            .unwrap()
            .body,
        "先试 Bun，Node 保底"
    );

    let ask = db
        .core
        .append_user_message(&ws.id, "请记下 README")
        .unwrap();
    let file = db
        .core
        .read_workspace_file(&ws.id, "README.md", &ScanBudget::default())
        .unwrap();
    let endorsed = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-endorse", Some(ask.id.clone())),
            &MemoryChangeProposal {
                operation: MemoryOperation::Add,
                kind: MemoryNoteKind::Decision,
                content: "stack: Tauri".to_string(),
                source_refs: vec![file.source.id.as_str().to_string()],
                target_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert_eq!(endorsed.outcome, OUTCOME_NEEDS_CLARIFICATION);
    assert!(!endorsed.recorded);

    let identity = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-identity", Some(ask.id)),
            &MemoryChangeProposal {
                operation: MemoryOperation::Add,
                kind: MemoryNoteKind::Identity,
                content: "stack: Tauri".to_string(),
                source_refs: vec![file.source.id.as_str().to_string()],
                target_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert!(identity.recorded);
    assert_eq!(identity.kind.as_deref(), Some("identity"));
    let note = db
        .core
        .get_memory(&ws.id, identity.memory_id.as_ref().unwrap())
        .unwrap();
    assert!(note.status_label.contains("不是观察事实"));

    db.core
        .revoke_directory(&db.core.list_roots().unwrap()[0].id)
        .unwrap();
    let blocked = db.core.memory_propose_change(
        &ctx(&ws.id, "op-revoked-file", None),
        &MemoryChangeProposal {
            operation: MemoryOperation::Add,
            kind: MemoryNoteKind::Identity,
            content: "stack: Tauri".to_string(),
            source_refs: vec![file.source.id.as_str().to_string()],
            target_id: None,
            expected_revision: None,
        },
    );
    assert_eq!(blocked.unwrap_err().code, ErrorCode::RootRevoked);
    cleanup(&root_path);
}

#[test]
fn chinese_and_english_search_marks_history_and_uses_like_for_short_terms() {
    let (db, root_path, other_path, ws, other) = {
        let (db, root_path, ws) = ready("search", "synthetic\n");
        let other_path = project("search-other");
        fs::write(other_path.join("README.md"), "other\n").unwrap();
        let other_root = db.core.authorize_directory(&other_path).unwrap();
        let scan = db
            .core
            .run_initial_scan(
                &other_root.id,
                &ScanBudget {
                    max_entries: 20,
                    max_depth: 2,
                    max_file_bytes: 8 * 1024,
                    max_total_bytes: 32 * 1024,
                },
                &hark_core::CancelFlag::new(),
            )
            .unwrap();
        let other = db
            .core
            .confirm_import(&ConfirmImport {
                root_id: other_root.id,
                scan_id: scan.id,
                mode: ImportMode::SingleProject,
                enable_model_initial_read: false,
            })
            .unwrap()
            .workspaces
            .into_iter()
            .next()
            .unwrap();
        (db, root_path, other_path, ws, other)
    };
    let decision_message = db
        .core
        .append_user_message(&ws.id, "我们决定先用 Tauri 做桌面壳")
        .unwrap();
    let saved = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-search-save", Some(decision_message.id.clone())),
            &add_decision("先用 Tauri 做桌面壳"),
        )
        .unwrap();
    let revised_message = db
        .core
        .append_user_message(&ws.id, "改为先用 Tauri，Electron 不做了")
        .unwrap();
    db.core
        .memory_propose_change(
            &ctx(&ws.id, "op-search-revise", Some(revised_message.id)),
            &MemoryChangeProposal {
                operation: MemoryOperation::Revise,
                kind: MemoryNoteKind::Decision,
                content: "先用 Tauri，Electron 不做了".to_string(),
                source_refs: Vec::new(),
                target_id: saved.memory_id.clone(),
                expected_revision: saved.revision,
            },
        )
        .unwrap();
    db.core
        .append_user_message(&ws.id, "目录 权限 撤销都要可追溯")
        .unwrap();
    db.core
        .append_user_message(&ws.id, "Windows 打包 进程必须分开")
        .unwrap();
    let foreign = db
        .core
        .append_user_message(&other.id, "独特标记Alpha只属于另一个空间")
        .unwrap();
    db.core
        .memory_propose_change(
            &ctx(&other.id, "op-other", Some(foreign.id)),
            &add_decision("独特标记Alpha只属于另一个空间"),
        )
        .unwrap();

    let english = db
        .core
        .search_workspace_memory(&MemorySearchInput {
            workspace_id: ws.id.clone(),
            query: "Tauri".to_string(),
            kinds: Some(vec!["decision".to_string()]),
            cursor: None,
        })
        .unwrap();
    assert!(english.items.iter().any(|item| {
        !item.historical
            && item.status_label.contains("当前决定")
            && item.snippet.contains("Electron")
    }));
    assert!(english.items.iter().any(|item| {
        item.historical && item.status_label.contains("历史修订，不是当前决定")
    }));
    assert!(english.note.contains("不是 FTS5 bm25"));

    let cjk = db
        .core
        .search_workspace_memory(&MemorySearchInput {
            workspace_id: ws.id.clone(),
            query: "目录 权限 撤销".to_string(),
            kinds: None,
            cursor: None,
        })
        .unwrap();
    assert_eq!(cjk.match_mode, "like_fallback");
    assert_eq!(cjk.like_fallback_terms, vec!["目录", "权限", "撤销"]);
    assert!(cjk.fts_terms.is_empty());
    assert!(cjk.note.contains("不是 FTS 排序"));
    assert!(cjk
        .items
        .iter()
        .any(|item| item.kind == "conversation_milestone"));
    assert!(cjk.items.iter().all(|item| item.workspace_id == ws.id));

    let mixed = db
        .core
        .search_workspace_memory(&MemorySearchInput {
            workspace_id: ws.id.clone(),
            query: "Windows 打包 进程".to_string(),
            kinds: Some(vec!["conversation_milestone".to_string()]),
            cursor: None,
        })
        .unwrap();
    assert_eq!(mixed.match_mode, "mixed");
    assert!(mixed.fts_terms.iter().any(|term| term == "windows"));
    assert!(mixed.like_fallback_terms.iter().any(|term| term == "打包"));
    assert!(mixed
        .items
        .iter()
        .any(|item| item.snippet.contains("Windows 打包 进程")));
    assert!(!mixed.used_or_fallback);

    let isolated = db
        .core
        .search_workspace_memory(&MemorySearchInput {
            workspace_id: ws.id.clone(),
            query: "独特标记Alpha".to_string(),
            kinds: None,
            cursor: None,
        })
        .unwrap();
    assert!(isolated.items.is_empty());

    let empty = db
        .core
        .search_workspace_memory(&MemorySearchInput {
            workspace_id: ws.id.clone(),
            query: "   ".to_string(),
            kinds: None,
            cursor: None,
        })
        .unwrap();
    assert!(empty.items.is_empty());
    assert_eq!(empty.match_mode, "empty");
    let missing = db
        .core
        .search_workspace_memory(&MemorySearchInput {
            workspace_id: ws.id.clone(),
            query: "完全不存在的词项zzzz".to_string(),
            kinds: None,
            cursor: None,
        })
        .unwrap();
    assert!(missing.items.is_empty());
    cleanup(&root_path);
    cleanup(&other_path);
}

#[test]
fn v3_nonempty_chat_and_sources_upgrade_and_fts_follows_new_writes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("v3.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch(V1).unwrap();
    conn.execute_batch(V2).unwrap();
    conn.execute_batch(V3).unwrap();
    conn.execute_batch(
        "
        INSERT INTO schema_migrations (version, name, applied_at) VALUES
          (1, '0001_init', '2026-01-01T00:00:00Z'),
          (2, '0002_opening_run', '2026-01-01T00:00:01Z'),
          (3, '0003_conversation_run', '2026-01-01T00:00:02Z');
        INSERT INTO authorized_roots (id, path, dev, ino, status, created_at, updated_at)
          VALUES ('root_v3', '/tmp/synthetic-v3', '1', '2', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
        INSERT INTO workspaces (
          id, root_id, agent_id, conversation_id, relative_path, dev, ino, display_name, status, created_at
        ) VALUES (
          'ws_v3', 'root_v3', 'agt_v3', 'conv_v3', '', '1', '2', '合成', 'active', '2026-01-01T00:00:00Z'
        );
        INSERT INTO conversations (id, workspace_id, created_at)
          VALUES ('conv_v3', 'ws_v3', '2026-01-01T00:00:00Z');
        INSERT INTO source_refs (
          id, workspace_id, relative_path, content_sha256, byte_len, truncated, binary, excerpt, observed_at
        ) VALUES (
          'src_v3', 'ws_v3', 'README.md', 'abc', 12, 0, 0, '目录权限撤销说明', '2026-01-01T00:00:01Z'
        );
        INSERT INTO conversation_events (
          id, workspace_id, conversation_id, kind, generation, body, presentation,
          source_ids_json, receipt_id, created_at, seq
        ) VALUES (
          'msg_v3', 'ws_v3', 'conv_v3', 'user_message', NULL,
          '目录 权限 撤销都要可追溯。Windows 打包 进程必须分开。',
          'normal', '[]', NULL, '2026-01-01T00:00:02Z', 1
        );
        ",
    )
    .unwrap();
    drop(conn);

    let core = Core::open(&path).unwrap();
    assert_eq!(core.schema_version().unwrap(), 4);
    let ws = WorkspaceId::from_trusted("ws_v3".to_string());
    let events = core.list_conversation(&ws).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].body,
        "目录 权限 撤销都要可追溯。Windows 打包 进程必须分开。"
    );
    let sources = core.list_source_refs(&ws).unwrap();
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].excerpt.as_deref(), Some("目录权限撤销说明"));

    let cjk = core
        .search_workspace_memory(&MemorySearchInput {
            workspace_id: ws.clone(),
            query: "目录 权限 撤销".to_string(),
            kinds: None,
            cursor: None,
        })
        .unwrap();
    assert!(cjk
        .items
        .iter()
        .any(|item| item.kind == "conversation_milestone"));
    assert_eq!(cjk.match_mode, "like_fallback");
    let mixed = core
        .search_workspace_memory(&MemorySearchInput {
            workspace_id: ws.clone(),
            query: "Windows 打包 进程".to_string(),
            kinds: Some(vec!["conversation_milestone".to_string()]),
            cursor: None,
        })
        .unwrap();
    assert!(mixed
        .items
        .iter()
        .any(|item| item.snippet.contains("Windows 打包 进程")));
    assert_eq!(mixed.match_mode, "mixed");

    let added = core
        .append_user_message(&ws, "新写入的决定原文要能被检索")
        .unwrap();
    let synced = core
        .search_workspace_memory(&MemorySearchInput {
            workspace_id: ws.clone(),
            query: "新写入的决定原文".to_string(),
            kinds: None,
            cursor: None,
        })
        .unwrap();
    assert!(synced
        .items
        .iter()
        .any(|item| item.snippet.contains("新写入")));
    assert_eq!(
        core.list_conversation(&ws).unwrap()[0].body,
        "目录 权限 撤销都要可追溯。Windows 打包 进程必须分开。"
    );
    assert_eq!(added.body, "新写入的决定原文要能被检索");
}

#[test]
fn local_feedback_does_not_require_a_model_grant() {
    let (db, root_path, ws) = ready("no-model", "synthetic\n");
    let message = db
        .core
        .append_user_message(&ws.id, "记住这点：改配置前先看 README")
        .unwrap();
    let experience = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-exp", Some(message.id.clone())),
            &MemoryChangeProposal {
                operation: MemoryOperation::Add,
                kind: MemoryNoteKind::Experience,
                content: "改配置前先看 README".to_string(),
                source_refs: Vec::new(),
                target_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert_eq!(experience.outcome, OUTCOME_COMMITTED);
    let opinion = db
        .core
        .opinion_propose_change(
            &ctx(&ws.id, "op-local-opinion", Some(message.id.clone())),
            &OpinionChangeProposal {
                operation: MemoryOperation::Add,
                summary: "改配置前先看 README".to_string(),
                evidence_refs: vec![message.id.as_str().to_string()],
                counter_arguments: vec!["有时文件不在仓库里".to_string()],
                uncertainties: vec!["没有第二份证据".to_string()],
                target_opinion_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    let helpful = db
        .core
        .submit_opinion_feedback(&OpinionFeedbackInput {
            request_id: "fb-helpful".to_string(),
            workspace_id: ws.id.clone(),
            opinion_id: opinion.opinion_id.unwrap(),
            expected_revision: 1,
            action: OpinionFeedbackAction::Helpful,
            user_comment: Some("有帮助".to_string()),
            caller: MemoryCaller::User,
        })
        .unwrap();
    assert_eq!(helpful.user_feedback_note.as_deref(), Some("有帮助"));
    assert!(!helpful.judgment_generated);
    let rebut = db
        .core
        .submit_opinion_feedback(&OpinionFeedbackInput {
            request_id: "fb-rebut".to_string(),
            workspace_id: ws.id.clone(),
            opinion_id: helpful.id,
            expected_revision: helpful.revision,
            action: OpinionFeedbackAction::Rebut,
            user_comment: Some("这不是事实".to_string()),
            caller: MemoryCaller::User,
        })
        .unwrap();
    assert_eq!(rebut.status, "disputed");
    assert!(rebut
        .counter_arguments
        .iter()
        .any(|item| item.contains("这不是事实")));
    assert_eq!(
        db.core.list_workspace_memories(&ws.id).unwrap()[0].text,
        "改配置前先看 README"
    );
    let explicit_noop = db
        .core
        .memory_propose_change(
            &ctx(&ws.id, "op-noop", None),
            &MemoryChangeProposal {
                operation: MemoryOperation::Noop,
                kind: MemoryNoteKind::Decision,
                content: String::new(),
                source_refs: Vec::new(),
                target_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert_eq!(explicit_noop.outcome, OUTCOME_NOOP);
    assert!(!explicit_noop.recorded);
    cleanup(&root_path);
}

#[test]
fn decision_quote_keeps_qualifiers_and_rejects_stripped_affirmative() {
    let (db, root_path, ws) = ready("decision-support", "synthetic\n");
    let stripped = [
        ("negated", "我们决定不采用 Bun，继续使用 Node。", "采用 Bun"),
        ("question", "是否采用 Bun？先别决定。", "采用 Bun"),
        ("conditional", "如果测试通过，再采用 Bun。", "采用 Bun"),
    ];
    for (name, source, proposal) in stripped {
        let message = db.core.append_user_message(&ws.id, source).unwrap();
        let receipt = db
            .core
            .memory_propose_change(
                &ctx(
                    &ws.id,
                    &format!("op-strip-{name}"),
                    Some(message.id.clone()),
                ),
                &add_decision(proposal),
            )
            .unwrap();
        assert_eq!(receipt.outcome, OUTCOME_NEEDS_CLARIFICATION, "{name}");
        assert!(!receipt.recorded, "{name}");
        assert!(receipt.memory_id.is_none(), "{name}");
        assert_eq!(receipt.retained_quote.as_deref(), Some(source), "{name}");
        assert_eq!(
            db.core
                .list_conversation(&ws.id)
                .unwrap()
                .iter()
                .find(|event| event.id == message.id)
                .unwrap()
                .body,
            source,
            "{name}"
        );
    }
    assert!(db
        .core
        .list_workspace_memories(&ws.id)
        .unwrap()
        .iter()
        .all(|note| note.text != "采用 Bun"));

    let kept = [
        ("affirm", "我决定采用 Bun"),
        ("negation", "我决定不采用Bun，继续Node"),
        ("trial", "先试 Bun，Node 保底"),
    ];
    for (name, wording) in kept {
        let message = db.core.append_user_message(&ws.id, wording).unwrap();
        let receipt = db
            .core
            .memory_propose_change(
                &ctx(&ws.id, &format!("op-keep-{name}"), Some(message.id)),
                &add_decision(wording),
            )
            .unwrap();
        assert_eq!(receipt.outcome, OUTCOME_COMMITTED, "{name}");
        assert!(receipt.recorded, "{name}");
        assert_eq!(receipt.content.as_deref(), Some(wording), "{name}");
        let note = db
            .core
            .get_memory(&ws.id, receipt.memory_id.as_ref().unwrap())
            .unwrap();
        assert_eq!(note.text, wording, "{name}");
        assert_ne!(note.text, "采用 Bun", "{name}");
    }
    cleanup(&root_path);
}
