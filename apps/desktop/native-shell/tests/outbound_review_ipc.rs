//! Isolated Native entry tests. These APIs do not call a model or the network.
use hark_core::{ConversationRunStart, Core, RunId, Workspace, WorkspaceId};
use hark_native_shell::{
    ConfirmRequest, NativeShell, ReviewDecision, ReviewLimit, ReviewRequest, ReviewSource,
    Selection, FRONTEND_COMMANDS,
};
use std::time::Duration;

struct Fixture {
    _temp: tempfile::TempDir,
    shell: NativeShell,
    core: Core,
    workspace: Workspace,
    run: RunId,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let db = temp.path().join("business.sqlite");
        let project = temp.path().join("synthetic-project");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("README.md"), "synthetic").unwrap();
        let shell = NativeShell::open(&db).unwrap();
        let ticket = shell.stage_native_pick(&project).unwrap();
        let root = shell.authorize_picked(&ticket.pick_token).unwrap();
        let scan = shell.scan_root(root.id.as_str()).unwrap();
        let workspace = shell
            .confirm_import(&ConfirmRequest {
                root_id: root.id.as_str().into(),
                scan_id: scan.id.as_str().into(),
                selection: Selection::Single,
            })
            .unwrap()
            .workspaces
            .remove(0);
        shell.set_model_grant(workspace.id.as_str(), true).unwrap();
        let core = Core::open(&db).unwrap();
        let run = core
            .start_conversation_run(&ConversationRunStart {
                request_id: format!("req_{}", uuid::Uuid::new_v4().simple()),
                workspace_id: workspace.id.clone(),
                conversation_id: workspace.conversation_id.clone(),
                user_message_id: None,
                user_text: Some("synthetic prompt".into()),
            })
            .unwrap()
            .run
            .id;
        Self {
            _temp: temp,
            shell,
            core,
            workspace,
            run,
        }
    }
    fn request(&self, run: &RunId) -> ReviewRequest {
        ReviewRequest {
            workspace_id: self.workspace.id.clone(),
            run_id: run.clone(),
            recipient: "https://example.invalid/v1/messages".into(),
            model: "step-3.7-flash".into(),
            limits: vec![ReviewLimit {
                label: "输出".into(),
                value: "100".into(),
            }],
            sources: vec![ReviewSource {
                source_id: "synthetic".into(),
                path: "README.md".into(),
                version: "synthetic-version".into(),
                byte_len: 9,
                truncated: false,
            }],
            body: "{ \"message\": \"synthetic\" }".into(),
        }
    }
}

#[test]
fn ui_can_only_read_and_decide_an_existing_exact_snapshot() {
    let f = Fixture::new();
    assert!(FRONTEND_COMMANDS.contains(&"get_outbound_review"));
    assert!(FRONTEND_COMMANDS.contains(&"decide_outbound_review"));
    assert!(!FRONTEND_COMMANDS.contains(&"stage_outbound_review"));
    assert!(!FRONTEND_COMMANDS.contains(&"take_approved_outbound_review"));
    let workspace = f.workspace.id.as_str();
    let run = f.run.as_str();
    assert!(f
        .shell
        .get_outbound_review(workspace, run, "review_missing")
        .is_err());
    let id = f
        .shell
        .stage_outbound_review(f.request(&f.run), Duration::from_secs(30))
        .unwrap();
    let view = f.shell.get_outbound_review(workspace, run, &id).unwrap();
    assert_eq!(view.body(), "{ \"message\": \"synthetic\" }");
    assert_eq!(view.sources()[0].path, "README.md");
    assert!(f
        .shell
        .get_outbound_review("ws_00000000000000000000000000000002", run, &id)
        .is_err());
    assert!(f
        .shell
        .decide_outbound_review(
            workspace,
            "run_00000000000000000000000000000002",
            &id,
            ReviewDecision::Approve
        )
        .is_err());
    f.shell
        .decide_outbound_review(workspace, run, &id, ReviewDecision::Approve)
        .unwrap();
    assert!(f
        .shell
        .decide_outbound_review(workspace, run, &id, ReviewDecision::Approve)
        .is_err());
    let taken = f
        .shell
        .take_approved_outbound_review(workspace, run, &id)
        .unwrap();
    assert_eq!(taken.body(), view.body());
    assert!(f
        .shell
        .take_approved_outbound_review(workspace, run, &id)
        .is_err());
}

