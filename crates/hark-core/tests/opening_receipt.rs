#![cfg(unix)]

//! Synthetic-disk regressions for review #3. No real provider, private directory, or model call.

use std::fs;
use std::path::{Path, PathBuf};

use hark_core::{
    AgentOpeningReceipt, CancelFlag, ConfirmImport, Core, ErrorCode, ImportMode, RootId, RunId,
    ScanBudget, ServiceGrantUpdate, ServiceKind, ServiceStatus, SourceId, Workspace, WorkspaceId,
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

fn budget() -> ScanBudget {
    ScanBudget {
        max_entries: 50,
        max_depth: 3,
        max_file_bytes: 16 * 1024,
        max_total_bytes: 64 * 1024,
    }
}

fn project(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("hark-opening-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    root
}

fn cleanup(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

fn confirm_one(
    core: &Core,
    root: &RootId,
    scan: &hark_core::ScanId,
    initial_read: bool,
) -> Workspace {
    core.confirm_import(&ConfirmImport {
        root_id: root.clone(),
        scan_id: scan.clone(),
        mode: ImportMode::SingleProject,
        enable_model_initial_read: initial_read,
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

fn issue_run(core: &Core, workspace_id: &WorkspaceId) -> RunId {
    core.mark_analyzing(workspace_id)
        .unwrap()
        .active_run_id
        .expect("core issued run")
}

fn receipt(
    workspace_id: &WorkspaceId,
    run_id: &RunId,
    provider: &str,
    model: &str,
    success: bool,
    body: &str,
    source_ids: Vec<SourceId>,
) -> AgentOpeningReceipt {
    AgentOpeningReceipt {
        workspace_id: workspace_id.clone(),
        run_id: run_id.clone(),
        receipt_id: format!("rcpt-{provider}-{model}-{success}"),
        provider: provider.to_string(),
        model: model.to_string(),
        success,
        body: body.to_string(),
        source_ids,
    }
}

fn assert_not_presented(core: &Core, workspace_id: &WorkspaceId) {
    let checkpoint = core.onboarding(workspace_id).unwrap();
    assert!(!checkpoint.opening_presented, "{checkpoint:?}");
    assert!(!checkpoint.model_analyzed, "{checkpoint:?}");
    assert!(core
        .list_conversation(workspace_id)
        .unwrap()
        .iter()
        .all(|event| event.kind != "agent_opening_message"));
    if let Some(card) = core
        .list_conversation(workspace_id)
        .unwrap()
        .into_iter()
        .find(|event| event.kind == "local_scan_card")
    {
        assert_eq!(card.presentation, "expanded");
    }
}

struct Ready {
    db: Db,
    root_id: RootId,
    root_path: PathBuf,
    ws: Workspace,
    source_id: SourceId,
    run_id: RunId,
}

fn ready(name: &str) -> Ready {
    let db = Db::new();
    let root_path = project(name);
    fs::write(root_path.join("README.md"), "synthetic readme for opening").unwrap();
    let root = db.core.authorize_directory(&root_path).unwrap();
    let scan = db
        .core
        .run_initial_scan(&root.id, &budget(), &CancelFlag::new())
        .unwrap();
    let ws = confirm_one(&db.core, &root.id, &scan.id, false);
    let source_id = db
        .core
        .read_workspace_file(&ws.id, "README.md", &budget())
        .unwrap()
        .source
        .id;
    db.core.commit_local_scan_card(&ws.id).unwrap();
    enable_model(&db.core, &ws.id, "stepfun", "expected-model");
    let run_id = issue_run(&db.core, &ws.id);
    Ready {
        db,
        root_id: root.id,
        root_path,
        ws,
        source_id,
        run_id,
    }
}

#[test]
fn cancelled_late_receipt_is_not_presented() {
    let db = Db::new();
    let root_path = project("cancel-late");
    fs::write(root_path.join("README.md"), "synthetic project notes").unwrap();
    let root = db.core.authorize_directory(&root_path).unwrap();
    let scan = db
        .core
        .run_initial_scan(&root.id, &budget(), &CancelFlag::new())
        .unwrap();
    let ws = confirm_one(&db.core, &root.id, &scan.id, false);
    enable_model(&db.core, &ws.id, "stepfun", "expected-model");
    db.core.cancel_onboarding(&ws.id).unwrap();

    let late = db
        .core
        .commit_agent_opening(&receipt(
            &ws.id,
            &RunId::new(),
            "stepfun",
            "different-model",
            true,
            "claimed analysis without a trusted run",
            vec![],
        ))
        .unwrap_err();
    assert_eq!(late.code, ErrorCode::Cancelled, "{late}");
    assert_not_presented(&db.core, &ws.id);

    let mut issued = ready("cancel-issued");
    let bound = issued.run_id.clone();
    issued.db.core.cancel_onboarding(&issued.ws.id).unwrap();
    let again = issued
        .db
        .core
        .commit_agent_opening(&receipt(
            &issued.ws.id,
            &bound,
            "stepfun",
            "different-model",
            true,
            "late result after cancel",
            vec![],
        ))
        .unwrap_err();
    assert_eq!(again.code, ErrorCode::Cancelled, "{again}");
    assert_not_presented(&issued.db.core, &issued.ws.id);
    issued
        .db
        .core
        .selective_key_read(&issued.ws.id, &budget(), &CancelFlag::new())
        .unwrap();
    assert_eq!(
        issued.db.core.onboarding(&issued.ws.id).unwrap().state,
        "cancelled"
    );
    issued.db.reopen();
    let after_restart = issued
        .db
        .core
        .commit_agent_opening(&receipt(
            &issued.ws.id,
            &bound,
            "stepfun",
            "expected-model",
            true,
            "restart must not revive a cancelled run",
            vec![issued.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(after_restart.code, ErrorCode::Cancelled, "{after_restart}");
    assert_not_presented(&issued.db.core, &issued.ws.id);
    cleanup(&root_path);
    cleanup(&issued.root_path);
}

#[test]
fn wrong_provider_model_fake_run_and_cross_source_are_rejected() {
    let fx = ready("mismatch");
    let wrong_model = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &fx.run_id,
            "stepfun",
            "different-model",
            true,
            "wrong model",
            vec![fx.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(wrong_model.code, ErrorCode::ModelMismatch, "{wrong_model}");
    let wrong_provider = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &fx.run_id,
            "other-provider",
            "expected-model",
            true,
            "wrong provider",
            vec![fx.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(
        wrong_provider.code,
        ErrorCode::ProviderMismatch,
        "{wrong_provider}"
    );
    let fake = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &RunId::new(),
            "stepfun",
            "expected-model",
            true,
            "forged run",
            vec![fx.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(fake.code, ErrorCode::RunMismatch, "{fake}");
    assert_not_presented(&fx.db.core, &fx.ws.id);

    let other_path = project("mismatch-other");
    fs::write(other_path.join("README.md"), "other workspace notes").unwrap();
    let other_root = fx.db.core.authorize_directory(&other_path).unwrap();
    let other_scan = fx
        .db
        .core
        .run_initial_scan(&other_root.id, &budget(), &CancelFlag::new())
        .unwrap();
    let other = confirm_one(&fx.db.core, &other_root.id, &other_scan.id, false);
    let other_source = fx
        .db
        .core
        .read_workspace_file(&other.id, "README.md", &budget())
        .unwrap()
        .source
        .id;
    enable_model(&fx.db.core, &other.id, "stepfun", "expected-model");
    let other_run = issue_run(&fx.db.core, &other.id);
    let cross_run = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &other_run,
            "stepfun",
            "expected-model",
            true,
            "other workspace run",
            vec![fx.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(cross_run.code, ErrorCode::RunMismatch, "{cross_run}");
    let cross_source = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &fx.run_id,
            "stepfun",
            "expected-model",
            true,
            "other workspace source",
            vec![other_source],
        ))
        .unwrap_err();
    assert_eq!(
        cross_source.code,
        ErrorCode::CrossWorkspaceRef,
        "{cross_source}"
    );
    assert_not_presented(&fx.db.core, &fx.ws.id);
    cleanup(&fx.root_path);
    cleanup(&other_path);
}

#[test]
fn revoke_pause_and_config_switch_reject_old_run() {
    let revoked_grant = ready("grant-revoke");
    revoked_grant
        .db
        .core
        .set_service_grant(&ServiceGrantUpdate {
            workspace_id: revoked_grant.ws.id.clone(),
            service: ServiceKind::Model,
            status: ServiceStatus::Revoked,
            provider: Some("stepfun".to_string()),
            model: Some("expected-model".to_string()),
        })
        .unwrap();
    let revoked_model = revoked_grant
        .db
        .core
        .commit_agent_opening(&receipt(
            &revoked_grant.ws.id,
            &revoked_grant.run_id,
            "stepfun",
            "expected-model",
            true,
            "revoked model grant",
            vec![revoked_grant.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(
        revoked_model.code,
        ErrorCode::ModelNotAuthorized,
        "{revoked_model}"
    );
    assert_not_presented(&revoked_grant.db.core, &revoked_grant.ws.id);
    cleanup(&revoked_grant.root_path);

    let fx = ready("authz");
    let old_run = fx.run_id.clone();
    fx.db
        .core
        .set_service_grant(&ServiceGrantUpdate {
            workspace_id: fx.ws.id.clone(),
            service: ServiceKind::Model,
            status: ServiceStatus::Paused,
            provider: Some("stepfun".to_string()),
            model: Some("expected-model".to_string()),
        })
        .unwrap();
    let paused = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &old_run,
            "stepfun",
            "expected-model",
            true,
            "paused grant",
            vec![fx.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(paused.code, ErrorCode::ModelNotAuthorized, "{paused}");
    enable_model(&fx.db.core, &fx.ws.id, "stepfun", "expected-model");
    let after_reenable = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &old_run,
            "stepfun",
            "expected-model",
            true,
            "old run after grant rewrite",
            vec![fx.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(
        after_reenable.code,
        ErrorCode::RunMismatch,
        "{after_reenable}"
    );

    enable_model(&fx.db.core, &fx.ws.id, "stepfun", "other-model");
    enable_model(&fx.db.core, &fx.ws.id, "stepfun", "expected-model");
    let switched_back = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &old_run,
            "stepfun",
            "expected-model",
            true,
            "old run after switch back",
            vec![fx.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(
        switched_back.code,
        ErrorCode::RunMismatch,
        "{switched_back}"
    );
    let fresh = issue_run(&fx.db.core, &fx.ws.id);
    assert_ne!(fresh, old_run);
    fx.db.core.revoke_directory(&fx.root_id).unwrap();
    let revoked = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &fresh,
            "stepfun",
            "expected-model",
            true,
            "revoked root",
            vec![fx.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(revoked.code, ErrorCode::RootRevoked, "{revoked}");
    assert_not_presented(&fx.db.core, &fx.ws.id);
    cleanup(&fx.root_path);

    let paused_root = ready("root-pause");
    let paused_run = paused_root.run_id.clone();
    paused_root
        .db
        .core
        .pause_directory(&paused_root.root_id)
        .unwrap();
    let held = paused_root
        .db
        .core
        .commit_agent_opening(&receipt(
            &paused_root.ws.id,
            &paused_run,
            "stepfun",
            "expected-model",
            true,
            "paused root",
            vec![paused_root.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(held.code, ErrorCode::RootPaused, "{held}");
    paused_root
        .db
        .core
        .resume_directory(&paused_root.root_id)
        .unwrap();
    let resumed = paused_root
        .db
        .core
        .commit_agent_opening(&receipt(
            &paused_root.ws.id,
            &paused_run,
            "stepfun",
            "expected-model",
            true,
            "old run after resume",
            vec![paused_root.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(resumed.code, ErrorCode::RunMismatch, "{resumed}");
    let resumed_run = issue_run(&paused_root.db.core, &paused_root.ws.id);
    let stored = paused_root
        .db
        .core
        .commit_agent_opening(&receipt(
            &paused_root.ws.id,
            &resumed_run,
            "stepfun",
            "expected-model",
            true,
            "new run after resume can commit",
            vec![paused_root.source_id.clone()],
        ))
        .unwrap();
    assert!(!stored.replayed);
    assert!(stored.folded_local_card);
    cleanup(&paused_root.root_path);
}

#[test]
fn failure_empty_evidence_and_replay_do_not_overwrite_history() {
    let mut fx = ready("failure");
    let failed = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &fx.run_id,
            "stepfun",
            "expected-model",
            false,
            "provider failed",
            vec![fx.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(failed.code, ErrorCode::ModelReceiptRejected, "{failed}");
    assert_eq!(fx.db.core.onboarding(&fx.ws.id).unwrap().state, "failed");
    assert_not_presented(&fx.db.core, &fx.ws.id);
    let late_success = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &fx.run_id,
            "stepfun",
            "expected-model",
            true,
            "must not flip a failed run to presented",
            vec![fx.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(
        late_success.code,
        ErrorCode::ModelReceiptRejected,
        "{late_success}"
    );
    fx.db.core.retry_onboarding(&fx.ws.id).unwrap();
    let recovered = issue_run(&fx.db.core, &fx.ws.id);
    assert_ne!(recovered, fx.run_id);
    let empty = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &recovered,
            "stepfun",
            "expected-model",
            true,
            "no sources",
            vec![],
        ))
        .unwrap_err();
    assert_eq!(empty.code, ErrorCode::ModelReceiptRejected, "{empty}");
    assert!(empty.to_string().contains("empty_evidence"));
    assert_not_presented(&fx.db.core, &fx.ws.id);

    let opening = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &recovered,
            "stepfun",
            "expected-model",
            true,
            "I read README.md and still have unknowns.",
            vec![fx.source_id.clone()],
        ))
        .unwrap();
    assert!(!opening.replayed);
    let card = fx.db.core.commit_local_scan_card(&fx.ws.id).unwrap();
    assert!(card.replayed);
    assert_eq!(card.event.presentation, "folded_evidence");
    let replay = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &RunId::new(),
            "stepfun",
            "other-model",
            true,
            "different body must not replace",
            vec![],
        ))
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.event.id, opening.event.id);
    assert_eq!(replay.event.body, opening.event.body);
    assert_eq!(
        fx.db
            .core
            .list_conversation(&fx.ws.id)
            .unwrap()
            .iter()
            .filter(|event| event.kind == "agent_opening_message")
            .count(),
        1
    );
    fx.db.reopen();
    let restored = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &fx.run_id,
            "stepfun",
            "expected-model",
            true,
            "restart must not overwrite",
            vec![fx.source_id.clone()],
        ))
        .unwrap();
    assert!(restored.replayed);
    assert_eq!(restored.event.body, opening.event.body);
    assert_eq!(
        fx.db.core.onboarding(&fx.ws.id).unwrap().opening_presented,
        true
    );
    cleanup(&fx.root_path);
}

#[test]
fn explicit_retry_allows_new_run_and_restart_keeps_old_run_rejected() {
    let mut fx = ready("retry");
    let old_run = fx.run_id.clone();
    fx.db.core.cancel_onboarding(&fx.ws.id).unwrap();
    fx.db.core.retry_onboarding(&fx.ws.id).unwrap();
    let still_old = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &old_run,
            "stepfun",
            "expected-model",
            true,
            "old run after retry",
            vec![fx.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(still_old.code, ErrorCode::RunMismatch, "{still_old}");
    let new_run = issue_run(&fx.db.core, &fx.ws.id);
    assert_ne!(new_run, old_run);
    let same = issue_run(&fx.db.core, &fx.ws.id);
    assert_eq!(
        same, new_run,
        "unchanged authorization reuses the current run"
    );
    let opening = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &new_run,
            "stepfun",
            "expected-model",
            true,
            "new run after explicit retry",
            vec![fx.source_id.clone()],
        ))
        .unwrap();
    assert!(!opening.replayed);
    fx.db.reopen();
    let old_after_restart = fx
        .db
        .core
        .commit_agent_opening(&AgentOpeningReceipt {
            workspace_id: fx.ws.id.clone(),
            run_id: old_run,
            receipt_id: "old-after-restart".to_string(),
            provider: "stepfun".to_string(),
            model: "expected-model".to_string(),
            success: true,
            body: "old run must stay rejected".to_string(),
            source_ids: vec![fx.source_id.clone()],
        })
        .unwrap();
    assert!(old_after_restart.replayed);
    assert_eq!(old_after_restart.event.body, opening.event.body);
    assert_eq!(
        fx.db
            .core
            .list_conversation(&fx.ws.id)
            .unwrap()
            .iter()
            .filter(|event| event.kind == "agent_opening_message")
            .count(),
        1
    );
    cleanup(&fx.root_path);
}

#[test]
fn initial_read_switch_saves_intent_but_does_not_wildcard_authorize() {
    let db = Db::new();
    let root_path = project("intent");
    fs::write(root_path.join("README.md"), "intent only").unwrap();
    let root = db.core.authorize_directory(&root_path).unwrap();
    let scan = db
        .core
        .run_initial_scan(&root.id, &budget(), &CancelFlag::new())
        .unwrap();
    let ws = confirm_one(&db.core, &root.id, &scan.id, true);
    let grant = db
        .core
        .get_service_grant(&ws.id, ServiceKind::Model)
        .unwrap();
    assert_eq!(grant.status, ServiceStatus::Disabled);
    assert!(grant.provider.is_none());
    assert!(grant.model.is_none());
    let checkpoint = db.core.onboarding(&ws.id).unwrap();
    assert!(checkpoint.initial_read_requested);
    assert!(checkpoint.active_run_id.is_none());
    let blocked = db.core.mark_analyzing(&ws.id).unwrap_err();
    assert_eq!(blocked.code, ErrorCode::ModelNotAuthorized, "{blocked}");
    let missing_model = db
        .core
        .set_service_grant(&ServiceGrantUpdate {
            workspace_id: ws.id.clone(),
            service: ServiceKind::Model,
            status: ServiceStatus::Enabled,
            provider: Some("stepfun".to_string()),
            model: None,
        })
        .unwrap_err();
    assert_eq!(
        missing_model.code,
        ErrorCode::ModelNotAuthorized,
        "{missing_model}"
    );
    let unissued = db
        .core
        .commit_agent_opening(&receipt(
            &ws.id,
            &RunId::new(),
            "stepfun",
            "expected-model",
            true,
            "frontend success is not completion",
            vec![],
        ))
        .unwrap_err();
    assert_eq!(unissued.code, ErrorCode::ModelNotAuthorized, "{unissued}");
    assert_not_presented(&db.core, &ws.id);
    enable_model(&db.core, &ws.id, "stepfun", "expected-model");
    let run_id = issue_run(&db.core, &ws.id);
    assert_eq!(
        db.core.onboarding(&ws.id).unwrap().auth_provider.as_deref(),
        Some("stepfun")
    );
    assert_eq!(
        db.core.onboarding(&ws.id).unwrap().auth_model.as_deref(),
        Some("expected-model")
    );
    let source_id = db
        .core
        .read_workspace_file(&ws.id, "README.md", &budget())
        .unwrap()
        .source
        .id;
    db.core
        .commit_agent_opening(&receipt(
            &ws.id,
            &run_id,
            "stepfun",
            "expected-model",
            true,
            "explicit grant can run",
            vec![source_id],
        ))
        .unwrap();
    cleanup(&root_path);
}

#[test]
fn joint_workspace_aligns_source_revoke_with_opening_and_rejects_old_runs() {
    let mut fx = ready("joint");
    let evidence = fx.source_id.clone();
    let first_run = fx.run_id.clone();
    let before = fx.db.core.list_source_refs(&fx.ws.id).unwrap();
    assert!(
        before.iter().any(|source| {
            source.id == evidence && source.content_available && source.excerpt.is_some()
        }),
        "synthetic evidence must be readable before revoke"
    );

    fx.db
        .core
        .set_service_grant(&ServiceGrantUpdate {
            workspace_id: fx.ws.id.clone(),
            service: ServiceKind::Model,
            status: ServiceStatus::Revoked,
            provider: Some("stepfun".to_string()),
            model: Some("expected-model".to_string()),
        })
        .unwrap();
    let model_revoked = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &first_run,
            "stepfun",
            "expected-model",
            true,
            "synthetic receipt after model revoke",
            vec![evidence.clone()],
        ))
        .unwrap_err();
    assert_eq!(
        model_revoked.code,
        ErrorCode::ModelNotAuthorized,
        "{model_revoked}"
    );
    assert_not_presented(&fx.db.core, &fx.ws.id);
    let still_readable = fx
        .db
        .core
        .read_workspace_file(&fx.ws.id, "README.md", &budget())
        .unwrap();
    assert_eq!(still_readable.source.id, evidence);
    assert!(still_readable.source.content_available);

    enable_model(&fx.db.core, &fx.ws.id, "stepfun", "expected-model");
    let cancelled_run = issue_run(&fx.db.core, &fx.ws.id);
    assert_ne!(cancelled_run, first_run);
    fx.db.core.cancel_onboarding(&fx.ws.id).unwrap();
    let late = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &cancelled_run,
            "stepfun",
            "expected-model",
            true,
            "synthetic receipt after cancel",
            vec![evidence.clone()],
        ))
        .unwrap_err();
    assert_eq!(late.code, ErrorCode::Cancelled, "{late}");
    fx.db.core.retry_onboarding(&fx.ws.id).unwrap();
    fx.db.reopen();
    let after_restart = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &cancelled_run,
            "stepfun",
            "expected-model",
            true,
            "old run after retry and restart",
            vec![evidence.clone()],
        ))
        .unwrap_err();
    assert_eq!(
        after_restart.code,
        ErrorCode::RunMismatch,
        "{after_restart}"
    );
    let first_after_restart = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &first_run,
            "stepfun",
            "expected-model",
            true,
            "pre-revoke run after restart",
            vec![evidence.clone()],
        ))
        .unwrap_err();
    assert_eq!(
        first_after_restart.code,
        ErrorCode::RunMismatch,
        "{first_after_restart}"
    );
    assert_not_presented(&fx.db.core, &fx.ws.id);

    let live = issue_run(&fx.db.core, &fx.ws.id);
    fx.db.core.revoke_directory(&fx.root_id).unwrap();
    let opening_revoked = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &live,
            "stepfun",
            "expected-model",
            true,
            "synthetic receipt after directory revoke",
            vec![evidence.clone()],
        ))
        .unwrap_err();
    assert_eq!(
        opening_revoked.code,
        ErrorCode::RootRevoked,
        "{opening_revoked}"
    );
    let read_revoked = fx
        .db
        .core
        .read_workspace_file(&fx.ws.id, "README.md", &budget())
        .unwrap_err();
    assert_eq!(read_revoked.code, ErrorCode::RootRevoked, "{read_revoked}");
    let selective = fx
        .db
        .core
        .selective_key_read(&fx.ws.id, &budget(), &CancelFlag::new())
        .unwrap_err();
    assert_eq!(selective.code, ErrorCode::RootRevoked, "{selective}");
    let hidden = fx.db.core.list_source_refs(&fx.ws.id).unwrap();
    assert!(
        hidden.iter().any(|source| {
            source.id == evidence && !source.content_available && source.excerpt.is_none()
        }),
        "revoked source must not keep an excerpt"
    );
    assert_not_presented(&fx.db.core, &fx.ws.id);
    fx.db.reopen();
    let still_revoked = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &live,
            "stepfun",
            "expected-model",
            true,
            "old run after directory revoke restart",
            vec![evidence],
        ))
        .unwrap_err();
    assert_eq!(
        still_revoked.code,
        ErrorCode::RootRevoked,
        "{still_revoked}"
    );
    assert_not_presented(&fx.db.core, &fx.ws.id);
    cleanup(&fx.root_path);
}

#[test]
fn live_run_survives_restart_but_unissued_success_does_not() {
    let mut fx = ready("restart-live");
    let run_id = fx.run_id.clone();
    fx.db.reopen();
    assert_eq!(
        fx.db
            .core
            .onboarding(&fx.ws.id)
            .unwrap()
            .active_run_id
            .as_ref(),
        Some(&run_id)
    );
    let stored = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &run_id,
            "stepfun",
            "expected-model",
            true,
            "persisted run can finish after restart",
            vec![fx.source_id.clone()],
        ))
        .unwrap();
    assert!(!stored.replayed);
    assert!(fx.db.core.onboarding(&fx.ws.id).unwrap().model_analyzed);
    cleanup(&fx.root_path);

    let db = Db::new();
    let root_path = project("unissued");
    fs::write(root_path.join("README.md"), "no run yet").unwrap();
    let root = db.core.authorize_directory(&root_path).unwrap();
    let scan = db
        .core
        .run_initial_scan(&root.id, &budget(), &CancelFlag::new())
        .unwrap();
    let ws = confirm_one(&db.core, &root.id, &scan.id, false);
    enable_model(&db.core, &ws.id, "stepfun", "expected-model");
    let forged = db
        .core
        .commit_agent_opening(&receipt(
            &ws.id,
            &RunId::new(),
            "stepfun",
            "expected-model",
            true,
            "success flag without a core run",
            vec![],
        ))
        .unwrap_err();
    assert_eq!(forged.code, ErrorCode::RunMismatch, "{forged}");
    assert_not_presented(&db.core, &ws.id);
    cleanup(&root_path);
}

#[test]
fn session_binding_lives_in_onboarding_evidence_and_is_not_a_grant() {
    let mut fx = ready("session-binding");
    let before = fx.db.core.onboarding(&fx.ws.id).unwrap();
    assert!(fx
        .db
        .core
        .opening_session_binding(&fx.ws.id)
        .unwrap()
        .is_none());
    let binding = hark_core::SessionBinding {
        workspace_id: fx.ws.id.clone(),
        conversation_id: fx.ws.conversation_id.clone(),
        run_id: fx.run_id.clone(),
        session_ref: "pi:01234567-89ab-cdef-0123-456789abcdef".to_string(),
        bound_at: "caller-clock-is-not-authoritative".to_string(),
    };
    let stored = fx.db.core.bind_opening_session(&binding).unwrap();
    assert_eq!(stored.session_ref, binding.session_ref);
    assert_ne!(stored.bound_at, binding.bound_at);
    let again = fx.db.core.bind_opening_session(&binding).unwrap();
    assert_eq!(again.bound_at, stored.bound_at);
    let replaced = hark_core::SessionBinding {
        session_ref: "pi:ffffffff-ffff-ffff-ffff-ffffffffffff".to_string(),
        ..binding.clone()
    };
    assert_eq!(
        fx.db.core.bind_opening_session(&replaced).unwrap_err().code,
        ErrorCode::CorrelationRejected
    );
    let after = fx.db.core.onboarding(&fx.ws.id).unwrap();
    assert_eq!(after.active_run_id, before.active_run_id);
    assert_eq!(after.auth_provider, before.auth_provider);
    assert_eq!(after.auth_grant_updated_at, before.auth_grant_updated_at);
    assert!(!after.opening_presented);
    fx.db.reopen();
    let loaded = fx
        .db
        .core
        .opening_session_binding(&fx.ws.id)
        .unwrap()
        .unwrap();
    assert_eq!(loaded.session_ref, binding.session_ref);
    assert_eq!(loaded.run_id, fx.run_id);
    assert!(fx
        .db
        .core
        .list_conversation(&fx.ws.id)
        .unwrap()
        .iter()
        .all(|event| event.kind != "user_message"));
    let conn = rusqlite::Connection::open(&fx.db.path).unwrap();
    let evidence: String = conn
        .query_row(
            "SELECT evidence_json FROM onboarding_runs WHERE workspace_id = ?1",
            [fx.ws.id.as_str()],
            |row| row.get(0),
        )
        .unwrap();
    assert!(evidence.contains("scanId"), "{evidence}");
    assert!(evidence.contains("sessionBinding"), "{evidence}");
    cleanup(&fx.root_path);
}

#[test]
fn ended_run_binding_rejects_current_run_until_replacement_is_allowed() {
    let mut fx = ready("session-rebind");
    let run_a = fx.run_id.clone();
    let session_a = "pi:01234567-89ab-cdef-0123-456789abcdef".to_string();
    let session_b = "pi:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string();
    let binding_a = hark_core::SessionBinding {
        workspace_id: fx.ws.id.clone(),
        conversation_id: fx.ws.conversation_id.clone(),
        run_id: run_a.clone(),
        session_ref: session_a.clone(),
        bound_at: "caller-clock".to_string(),
    };
    let stored_a = fx.db.core.bind_opening_session(&binding_a).unwrap();
    let events_before = fx.db.core.list_conversation(&fx.ws.id).unwrap();
    fx.db.core.cancel_onboarding(&fx.ws.id).unwrap();
    fx.db.core.retry_onboarding(&fx.ws.id).unwrap();
    let run_b = issue_run(&fx.db.core, &fx.ws.id);
    assert_ne!(run_b, run_a);
    let same_ref = hark_core::SessionBinding {
        run_id: run_b.clone(),
        session_ref: session_a.clone(),
        bound_at: "caller-clock".to_string(),
        ..binding_a.clone()
    };
    let rebound = fx
        .db
        .core
        .bind_opening_session(&same_ref)
        .expect("current run must replace an ended run binding with the same sessionRef");
    assert_eq!(rebound.run_id, run_b);
    assert_eq!(rebound.session_ref, session_a);
    assert_ne!(rebound.bound_at, stored_a.bound_at);
    let replay = fx.db.core.bind_opening_session(&same_ref).unwrap();
    assert_eq!(replay.bound_at, rebound.bound_at);
    let swapped = hark_core::SessionBinding {
        session_ref: session_b.clone(),
        ..same_ref.clone()
    };
    assert_eq!(
        fx.db.core.bind_opening_session(&swapped).unwrap_err().code,
        ErrorCode::CorrelationRejected
    );
    let stale = hark_core::SessionBinding {
        run_id: run_a.clone(),
        session_ref: session_b.clone(),
        ..binding_a.clone()
    };
    assert_eq!(
        fx.db.core.bind_opening_session(&stale).unwrap_err().code,
        ErrorCode::RunMismatch
    );
    assert_eq!(
        fx.db
            .core
            .onboarding(&fx.ws.id)
            .unwrap()
            .active_run_id
            .as_ref(),
        Some(&run_b)
    );
    assert_eq!(
        fx.db.core.list_conversation(&fx.ws.id).unwrap().len(),
        events_before.len()
    );
    assert!(fx
        .db
        .core
        .list_conversation(&fx.ws.id)
        .unwrap()
        .iter()
        .all(|event| event.kind != "user_message"));
    let compacted = fx
        .db
        .core
        .replace_opening_session_for_compaction(&swapped)
        .unwrap();
    assert_eq!(compacted.session_ref, session_b);
    assert_eq!(compacted.run_id, run_b);
    let compact_replay = fx
        .db
        .core
        .replace_opening_session_for_compaction(&swapped)
        .unwrap();
    assert_eq!(compact_replay.bound_at, compacted.bound_at);
    assert_eq!(
        fx.db
            .core
            .bind_opening_session(&hark_core::SessionBinding {
                session_ref: session_a.clone(),
                ..swapped.clone()
            })
            .unwrap_err()
            .code,
        ErrorCode::CorrelationRejected
    );
    assert_eq!(
        fx.db
            .core
            .replace_opening_session_for_compaction(&stale)
            .unwrap_err()
            .code,
        ErrorCode::RunMismatch
    );
    let late = fx
        .db
        .core
        .commit_agent_opening(&receipt(
            &fx.ws.id,
            &run_a,
            "stepfun",
            "expected-model",
            true,
            "old run must not revive",
            vec![fx.source_id.clone()],
        ))
        .unwrap_err();
    assert_eq!(late.code, ErrorCode::RunMismatch, "{late}");
    fx.db.reopen();
    let loaded = fx
        .db
        .core
        .opening_session_binding(&fx.ws.id)
        .unwrap()
        .unwrap();
    assert_eq!(loaded.session_ref, session_b);
    assert_eq!(loaded.run_id, run_b);
    let conn = rusqlite::Connection::open(&fx.db.path).unwrap();
    let evidence: String = conn
        .query_row(
            "SELECT evidence_json FROM onboarding_runs WHERE workspace_id = ?1",
            [fx.ws.id.as_str()],
            |row| row.get(0),
        )
        .unwrap();
    assert!(evidence.contains("scanId"), "{evidence}");
    assert!(evidence.contains(&session_a), "{evidence}");
    assert!(evidence.contains("retiredSessionBindings"), "{evidence}");
    assert!(evidence.contains("compaction-fallback"), "{evidence}");
    cleanup(&fx.root_path);

    let fx = ready("session-rebind-new-ref");
    let run_a = fx.run_id.clone();
    let old_ref = "pi:11111111-1111-1111-1111-111111111111".to_string();
    let new_ref = "pi:22222222-2222-2222-2222-222222222222".to_string();
    fx.db
        .core
        .bind_opening_session(&hark_core::SessionBinding {
            workspace_id: fx.ws.id.clone(),
            conversation_id: fx.ws.conversation_id.clone(),
            run_id: run_a.clone(),
            session_ref: old_ref,
            bound_at: "caller-clock".to_string(),
        })
        .unwrap();
    fx.db.core.cancel_onboarding(&fx.ws.id).unwrap();
    fx.db.core.retry_onboarding(&fx.ws.id).unwrap();
    let run_b = issue_run(&fx.db.core, &fx.ws.id);
    let stored = fx
        .db
        .core
        .bind_opening_session(&hark_core::SessionBinding {
            workspace_id: fx.ws.id.clone(),
            conversation_id: fx.ws.conversation_id.clone(),
            run_id: run_b.clone(),
            session_ref: new_ref.clone(),
            bound_at: "caller-clock".to_string(),
        })
        .unwrap();
    assert_eq!(stored.run_id, run_b);
    assert_eq!(stored.session_ref, new_ref);
    assert_eq!(
        fx.db
            .core
            .onboarding(&fx.ws.id)
            .unwrap()
            .active_run_id
            .as_ref(),
        Some(&run_b)
    );
    let forged = fx
        .db
        .core
        .bind_opening_session(&hark_core::SessionBinding {
            run_id: RunId::new(),
            session_ref: "pi:33333333-3333-3333-3333-333333333333".to_string(),
            ..stored.clone()
        })
        .unwrap_err();
    assert_eq!(forged.code, ErrorCode::RunMismatch, "{forged}");
    cleanup(&fx.root_path);
}
