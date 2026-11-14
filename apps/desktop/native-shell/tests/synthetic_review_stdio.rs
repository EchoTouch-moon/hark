//! Real Native ↔ Node IPC with a synthetic provider and no network sender.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use hark_native_shell::{
    AgentTurnRequest, ConfirmRequest, DevSidecarConfig, NativeShell, ReviewDecision,
    RunStreamEvent, Selection, TurnProgress, FRONTEND_COMMANDS,
};

struct Fixture {
    _temp: tempfile::TempDir,
    shell: NativeShell,
    workspace: String,
    conversation: String,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("synthetic-project");
        let app_data = temp.path().join("app-data");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&app_data).unwrap();
        let provider = app_data.join("provider.json");
        let script = app_data.join("scripted.json");
        fs::write(&provider, r#"{"enabled":true,"providerId":"hark-byok","modelId":"local-model","baseUrl":"http://127.0.0.1:9/v1","apiKey":"synthetic-key-not-real","wire":"openai-completions","allowRemote":false}"#).unwrap();
        fs::write(&script, r#"{"responses":[]}"#).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .canonicalize()
            .unwrap();
        let shell = NativeShell::open(&temp.path().join("business.sqlite")).unwrap();
        let ticket = shell.stage_native_pick(&project).unwrap();
        let authorized = shell.authorize_picked(&ticket.pick_token).unwrap();
        let scan = shell.scan_root(authorized.id.as_str()).unwrap();
        let workspace = shell
            .confirm_import(&ConfirmRequest {
                root_id: authorized.id.to_string(),
                scan_id: scan.id.to_string(),
                selection: Selection::Single,
            })
            .unwrap()
            .workspaces
            .remove(0);
        shell
            .dev_set_synthetic_model_grant(workspace.id.as_str(), "hark-byok", "local-model")
            .unwrap();
        assert!(!FRONTEND_COMMANDS.contains(&"enable_synthetic_review_fixture"));
        shell.enable_synthetic_review_fixture();
        shell
            .configure_dev_sidecar(DevSidecarConfig {
                node_path: PathBuf::from("/usr/local/bin/node"),
                host_entry: root.join("apps/desktop/native-shell/tests/fixtures/sidecar.ts"),
                app_data_dir: app_data,
                working_dir: root,
                provider_config_path: provider,
                scripted_transport_path: Some(script),
                run_timeout_ms: 30_000,
            })
            .unwrap();
        shell.start_configured_sidecar().unwrap();
        Self {
            _temp: temp,
            shell,
            workspace: workspace.id.to_string(),
            conversation: workspace.conversation_id.to_string(),
        }
    }

    fn start(&self) -> (String, Arc<Mutex<Vec<RunStreamEvent>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let accepted = self
            .shell
            .start_agent_turn(
                AgentTurnRequest {
                    request_id: "synthetic-review-request".into(),
                    workspace_id: self.workspace.clone(),
                    conversation_id: self.conversation.clone(),
                    user_prompt: "fixture-review-prompt".into(),
                },
                TurnProgress::new(move |event| sink.lock().unwrap().push(event)),
            )
            .unwrap();
        (accepted.run_id, events)
    }
}

fn wait_event(
    events: &Mutex<Vec<RunStreamEvent>>,
    predicate: impl Fn(&RunStreamEvent) -> bool,
) -> RunStreamEvent {
    let start = Instant::now();
    loop {
        if let Some(event) = events
            .lock()
            .unwrap()
            .iter()
            .find(|event| predicate(event))
            .cloned()
        {
            return event;
        }
        assert!(
            start.elapsed() < Duration::from_secs(20),
            "synthetic review event timed out"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn approved_snapshot_resumes_only_the_synthetic_turn_once() {
    let f = Fixture::new();
    let (run, events) = f.start();
    let pending = wait_event(&events, |event| {
        event.event_type == "outbound_review_requested"
    });
    let id = pending.payload.review_id.expect("review ID");
    let snapshot = f
        .shell
        .get_outbound_review(&f.workspace, &run, &id)
        .unwrap();
    assert!(snapshot.body().contains("fixture-review-prompt"));
    assert!(!snapshot.body().contains("synthetic-key-not-real"));
    assert_eq!(snapshot.model(), "local-model");
    f.shell
        .decide_outbound_review(&f.workspace, &run, &id, ReviewDecision::Approve)
        .unwrap();
    let terminal = wait_event(&events, |event| {
        event.event_type == "run_completed" || event.event_type == "run_failed"
    });
    assert_eq!(terminal.event_type, "run_completed");
    assert_eq!(terminal.payload.persistence_verified, Some(true));
    assert!(f
        .shell
        .decide_outbound_review(&f.workspace, &run, &id, ReviewDecision::Approve)
        .is_err());
    let events = f.shell.list_conversation(&f.workspace).unwrap();
    assert!(events
        .iter()
        .any(|event| event.body.contains("synthetic-review-approved")));
    assert!(!f.shell.sidecar_stderr().contains("synthetic-key-not-real"));
}

#[test]
fn rejection_and_cancellation_do_not_produce_a_synthetic_answer() {
    for cancel in [false, true] {
        let f = Fixture::new();
        let (run, events) = f.start();
        let pending = wait_event(&events, |event| {
            event.event_type == "outbound_review_requested"
        });
        let id = pending.payload.review_id.expect("review ID");
        if cancel {
            f.shell.cancel_agent_turn(&f.workspace, &run).unwrap();
        } else {
            f.shell
                .decide_outbound_review(&f.workspace, &run, &id, ReviewDecision::Reject)
                .unwrap();
        }
        let terminal = wait_event(&events, |event| {
            matches!(
                event.event_type,
                "run_completed" | "run_cancelled" | "run_failed"
            )
        });
        assert_ne!(terminal.event_type, "run_completed");
        assert!(f
            .shell
            .decide_outbound_review(&f.workspace, &run, &id, ReviewDecision::Approve)
            .is_err());
        assert!(!f
            .shell
            .list_conversation(&f.workspace)
            .unwrap()
            .iter()
            .any(|event| event.body.contains("synthetic-review-approved")));
    }
}