#[test]
fn externally_cancelled_turn_cannot_be_approved_read_or_reenqueued() {
    let f = Fixture::new();
    let workspace = f.workspace.id.as_str();
    let run = f.run.as_str();
    let id = f
        .shell
        .stage_outbound_review(f.request(&f.run), Duration::from_secs(30))
        .unwrap();
    f.core
        .cancel_conversation_run(&f.workspace.id, &f.run)
        .unwrap();
    assert!(f.shell.get_outbound_review(workspace, run, &id).is_err());
    assert!(f
        .shell
        .decide_outbound_review(workspace, run, &id, ReviewDecision::Approve)
        .is_err());
    assert!(f
        .shell
        .stage_outbound_review(f.request(&f.run), Duration::from_secs(30))
        .is_err());
    f.shell
        .decide_outbound_review(workspace, run, &id, ReviewDecision::Reject)
        .unwrap();
}

#[test]
fn shell_cancel_cleans_up_and_rejects_late_enqueue() {
    let f = Fixture::new();
    let workspace = f.workspace.id.as_str();
    let run = f.run.as_str();
    let id = f
        .shell
        .stage_outbound_review(f.request(&f.run), Duration::from_secs(30))
        .unwrap();
    f.shell.cancel_agent_turn(workspace, run).unwrap();
    assert!(f.shell.get_outbound_review(workspace, run, &id).is_err());
    assert!(f
        .shell
        .stage_outbound_review(f.request(&f.run), Duration::from_secs(30))
        .is_err());
}

#[test]
fn opening_cancel_refuses_approval_and_late_enqueue() {
    let f = Fixture::new();
    let opening = f
        .core
        .mark_analyzing(&f.workspace.id)
        .unwrap()
        .active_run_id
        .unwrap();
    let workspace = f.workspace.id.as_str();
    let id = f
        .shell
        .stage_outbound_review(f.request(&opening), Duration::from_secs(30))
        .unwrap();
    f.core.cancel_onboarding(&f.workspace.id).unwrap();
    assert!(f
        .shell
        .get_outbound_review(workspace, opening.as_str(), &id)
        .is_err());
    assert!(f
        .shell
        .decide_outbound_review(workspace, opening.as_str(), &id, ReviewDecision::Approve)
        .is_err());
    assert!(f
        .shell
        .stage_outbound_review(f.request(&opening), Duration::from_secs(30))
        .is_err());
    f.shell
        .decide_outbound_review(workspace, opening.as_str(), &id, ReviewDecision::Reject)
        .unwrap();
}

#[test]
fn revoked_model_grant_refuses_stale_review_but_allows_rejection() {
    let f = Fixture::new();
    let workspace = f.workspace.id.as_str();
    let run = f.run.as_str();
    let id = f
        .shell
        .stage_outbound_review(f.request(&f.run), Duration::from_secs(30))
        .unwrap();
    f.shell.set_model_grant(workspace, false).unwrap();
    assert!(f.shell.get_outbound_review(workspace, run, &id).is_err());
    assert!(f
        .shell
        .decide_outbound_review(workspace, run, &id, ReviewDecision::Approve)
        .is_err());
    assert!(f
        .shell
        .stage_outbound_review(f.request(&f.run), Duration::from_secs(30))
        .is_err());
    f.shell
        .decide_outbound_review(workspace, run, &id, ReviewDecision::Reject)
        .unwrap();
}

#[test]
fn unknown_or_cross_workspace_runs_cannot_be_enqueued() {
    let f = Fixture::new();
    let mut request = f.request(&f.run);
    request.workspace_id = WorkspaceId::parse("ws_00000000000000000000000000000002").unwrap();
    assert!(f
        .shell
        .stage_outbound_review(request, Duration::from_secs(30))
        .is_err());
    let missing = RunId::parse("run_00000000000000000000000000000002").unwrap();
    assert!(f
        .shell
        .stage_outbound_review(f.request(&missing), Duration::from_secs(30))
        .is_err());
}
