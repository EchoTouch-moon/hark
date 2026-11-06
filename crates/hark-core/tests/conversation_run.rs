#![cfg(unix)]

//! Ordinary conversation storage. Synthetic temp dirs only. No model, network, or private path.

use std::fs;
use std::path::{Path, PathBuf};

use hark_core::{
    AgentOpeningReceipt, CancelFlag, ConfirmImport, ConversationCommit, ConversationId,
    ConversationRunStart, Core, ErrorCode, ImportMode, MessageId, RootId, RunId, ScanBudget,
    ServiceGrantUpdate, ServiceKind, ServiceStatus, SourceId, Workspace, WorkspaceId,
};

const V1: &str = include_str!("../migrations/0001_init.sql");
const V2: &str = include_str!("../migrations/0002_opening_run.sql");
const SESSION: &str = "pi:01234567-89ab-cdef-0123-456789abcdef";

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

fn budget() -> ScanBudget {
    ScanBudget {
        max_entries: 50,
        max_depth: 3,
        max_file_bytes: 16 * 1024,
        max_total_bytes: 64 * 1024,
    }
}

fn project(name: &str) -> PathBuf {
    let root =
        std::env::temp_dir().join(format!("hark-conversation-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    root
}

fn cleanup(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

fn confirm_one(core: &Core, root: &RootId, scan: &hark_core::ScanId) -> Workspace {
    core.confirm_import(&ConfirmImport {
        root_id: root.clone(),
        scan_id: scan.clone(),
        mode: ImportMode::SingleProject,
        enable_model_initial_read: false,
    })
    .unwrap()
    .workspaces
    .into_iter()
    .next()
    .unwrap()
}

fn enable_model(core: &Core, workspace_id: &WorkspaceId, provider: &str, model: &str) {
    core.set_service_grant(&ServiceGrantUpdate {
        workspace_id: workspace_id.clone(),
        service: ServiceKind::Model,
        status: ServiceStatus::Enabled,
        provider: Some(provider.to_string()),
        model: Some(model.to_string()),
    })
    .unwrap();
}

fn set_model(
    core: &Core,
    workspace_id: &WorkspaceId,
    status: ServiceStatus,
    provider: &str,
    model: &str,
) {
    core.set_service_grant(&ServiceGrantUpdate {
        workspace_id: workspace_id.clone(),
        service: ServiceKind::Model,
        status,
        provider: Some(provider.to_string()),
        model: Some(model.to_string()),
    })
    .unwrap();
}

struct Ready {
    db: Db,
    root_id: RootId,
    root_path: PathBuf,
    ws: Workspace,
}

fn ready(name: &str) -> Ready {
    let db = Db::new();
    let root_path = project(name);
    fs::write(root_path.join("README.md"), "synthetic readme").unwrap();
    let root = db.core.authorize_directory(&root_path).unwrap();
    let scan = db
        .core
        .run_initial_scan(&root.id, &budget(), &CancelFlag::new())
        .unwrap();
    let ws = confirm_one(&db.core, &root.id, &scan.id);
    enable_model(&db.core, &ws.id, "stepfun", "expected-model");
    Ready {
        db,
        root_id: root.id,
        root_path,
        ws,
    }
}

fn start_stored(
    core: &Core,
    ws: &Workspace,
    request_id: &str,
    message_id: &MessageId,
) -> hark_core::StartedConversationRun {
    core.start_conversation_run(&ConversationRunStart {
        request_id: request_id.to_string(),
        workspace_id: ws.id.clone(),
        conversation_id: ws.conversation_id.clone(),
        user_message_id: Some(message_id.clone()),
        user_text: None,
    })
    .unwrap()
}

fn start_text(
    core: &Core,
    ws: &Workspace,
    request_id: &str,
    text: &str,
) -> hark_core::StartedConversationRun {
    core.start_conversation_run(&ConversationRunStart {
        request_id: request_id.to_string(),
        workspace_id: ws.id.clone(),
        conversation_id: ws.conversation_id.clone(),
        user_message_id: None,
        user_text: Some(text.to_string()),
    })
    .unwrap()
}

fn register(core: &Core, ws: &WorkspaceId, run_id: &RunId) {
    core.register_conversation_run(ws, run_id, Some(SESSION))
        .unwrap();
}

fn commit(
    core: &Core,
    ws: &WorkspaceId,
    run_id: &RunId,
    receipt_id: &str,
    body: &str,
    source_ids: Vec<SourceId>,
) -> hark_core::ConversationTurn {
    core.commit_conversation_message(&ConversationCommit {
        workspace_id: ws.clone(),
        run_id: run_id.clone(),
        receipt_id: receipt_id.to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: body.to_string(),
        source_ids,
    })
    .unwrap()
}

fn opening_count(core: &Core, ws: &WorkspaceId) -> usize {
    core.list_conversation(ws)
        .unwrap()
        .iter()
        .filter(|event| event.kind == "agent_opening_message")
        .count()
}

fn agent_count(core: &Core, ws: &WorkspaceId) -> usize {
    core.list_conversation(ws)
        .unwrap()
        .iter()
        .filter(|event| event.kind == "agent_message")
        .count()
}

#[test]
fn two_rounds_restore_in_order_after_reopen() {
    let mut fx = ready("two-rounds");
    let source_id = fx
        .db
        .core
        .read_workspace_file(&fx.ws.id, "README.md", &budget())
        .unwrap()
        .source
        .id;
    fx.db.core.commit_local_scan_card(&fx.ws.id).unwrap();
    let opening_run = fx
        .db
        .core
        .mark_analyzing(&fx.ws.id)
        .unwrap()
        .active_run_id
        .unwrap();
    fx.db
        .core
        .commit_agent_opening(&AgentOpeningReceipt {
            workspace_id: fx.ws.id.clone(),
            run_id: opening_run.clone(),
            receipt_id: "opening-once".to_string(),
            provider: "stepfun".to_string(),
            model: "expected-model".to_string(),
            success: true,
            body: "首次开场只此一条".to_string(),
            source_ids: vec![source_id],
        })
        .unwrap();
    let before = fx.db.core.onboarding(&fx.ws.id).unwrap();
    assert!(before.opening_presented);
    assert!(before.local_card_folded);
    assert!(fx
        .db
        .core
        .opening_session_binding(&fx.ws.id)
        .unwrap()
        .is_none());

    let first = start_text(&fx.db.core, &fx.ws, "req-round-1", "你好");
    assert!(!first.replayed);
    assert_eq!(first.run.state, "pending");
    assert_eq!(first.accepted_user_message.body, "你好");
    register(&fx.db.core, &fx.ws.id, &first.run.id);
    let turn1 = commit(
        &fx.db.core,
        &fx.ws.id,
        &first.run.id,
        "asst-1",
        "你好，我在。",
        vec![],
    );
    assert_eq!(turn1.assistant_message.kind, "agent_message");
    assert!(turn1.assistant_message.generation.is_none());
    assert!(turn1.assistant_message.source_ids.is_empty());

    let second_user = fx
        .db
        .core
        .append_user_message(&fx.ws.id, "今天只是寒暄")
        .unwrap();
    let second = start_stored(&fx.db.core, &fx.ws, "req-round-2", &second_user.id);
    register(&fx.db.core, &fx.ws.id, &second.run.id);
    commit(
        &fx.db.core,
        &fx.ws.id,
        &second.run.id,
        "asst-2",
        "好的，先不看文件。",
        vec![],
    );

    let after = fx.db.core.onboarding(&fx.ws.id).unwrap();
    assert_eq!(after.state, before.state);
    assert_eq!(after.model_analyzed, before.model_analyzed);
    assert_eq!(after.opening_presented, before.opening_presented);
    assert_eq!(after.local_card_folded, before.local_card_folded);
    assert_eq!(after.active_run_id, before.active_run_id);
    assert_eq!(opening_count(&fx.db.core, &fx.ws.id), 1);
    assert!(fx
        .db
        .core
        .opening_session_binding(&fx.ws.id)
        .unwrap()
        .is_none());
    let folded = fx
        .db
        .core
        .list_conversation(&fx.ws.id)
        .unwrap()
        .into_iter()
        .find(|event| event.kind == "local_scan_card")
        .unwrap();
    assert_eq!(folded.presentation, "folded_evidence");

    fx.db.reopen();
    let restored = fx.db.core.list_conversation(&fx.ws.id).unwrap();
    let bodies: Vec<_> = restored
        .iter()
        .map(|event| (event.kind.as_str(), event.body.as_str()))
        .collect();
    assert_eq!(
        bodies,
        vec![
            ("local_scan_card", folded.body.as_str()),
            ("agent_opening_message", "首次开场只此一条"),
            ("user_message", "你好"),
            ("agent_message", "你好，我在。"),
            ("user_message", "今天只是寒暄"),
            ("agent_message", "好的，先不看文件。"),
        ]
    );
    let again = fx
        .db
        .core
        .conversation_run_by_request(&fx.ws.id, "req-round-1")
        .unwrap()
        .unwrap();
    assert_eq!(again.run.id, first.run.id);
    assert_eq!(again.run.session_ref.as_deref(), Some(SESSION));
    assert_eq!(again.run.state, "committed");
    assert_eq!(again.accepted_user_message.body, "你好");
    cleanup(&fx.root_path);
}

#[test]
fn duplicate_start_and_commit_do_not_duplicate() {
    let fx = ready("duplicate");
    let stored = fx.db.core.append_user_message(&fx.ws.id, "同一句").unwrap();
    let first = start_stored(&fx.db.core, &fx.ws, "req-same", &stored.id);
    let second = start_stored(&fx.db.core, &fx.ws, "req-same", &stored.id);
    assert!(second.replayed);
    assert_eq!(second.run.id, first.run.id);
    assert_eq!(second.accepted_user_message.id, stored.id);
    let user_rows = fx
        .db
        .core
        .list_conversation(&fx.ws.id)
        .unwrap()
        .into_iter()
        .filter(|event| event.kind == "user_message")
        .count();
    assert_eq!(user_rows, 1);

    let text = start_text(&fx.db.core, &fx.ws, "req-text", "桥接这一句");
    let text_again = start_text(&fx.db.core, &fx.ws, "req-text", "桥接这一句");
    assert!(text_again.replayed);
    assert_eq!(text_again.run.id, text.run.id);
    assert_eq!(
        text_again.accepted_user_message.id,
        text.accepted_user_message.id
    );
    let changed = fx.db.core.start_conversation_run(&ConversationRunStart {
        request_id: "req-text".to_string(),
        workspace_id: fx.ws.id.clone(),
        conversation_id: fx.ws.conversation_id.clone(),
        user_message_id: None,
        user_text: Some("另一句".to_string()),
    });
    assert_eq!(changed.unwrap_err().code, ErrorCode::CorrelationRejected);
    assert_eq!(
        fx.db
            .core
            .list_conversation(&fx.ws.id)
            .unwrap()
            .iter()
            .filter(|event| event.body == "桥接这一句")
            .count(),
        1
    );

    register(&fx.db.core, &fx.ws.id, &first.run.id);
    let registered = fx
        .db
        .core
        .register_conversation_run(&fx.ws.id, &first.run.id, Some(SESSION))
        .unwrap();
    assert!(registered.replayed);
    assert_eq!(registered.state, "running");
    let pending = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: text.run.id.clone(),
        receipt_id: "too-soon".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "还没注册不能当完成".to_string(),
        source_ids: vec![],
    });
    assert_eq!(
        pending.unwrap_err().code,
        ErrorCode::ModelReceiptRejected,
        "unregistered run must not become an assistant message"
    );

    let turn = commit(
        &fx.db.core,
        &fx.ws.id,
        &first.run.id,
        "asst-same",
        "只记一次",
        vec![],
    );
    let replay = commit(
        &fx.db.core,
        &fx.ws.id,
        &first.run.id,
        "asst-same",
        "只记一次",
        vec![],
    );
    assert!(replay.replayed);
    assert_eq!(replay.assistant_message.id, turn.assistant_message.id);
    let conflict = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: first.run.id.clone(),
        receipt_id: "asst-other".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "另一条回复".to_string(),
        source_ids: vec![],
    });
    assert_eq!(conflict.unwrap_err().code, ErrorCode::ModelReceiptRejected);
    assert_eq!(agent_count(&fx.db.core, &fx.ws.id), 0 + 1);
    cleanup(&fx.root_path);
}

