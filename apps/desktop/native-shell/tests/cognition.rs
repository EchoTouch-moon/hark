//! Native cognition APIs use real SQLite and synthetic files, never a model.
use hark_core::{
    Core, MemoryCallContext, MemoryCaller, MemoryChangeProposal, MemoryNoteKind, MemoryOperation,
    MemorySearchInput, OpinionChangeProposal, OpinionFeedbackAction,
};
use hark_native_shell::{
    business_db_path, ConfirmRequest, MessageEvidenceRequest, NativeShell, OpinionFeedbackRequest,
    OpinionRequest, RevertMemoryRequest, Selection,
};

fn import(shell: &NativeShell, path: &std::path::Path) -> hark_core::Workspace {
    std::fs::create_dir_all(path).unwrap();
    std::fs::write(path.join("README.md"), "synthetic Tauri project\n").unwrap();
    let ticket = shell.stage_native_pick(path).unwrap();
    let root = shell.authorize_picked(&ticket.pick_token).unwrap();
    let scan = shell.scan_root(root.id.as_str()).unwrap();
    shell
        .confirm_import(&ConfirmRequest {
            root_id: root.id.to_string(),
            scan_id: scan.id.to_string(),
            selection: Selection::Single,
        })
        .unwrap()
        .workspaces
        .remove(0)
}

#[test]
fn cognition_search_feedback_undo_and_restart_use_real_records() {
    let dir = tempfile::tempdir().unwrap();
    let db = business_db_path(dir.path());
    let shell = NativeShell::open(&db).unwrap();
    let ws = import(&shell, &dir.path().join("project"));
    let other = import(&shell, &dir.path().join("other"));
    let core = Core::open(&db).unwrap();
    let text = "我决定先用 Tauri，Node 保底";
    let message = core.append_user_message(&ws.id, text).unwrap();
    let context = |operation: &str| MemoryCallContext {
        workspace_id: ws.id.clone(),
        operation_id: operation.into(),
        current_user_message_id: Some(message.id.clone()),
        caller: MemoryCaller::User,
    };
    let saved = core
        .memory_propose_change(
            &context("save-decision"),
            &MemoryChangeProposal {
                operation: MemoryOperation::Add,
                kind: MemoryNoteKind::Decision,
                content: text.into(),
                source_refs: vec![],
                target_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert!(saved.recorded);
    let opinion = core
        .opinion_propose_change(
            &context("save-opinion"),
            &OpinionChangeProposal {
                operation: MemoryOperation::Add,
                summary: text.into(),
                evidence_refs: vec![message.id.to_string()],
                counter_arguments: vec![],
                uncertainties: vec!["尚未比较运行时表现".into()],
                target_opinion_id: None,
                expected_revision: None,
            },
        )
        .unwrap()
        .view
        .unwrap();
    assert_eq!(
        shell.list_workspace_opinions(ws.id.as_str()).unwrap().len(),
        1
    );
    let request = OpinionRequest {
        workspace_id: ws.id.to_string(),
        opinion_id: opinion.id.clone(),
    };
    assert_eq!(shell.get_opinion(&request).unwrap().summary, text);
    assert!(shell
        .get_opinion(&OpinionRequest {
            workspace_id: other.id.to_string(),
            ..request.clone()
        })
        .is_err());
    let evidence = MessageEvidenceRequest {
        workspace_id: ws.id.to_string(),
        message_id: message.id.to_string(),
    };
    assert_eq!(shell.get_message_evidence(&evidence).unwrap().body, text);
    assert!(shell
        .get_message_evidence(&MessageEvidenceRequest {
            workspace_id: other.id.to_string(),
            ..evidence
        })
        .is_err());

    let feedback = OpinionFeedbackRequest {
        request_id: "feedback-request".into(),
        workspace_id: ws.id.to_string(),
        opinion_id: opinion.id.clone(),
        expected_revision: opinion.revision,
        action: OpinionFeedbackAction::Revise,
        user_comment: Some("请比较 Node 与 Bun".into()),
    };
    let updated = shell.submit_opinion_feedback(&feedback).unwrap();
    assert_eq!(updated.status, "pending_revision");
    assert_eq!(updated.summary, text);
    assert!(!updated.judgment_generated);
    assert_eq!(
        shell.submit_opinion_feedback(&feedback).unwrap().revision,
        updated.revision
    );
    assert!(shell
        .submit_opinion_feedback(&OpinionFeedbackRequest {
            request_id: "stale-feedback".into(),
            ..feedback
        })
        .is_err());

    let query = MemorySearchInput {
        workspace_id: ws.id.clone(),
        query: "保底".into(),
        kinds: None,
        cursor: None,
    };
    let found = shell.search_workspace_memory(&query).unwrap();
    assert!(!found.items.is_empty());
    assert_eq!(found.match_mode, "like_fallback");
    assert!(found.items.iter().all(|item| item.workspace_id == ws.id));
    let empty = shell
        .search_workspace_memory(&MemorySearchInput {
            workspace_id: other.id.clone(),
            ..query.clone()
        })
        .unwrap();
    assert!(empty.items.is_empty());
    let undo = RevertMemoryRequest {
        workspace_id: ws.id.to_string(),
        operation_id: saved.operation_id,
    };
    assert!(shell.revert_memory_operation(&undo).unwrap().reverted);
    let replayed = shell.revert_memory_operation(&undo).unwrap();
    assert!(replayed.replayed && replayed.committed_at.is_some());
    let receipts = shell.list_memory_receipts(ws.id.as_str()).unwrap();
    assert_eq!(receipts.len(), 1);
    assert!(receipts[0].reverted && receipts[0].committed_at.is_some());
    drop(core);
    drop(shell);
    let reopened = NativeShell::open(&db).unwrap();
    assert_eq!(
        reopened.get_opinion(&request).unwrap().status,
        "pending_revision"
    );
    assert!(reopened
        .search_workspace_memory(&query)
        .unwrap()
        .items
        .iter()
        .any(|item| item.kind == "conversation_milestone"));
    assert_eq!(reopened.list_conversation(ws.id.as_str()).unwrap().len(), 1);
}

#[test]
fn frontend_feedback_cannot_supply_caller_or_receipt_fields() {
    for field in ["caller", "success", "recorded"] {
        let mut input = serde_json::json!({
            "requestId":"req", "workspaceId":"ws", "opinionId":"op", "expectedRevision":1,
            "action":"helpful", "userComment":null
        });
        input[field] = serde_json::json!(true);
        assert!(serde_json::from_value::<OpinionFeedbackRequest>(input).is_err());
    }
}