#[test]
fn cancel_and_fail_keep_user_text_without_assistant() {
    let mut fx = ready("cancel-fail");
    fx.db.core.commit_local_scan_card(&fx.ws.id).unwrap();
    let card_before = fx
        .db
        .core
        .list_conversation(&fx.ws.id)
        .unwrap()
        .into_iter()
        .find(|event| event.kind == "local_scan_card")
        .unwrap();
    assert_eq!(card_before.presentation, "expanded");

    let cancel_user = fx
        .db
        .core
        .append_user_message(&fx.ws.id, "取消也要留下这句")
        .unwrap();
    let cancel_run = start_stored(&fx.db.core, &fx.ws, "req-cancel", &cancel_user.id);
    register(&fx.db.core, &fx.ws.id, &cancel_run.run.id);
    let cancelled = fx
        .db
        .core
        .cancel_conversation_run(&fx.ws.id, &cancel_run.run.id)
        .unwrap();
    assert_eq!(cancelled.state, "cancelled");
    let late = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: cancel_run.run.id.clone(),
        receipt_id: "late".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "不该出现的助手".to_string(),
        source_ids: vec![],
    });
    assert_eq!(late.unwrap_err().code, ErrorCode::Cancelled);

    let fail_user = fx
        .db
        .core
        .append_user_message(&fx.ws.id, "失败也要留下这句")
        .unwrap();
    let fail_run = start_stored(&fx.db.core, &fx.ws, "req-fail", &fail_user.id);
    register(&fx.db.core, &fx.ws.id, &fail_run.run.id);
    let failed = fx
        .db
        .core
        .fail_conversation_run(&fx.ws.id, &fail_run.run.id, "transport_closed")
        .unwrap();
    assert_eq!(failed.state, "failed");
    assert_eq!(failed.error_code.as_deref(), Some("transport_closed"));
    let failed_commit = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: fail_run.run.id,
        receipt_id: "fail-late".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "失败不能变成回复".to_string(),
        source_ids: vec![],
    });
    assert_eq!(
        failed_commit.unwrap_err().code,
        ErrorCode::ModelReceiptRejected
    );

    fx.db.reopen();
    let events = fx.db.core.list_conversation(&fx.ws.id).unwrap();
    assert!(events.iter().all(|event| event.kind != "agent_message"));
    assert_eq!(opening_count(&fx.db.core, &fx.ws.id), 0);
    assert_eq!(
        events
            .iter()
            .find(|event| event.kind == "local_scan_card")
            .unwrap()
            .presentation,
        "expanded"
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == "user_message")
            .map(|event| event.body.as_str())
            .collect::<Vec<_>>(),
        vec!["取消也要留下这句", "失败也要留下这句"]
    );
    cleanup(&fx.root_path);
}

#[test]
fn service_directory_and_cross_workspace_constraints_are_reused() {
    let fx = ready("constraints");
    fx.db
        .core
        .set_service_grant(&ServiceGrantUpdate {
            workspace_id: fx.ws.id.clone(),
            service: ServiceKind::Model,
            status: ServiceStatus::Disabled,
            provider: None,
            model: None,
        })
        .unwrap();
    let kept = fx
        .db
        .core
        .append_user_message(&fx.ws.id, "未启用也保留")
        .unwrap();
    let blocked = fx.db.core.start_conversation_run(&ConversationRunStart {
        request_id: "req-disabled".to_string(),
        workspace_id: fx.ws.id.clone(),
        conversation_id: fx.ws.conversation_id.clone(),
        user_message_id: Some(kept.id.clone()),
        user_text: None,
    });
    assert_eq!(blocked.unwrap_err().code, ErrorCode::ModelNotAuthorized);
    assert!(fx
        .db
        .core
        .conversation_run_by_request(&fx.ws.id, "req-disabled")
        .unwrap()
        .is_none());

    enable_model(&fx.db.core, &fx.ws.id, "stepfun", "expected-model");
    let paused_user = fx
        .db
        .core
        .append_user_message(&fx.ws.id, "暂停前的原文")
        .unwrap();
    let paused_run = start_stored(&fx.db.core, &fx.ws, "req-pause", &paused_user.id);
    register(&fx.db.core, &fx.ws.id, &paused_run.run.id);
    set_model(
        &fx.db.core,
        &fx.ws.id,
        ServiceStatus::Paused,
        "stepfun",
        "expected-model",
    );
    let paused = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: paused_run.run.id.clone(),
        receipt_id: "paused".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "暂停后不能提交".to_string(),
        source_ids: vec![],
    });
    assert_eq!(paused.unwrap_err().code, ErrorCode::ModelNotAuthorized);
    set_model(
        &fx.db.core,
        &fx.ws.id,
        ServiceStatus::Revoked,
        "stepfun",
        "expected-model",
    );
    let revoked_grant = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: paused_run.run.id.clone(),
        receipt_id: "revoked-grant".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "撤销后不能提交".to_string(),
        source_ids: vec![],
    });
    assert_eq!(
        revoked_grant.unwrap_err().code,
        ErrorCode::ModelNotAuthorized
    );
    enable_model(&fx.db.core, &fx.ws.id, "stepfun", "expected-model");
    let stale = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: paused_run.run.id.clone(),
        receipt_id: "stale".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "旧 run 不能提交".to_string(),
        source_ids: vec![],
    });
    assert_eq!(stale.unwrap_err().code, ErrorCode::RunMismatch);
    let wrong_model = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: paused_run.run.id.clone(),
        receipt_id: "wrong-model".to_string(),
        provider: "stepfun".to_string(),
        model: "other-model".to_string(),
        body: "错模型不能提交".to_string(),
        source_ids: vec![],
    });
    assert_eq!(wrong_model.unwrap_err().code, ErrorCode::ModelMismatch);
    assert_eq!(agent_count(&fx.db.core, &fx.ws.id), 0);

    let other_path = project("constraints-b");
    fs::write(other_path.join("README.md"), "other workspace").unwrap();
    let other_root = fx.db.core.authorize_directory(&other_path).unwrap();
    let other_scan = fx
        .db
        .core
        .run_initial_scan(&other_root.id, &budget(), &CancelFlag::new())
        .unwrap();
    let other = confirm_one(&fx.db.core, &other_root.id, &other_scan.id);
    enable_model(&fx.db.core, &other.id, "stepfun", "expected-model");
    let other_source = fx
        .db
        .core
        .read_workspace_file(&other.id, "README.md", &budget())
        .unwrap()
        .source
        .id;
    let other_user = fx
        .db
        .core
        .append_user_message(&other.id, "另一个空间")
        .unwrap();
    let cross_message = fx.db.core.start_conversation_run(&ConversationRunStart {
        request_id: "req-cross-msg".to_string(),
        workspace_id: fx.ws.id.clone(),
        conversation_id: fx.ws.conversation_id.clone(),
        user_message_id: Some(other_user.id.clone()),
        user_text: None,
    });
    assert_eq!(
        cross_message.unwrap_err().code,
        ErrorCode::CrossWorkspaceRef
    );
    let cross_request = fx.db.core.start_conversation_run(&ConversationRunStart {
        request_id: "req-pause".to_string(),
        workspace_id: other.id.clone(),
        conversation_id: other.conversation_id.clone(),
        user_message_id: Some(other_user.id),
        user_text: None,
    });
    assert_eq!(
        cross_request.unwrap_err().code,
        ErrorCode::CrossWorkspaceRef
    );

    let live_user = fx
        .db
        .core
        .append_user_message(&fx.ws.id, "目录约束原文")
        .unwrap();
    let live = start_stored(&fx.db.core, &fx.ws, "req-live", &live_user.id);
    register(&fx.db.core, &fx.ws.id, &live.run.id);
    let forged = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: live.run.id.clone(),
        receipt_id: "forged".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "不能伪造文件".to_string(),
        source_ids: vec![SourceId::from_trusted(
            "src_ffffffffffffffffffffffffffffffff".to_string(),
        )],
    });
    assert_eq!(forged.unwrap_err().code, ErrorCode::SourceRefNotFound);
    let cross_source = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: live.run.id.clone(),
        receipt_id: "cross-src".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "不能引用别的空间".to_string(),
        source_ids: vec![other_source],
    });
    assert_eq!(cross_source.unwrap_err().code, ErrorCode::CrossWorkspaceRef);
    let cross_run = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: other.id.clone(),
        run_id: live.run.id.clone(),
        receipt_id: "cross-run".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "不能跨空间提交".to_string(),
        source_ids: vec![],
    });
    assert_eq!(cross_run.unwrap_err().code, ErrorCode::CrossWorkspaceRef);
    assert_eq!(agent_count(&fx.db.core, &fx.ws.id), 0);

    fx.db.core.pause_directory(&fx.root_id).unwrap();
    let dir_paused = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: live.run.id.clone(),
        receipt_id: "dir-paused".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "目录暂停不能提交".to_string(),
        source_ids: vec![],
    });
    assert_eq!(dir_paused.unwrap_err().code, ErrorCode::RootPaused);
    fx.db.core.resume_directory(&fx.root_id).unwrap();
    let resumed = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: live.run.id.clone(),
        receipt_id: "resumed".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "恢复不复活旧 run".to_string(),
        source_ids: vec![],
    });
    assert_eq!(resumed.unwrap_err().code, ErrorCode::RunMismatch);
    let fresh_user = fx
        .db
        .core
        .append_user_message(&fx.ws.id, "恢复后的新句")
        .unwrap();
    let fresh = start_stored(&fx.db.core, &fx.ws, "req-after-resume", &fresh_user.id);
    register(&fx.db.core, &fx.ws.id, &fresh.run.id);
    fx.db.core.revoke_directory(&fx.root_id).unwrap();
    let dir_revoked = fx.db.core.commit_conversation_message(&ConversationCommit {
        workspace_id: fx.ws.id.clone(),
        run_id: fresh.run.id,
        receipt_id: "dir-revoked".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "目录撤销不能提交".to_string(),
        source_ids: vec![],
    });
    assert_eq!(dir_revoked.unwrap_err().code, ErrorCode::RootRevoked);
    assert_eq!(agent_count(&fx.db.core, &fx.ws.id), 0);
    assert!(fx
        .db
        .core
        .list_conversation(&fx.ws.id)
        .unwrap()
        .iter()
        .any(|event| event.body == "目录约束原文"));
    cleanup(&fx.root_path);
    cleanup(&other_path);
}

#[test]
fn v2_nonempty_database_upgrades_without_loss() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("v2.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch(V1).unwrap();
    conn.execute_batch(V2).unwrap();
    conn.execute_batch(
        "
        INSERT INTO schema_migrations (version, name, applied_at) VALUES
          (1, '0001_init', '2026-01-01T00:00:00Z'),
          (2, '0002_opening_run', '2026-01-01T00:00:01Z');
        INSERT INTO authorized_roots (id, path, dev, ino, status, created_at, updated_at)
          VALUES ('root_cccccccccccccccccccccccccccccccc', '/tmp/synthetic-v2', '1', '2', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
        INSERT INTO scan_sessions (
          id, root_id, status, coverage, budget_json, limits_hit_json, ignored_json,
          files_seen, dirs_seen, created_at, finished_at
        ) VALUES (
          'scan_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'root_cccccccccccccccccccccccccccccccc',
          'completed', 'partial', '{}', '[]', '[]', 1, 1,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z'
        );
        INSERT INTO workspaces (
          id, root_id, agent_id, conversation_id, relative_path, dev, ino, display_name, status, created_at
        ) VALUES (
          'ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'root_cccccccccccccccccccccccccccccccc',
          'agt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'conv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          '', '1', '2', '合成', 'active', '2026-01-01T00:00:00Z'
        );
        INSERT INTO conversations (id, workspace_id, created_at)
          VALUES ('conv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-01-01T00:00:00Z');
        INSERT INTO service_grants (id, workspace_id, service, status, provider, model, updated_at)
          VALUES ('grant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'model', 'enabled', 'stepfun', 'expected-model', '2026-01-01T00:00:02Z');
        INSERT INTO onboarding_runs (
          id, workspace_id, generation, state, scan_id, structure_scanned, selective_read_done,
          model_analyzed, opening_presented, local_card_folded, model_status, error_code,
          evidence_json, created_at, updated_at, active_run_id, auth_provider, auth_model,
          auth_grant_updated_at, auth_root_updated_at, initial_read_requested
        ) VALUES (
          'onb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1,
          'presented', 'scan_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 1, 1, 1, 1, 0,
          'receipt_accepted', NULL, '{\"scanId\":\"scan_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\"}',
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:03Z',
          'run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'stepfun', 'expected-model',
          '2026-01-01T00:00:02Z', '2026-01-01T00:00:00Z', 0
        );
        INSERT INTO source_refs (
          id, workspace_id, relative_path, content_sha256, byte_len, truncated, binary, excerpt, observed_at
        ) VALUES (
          'src_dddddddddddddddddddddddddddddddd', 'ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'README.md', 'abc', 4, 0, 0, 'note', '2026-01-01T00:00:01Z'
        );
        INSERT INTO conversation_events (
          id, workspace_id, conversation_id, kind, generation, body, presentation, source_ids_json, receipt_id, created_at
        ) VALUES
          ('msg_11111111111111111111111111111111', 'ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'conv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'local_scan_card', 1, '本地扫描卡片原文', 'expanded', '[\"src_dddddddddddddddddddddddddddddddd\"]', NULL, '2026-01-01T00:00:04Z'),
          ('msg_22222222222222222222222222222222', 'ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'conv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'agent_opening_message', 1, '首次开场原文', 'normal', '[\"src_dddddddddddddddddddddddddddddddd\"]', 'opening-v2', '2026-01-01T00:00:05Z'),
          ('msg_33333333333333333333333333333333', 'ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'conv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'user_message', NULL, '已有用户原文', 'normal', '[]', NULL, '2026-01-01T00:00:06Z');
        ",
    )
    .unwrap();
    drop(conn);

    let core = Core::open(&path).unwrap();
    assert_eq!(core.schema_version().unwrap(), 4);
    let ws = WorkspaceId::from_trusted("ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string());
    let conv = ConversationId::from_trusted("conv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string());
    let events = core.list_conversation(&ws).unwrap();
    assert_eq!(
        events
            .iter()
            .map(|event| (
                event.kind.as_str(),
                event.body.as_str(),
                event.presentation.as_str()
            ))
            .collect::<Vec<_>>(),
        vec![
            ("local_scan_card", "本地扫描卡片原文", "expanded"),
            ("agent_opening_message", "首次开场原文", "normal"),
            ("user_message", "已有用户原文", "normal"),
        ]
    );
    assert_eq!(
        events[0].source_ids[0].as_str(),
        "src_dddddddddddddddddddddddddddddddd"
    );
    let checkpoint = core.onboarding(&ws).unwrap();
    assert_eq!(checkpoint.state, "presented");
    assert!(checkpoint.opening_presented);
    assert!(!checkpoint.local_card_folded);
    assert_eq!(
        checkpoint.active_run_id.unwrap().as_str(),
        "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );

    let check = rusqlite::Connection::open(&path).unwrap();
    let seqs: Vec<i64> = {
        let mut stmt = check
            .prepare("SELECT seq FROM conversation_events WHERE workspace_id = ?1 ORDER BY seq")
            .unwrap();
        let rows = stmt
            .query_map(["ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], |row| row.get(0))
            .unwrap();
        rows.map(|row| row.unwrap()).collect()
    };
    assert_eq!(seqs, vec![1, 2, 3]);
    let index_sql: String = check
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name = 'conversation_first_message_idem'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(index_sql.contains("local_scan_card"));
    assert!(index_sql.contains("agent_opening_message"));
    let duplicate = check.execute(
        "INSERT INTO conversation_events (
            id, workspace_id, conversation_id, kind, generation, body, presentation, source_ids_json, receipt_id, created_at, seq
         ) VALUES ('msg_99999999999999999999999999999999', 'ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'conv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'agent_opening_message', 1, '第二条开场', 'normal', '[]', NULL, '2026-01-02T00:00:00Z', 99)",
        [],
    );
    assert!(duplicate.is_err(), "first-message index must survive v3");
    drop(check);

    let user_id = MessageId::from_trusted("msg_33333333333333333333333333333333".to_string());
    let started = core
        .start_conversation_run(&ConversationRunStart {
            request_id: "req-upgraded".to_string(),
            workspace_id: ws.clone(),
            conversation_id: conv,
            user_message_id: Some(user_id),
            user_text: Some("已有用户原文".to_string()),
        })
        .unwrap();
    core.register_conversation_run(&ws, &started.run.id, None)
        .unwrap();
    core.commit_conversation_message(&ConversationCommit {
        workspace_id: ws.clone(),
        run_id: started.run.id,
        receipt_id: "upgraded-greeting".to_string(),
        provider: "stepfun".to_string(),
        model: "expected-model".to_string(),
        body: "升级后的寒暄".to_string(),
        source_ids: vec![],
    })
    .unwrap();
    let after = core.list_conversation(&ws).unwrap();
    assert_eq!(after.len(), 4);
    assert_eq!(after[2].body, "已有用户原文");
    assert_eq!(after[3].kind, "agent_message");
    assert_eq!(after[3].body, "升级后的寒暄");
    assert_eq!(
        after
            .iter()
            .filter(|event| event.kind == "agent_opening_message")
            .count(),
        1
    );
    assert_eq!(
        after
            .iter()
            .find(|event| event.kind == "local_scan_card")
            .unwrap()
            .presentation,
        "expanded"
    );
    let still = core.onboarding(&ws).unwrap();
    assert_eq!(still.state, "presented");
    assert!(!still.local_card_folded);
    assert_eq!(
        still.active_run_id.unwrap().as_str(),
        "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
}

#[test]
fn latest_ordinary_session_is_not_the_opening_binding() {
    let fx = ready("session-hint");
    assert!(fx
        .db
        .core
        .latest_ordinary_session(&fx.ws.id)
        .unwrap()
        .is_none());
    let started = start_text(&fx.db.core, &fx.ws, "req-session", "你好");
    assert!(fx
        .db
        .core
        .latest_ordinary_session(&fx.ws.id)
        .unwrap()
        .is_none());
    register(&fx.db.core, &fx.ws.id, &started.run.id);
    let hint = fx
        .db
        .core
        .latest_ordinary_session(&fx.ws.id)
        .unwrap()
        .unwrap();
    assert_eq!(hint.session_ref, SESSION);
    assert_eq!(hint.run_id.as_str(), started.run.id.as_str());
    assert!(fx
        .db
        .core
        .opening_session_binding(&fx.ws.id)
        .unwrap()
        .is_none());
    cleanup(&fx.root_path);
}
