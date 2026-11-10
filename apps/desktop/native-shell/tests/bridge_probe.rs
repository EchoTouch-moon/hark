//! Real Node + Pi SDK + Core stdio probe. The model transport is scripted.
//! It is not a StepFun call and it does not read a real key.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use hark_native_shell::{
    AgentTurnRequest, ConfirmRequest, DevSidecarConfig, NativeShell, RunStreamEvent, Selection,
    TurnProgress, FRONTEND_COMMANDS, OPENING_INTERNAL_INSTRUCTION,
};

const KEY: &str = "synthetic-key-not-real";
const PROVIDER: &str = "hark-synth";
const MODEL: &str = "scripted-local";

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap()
}

fn node_bin() -> PathBuf {
    let path = PathBuf::from("/usr/local/bin/node");
    assert!(
        path.is_file(),
        "dev node binary missing; this slice does not install Node"
    );
    path
}

fn pid_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn sha256_file(path: &Path) -> String {
    let output = Command::new("shasum")
        .args(["-a", "256"])
        .arg(path)
        .output()
        .unwrap();
    String::from_utf8(output.stdout)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .to_string()
}

fn write_slot(app_data: &Path, scripted: &str) {
    fs::create_dir_all(app_data).unwrap();
    fs::write(
        app_data.join("provider.json"),
        format!(
            r#"{{"enabled":true,"providerId":"{PROVIDER}","modelId":"{MODEL}","baseUrl":"http://127.0.0.1:9/v1","apiKey":"{KEY}","wire":"openai-completions","allowRemote":false}}"#
        ),
    )
    .unwrap();
    fs::write(app_data.join("scripted.json"), scripted).unwrap();
}

fn config(app_data: &Path, timeout_ms: u64) -> DevSidecarConfig {
    let root = repo_root();
    DevSidecarConfig {
        node_path: node_bin(),
        host_entry: root.join("packages/agent-host/src/sidecar.ts"),
        app_data_dir: app_data.to_path_buf(),
        working_dir: root,
        provider_config_path: app_data.join("provider.json"),
        scripted_transport_path: Some(app_data.join("scripted.json")),
        run_timeout_ms: timeout_ms,
    }
}

struct Ready {
    shell: NativeShell,
    tmp: tempfile::TempDir,
    project: PathBuf,
    app_data: PathBuf,
    root_id: String,
    workspace_id: String,
}

fn ready(name: &str, scripted: &str, timeout_ms: u64) -> Ready {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("project");
    let app_data = tmp.path().join("app-data");
    fs::create_dir_all(&project).unwrap();
    fs::write(
        project.join("README.md"),
        format!("hark-bridge-readme-{name}\n"),
    )
    .unwrap();
    write_slot(&app_data, scripted);
    let shell = NativeShell::open(&tmp.path().join("business.sqlite")).unwrap();
    assert!(!shell.sidecar_status().connected);
    assert!(!FRONTEND_COMMANDS.contains(&"dev_set_synthetic_model_grant"));
    let ticket = shell.stage_native_pick(&project).unwrap();
    let root = shell.authorize_picked(&ticket.pick_token).unwrap();
    let scan = shell.scan_root(root.id.as_str()).unwrap();
    let confirmed = shell
        .confirm_import(&ConfirmRequest {
            root_id: root.id.as_str().to_string(),
            scan_id: scan.id.as_str().to_string(),
            selection: Selection::Single,
        })
        .unwrap();
    let workspace_id = confirmed.workspaces[0].id.as_str().to_string();
    shell.commit_local_scan_card(&workspace_id).unwrap();
    shell
        .dev_set_synthetic_model_grant(&workspace_id, PROVIDER, MODEL)
        .unwrap();
    shell
        .configure_dev_sidecar(config(&app_data, timeout_ms))
        .unwrap();
    shell.start_configured_sidecar().unwrap();
    Ready {
        shell,
        tmp,
        project,
        app_data,
        root_id: root.id.as_str().to_string(),
        workspace_id,
    }
}

fn scripted_count(stderr: &str) -> usize {
    stderr.matches("scripted-transport-invoke").count()
}

fn assert_no_key(stderr: &str) {
    assert!(!stderr.contains(KEY), "stderr leaked credential material");
}

fn opening_count(shell: &NativeShell, workspace_id: &str) -> usize {
    shell
        .list_conversation(workspace_id)
        .unwrap()
        .iter()
        .filter(|event| event.kind == "agent_opening_message")
        .count()
}

fn user_count(shell: &NativeShell, workspace_id: &str) -> usize {
    shell
        .list_conversation(workspace_id)
        .unwrap()
        .iter()
        .filter(|event| event.kind == "user_message")
        .count()
}

#[test]
fn joint_opening_reads_real_readme_and_restart_does_not_duplicate() {
    let scripted = r#"{"responses":[{"kind":"tool_call","name":"workspace.read_file","arguments":{"relativePath":"README.md"}},{"kind":"text","text":"Scripted opening. Not StepFun."}]}"#;
    let ready = ready("happy", scripted, 60_000);
    let pid = ready.shell.sidecar_pid().expect("node pid");
    assert!(pid_alive(pid));
    let result = ready
        .shell
        .run_configured_opening(&ready.workspace_id)
        .unwrap();
    assert!(result.committed);
    assert!(result.folded_local_card);
    assert!(!result.replayed);
    assert_eq!(result.transport, "scripted");
    assert_eq!(result.step_fun, "unverified");
    assert_eq!(result.node_pid, pid);
    assert!(result.session_ref.starts_with("pi:"));
    assert_eq!(result.source_ids.len(), 1);
    let source = ready
        .shell
        .get_source_ref(&ready.workspace_id, &result.source_ids[0])
        .unwrap();
    assert_eq!(source.relative_path, "README.md");
    assert_eq!(
        source.content_sha256,
        sha256_file(&ready.project.join("README.md"))
    );
    assert!(source.content_available);
    assert_eq!(opening_count(&ready.shell, &ready.workspace_id), 1);
    assert_eq!(user_count(&ready.shell, &ready.workspace_id), 0);
    // The scoped opening instruction must reach Pi's session while remaining
    // absent from the user's Hark conversation history.
    let session_dir = ready.app_data.join("sessions").join(&ready.workspace_id);
    let session_path = fs::read_dir(session_dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.extension()
                .is_some_and(|extension| extension == "jsonl")
        })
        .expect("Pi session JSONL");
    let session = fs::read_to_string(session_path).unwrap();
    let contains_instruction = session.lines().any(|line| {
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) else {
            return false;
        };
        entry.get("type").and_then(|value| value.as_str()) == Some("message")
            && entry
                .pointer("/message/role")
                .and_then(|value| value.as_str())
                == Some("user")
            && entry
                .pointer("/message/content")
                .and_then(|value| value.as_array())
                .is_some_and(|content| {
                    content.iter().any(|part| {
                        part.get("text").and_then(|value| value.as_str())
                            == Some(OPENING_INTERNAL_INSTRUCTION)
                    })
                })
    });
    assert!(
        contains_instruction,
        "opening instruction did not reach Pi session"
    );
    let card = ready
        .shell
        .list_conversation(&ready.workspace_id)
        .unwrap()
        .into_iter()
        .find(|event| event.kind == "local_scan_card")
        .unwrap();
    assert_eq!(card.presentation, "folded_evidence");
    let binding = ready
        .shell
        .opening_session_binding(&ready.workspace_id)
        .unwrap()
        .unwrap();
    assert_eq!(binding.session_ref, result.session_ref);
    assert_eq!(binding.run_id.as_str(), result.run_id);
    let stderr = ready.shell.sidecar_stderr();
    assert_no_key(&stderr);
    assert!(scripted_count(&stderr) >= 1);
    let stop = ready.shell.stop_sidecar().unwrap();
    assert!(!stop.group_alive, "process group still alive after stop");
    assert!(!pid_alive(pid));
    let db = ready.tmp.path().join("business.sqlite");
    let app_data = ready.app_data.clone();
    let workspace_id = ready.workspace_id.clone();
    let session_ref = result.session_ref.clone();
    drop(ready.shell);
    let restored = NativeShell::open(&db).unwrap();
    assert!(!restored.sidecar_status().connected);
    let again = restored
        .opening_session_binding(&workspace_id)
        .unwrap()
        .unwrap();
    assert_eq!(again.session_ref, session_ref);
    assert_eq!(opening_count(&restored, &workspace_id), 1);
    assert_eq!(user_count(&restored, &workspace_id), 0);
    let err = restored.run_configured_opening(&workspace_id).unwrap_err();
    assert_eq!(err.code, "sidecar_not_connected");
    restored
        .configure_dev_sidecar(config(&app_data, 30_000))
        .unwrap();
    restored.start_configured_sidecar().unwrap();
    let second = restored.run_configured_opening(&workspace_id).unwrap_err();
    assert_eq!(second.code, "onboarding_already_presented");
    assert_eq!(opening_count(&restored, &workspace_id), 1);
    assert_eq!(user_count(&restored, &workspace_id), 0);
    let index = fs::read_to_string(
        app_data
            .join("sessions")
            .join(&workspace_id)
            .join("index.json"),
    )
    .unwrap();
    assert!(index.contains(&session_ref));
    let stop = restored.stop_sidecar().unwrap();
    assert!(!stop.group_alive);
    println!(
        "BRIDGE_EVIDENCE {{\"nodePid\":{pid},\"runId\":\"{}\",\"sessionRef\":\"{session_ref}\",\"sourceId\":\"{}\",\"transport\":\"scripted\",\"stepFun\":\"unverified\",\"userMessages\":0,\"openingCount\":1,\"groupAliveAfterStop\":false}}",
        result.run_id,
        result.source_ids[0]
    );
}

#[test]
fn revoke_cancel_timeout_budget_and_mismatch_do_not_commit() {
    let hold = r#"{"responses":[{"kind":"hold","untilAbort":true}]}"#;
    let read_then_text = r#"{"responses":[{"kind":"tool_call","name":"workspace.read_file","arguments":{"relativePath":"README.md"}},{"kind":"text","text":"should-not-commit"}]}"#;

    let revoked = ready("revoke", read_then_text, 45_000);
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    let hook_gate = Arc::clone(&gate);
    revoked
        .shell
        .set_before_tool_reply_hook(Some(Arc::new(move |_| {
            let (lock, cv) = &*hook_gate;
            let mut hit = lock.lock().unwrap();
            *hit = true;
            cv.notify_all();
            while *hit {
                hit = cv.wait(hit).unwrap();
            }
        })));
    let root_id = revoked.root_id.clone();
    let workspace_id = revoked.workspace_id.clone();
    thread::scope(|scope| {
        let shell = &revoked.shell;
        let ws = workspace_id.clone();
        let handle = scope.spawn(move || shell.run_configured_opening(&ws));
        let _release_hook = ReleaseOnDrop(Arc::clone(&gate));
        let (lock, cv) = &*gate;
        let mut hit = lock.lock().unwrap();
        let start = Instant::now();
        while !*hit && start.elapsed() < Duration::from_secs(40) {
            let (next, timeout) = cv.wait_timeout(hit, Duration::from_secs(1)).unwrap();
            hit = next;
            if timeout.timed_out() && !*hit && start.elapsed() >= Duration::from_secs(40) {
                break;
            }
        }
        assert!(*hit, "overview recheck did not arrive");
        drop(hit);
        shell.revoke_directory(&root_id).unwrap();
        *gate.0.lock().unwrap() = false;
        gate.1.notify_all();
        let err = handle.join().unwrap().unwrap_err();
        assert_ne!(err.code, "ok");
    });
    assert_eq!(opening_count(&revoked.shell, &revoked.workspace_id), 0);
    assert_eq!(user_count(&revoked.shell, &revoked.workspace_id), 0);
    let card = revoked
        .shell
        .list_conversation(&revoked.workspace_id)
        .unwrap();
    assert!(card
        .iter()
        .all(|event| event.presentation != "folded_evidence" || event.kind != "local_scan_card"));
    assert_eq!(scripted_count(&revoked.shell.sidecar_stderr()), 0);
    assert_no_key(&revoked.shell.sidecar_stderr());
    assert!(!revoked.shell.stop_sidecar().unwrap().group_alive);

    let cancelled = ready("cancel", hold, 45_000);
    let ws = cancelled.workspace_id.clone();
    thread::scope(|scope| {
        let shell = &cancelled.shell;
        let ws_for_run = ws.clone();
        let handle = scope.spawn(move || shell.run_configured_opening(&ws_for_run));
        let start = Instant::now();
        while scripted_count(&shell.sidecar_stderr()) == 0
            && start.elapsed() < Duration::from_secs(40)
        {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(
            scripted_count(&shell.sidecar_stderr()) >= 1,
            "hold did not reach the scripted transport"
        );
        shell.cancel_onboarding(&ws).unwrap();
        let err = handle.join().unwrap().unwrap_err();
        assert_eq!(err.code, "cancelled");
    });
    assert_eq!(opening_count(&cancelled.shell, &cancelled.workspace_id), 0);
    assert!(!cancelled.shell.stop_sidecar().unwrap().group_alive);

    let timed = ready("timeout", hold, 12_000);
    let err = timed
        .shell
        .run_configured_opening(&timed.workspace_id)
        .unwrap_err();
    assert_eq!(err.code, "timeout");
    assert_eq!(opening_count(&timed.shell, &timed.workspace_id), 0);
    assert!(!timed.shell.stop_sidecar().unwrap().group_alive);

    let budget = ready("budget", read_then_text, 45_000);
    budget.shell.set_opening_read_budget(0);
    let err = budget
        .shell
        .run_configured_opening(&budget.workspace_id)
        .unwrap_err();
    assert_ne!(err.code, "ok");
    assert_eq!(opening_count(&budget.shell, &budget.workspace_id), 0);
    assert!(budget
        .shell
        .list_source_refs(&budget.workspace_id)
        .unwrap()
        .is_empty());
    assert!(!budget.shell.stop_sidecar().unwrap().group_alive);

    let mismatch = ready("mismatch", read_then_text, 45_000);
    mismatch.shell.set_mismatch_next_tool(true);
    let err = mismatch
        .shell
        .run_configured_opening(&mismatch.workspace_id)
        .unwrap_err();
    assert_ne!(err.code, "ok");
    assert_eq!(opening_count(&mismatch.shell, &mismatch.workspace_id), 0);
    assert_eq!(user_count(&mismatch.shell, &mismatch.workspace_id), 0);
    assert!(!mismatch.shell.stop_sidecar().unwrap().group_alive);
}

#[test]
fn protocol_negatives_and_process_cleanup_are_real_stdio() {
    let tmp = tempfile::tempdir().unwrap();
    let app_data = tmp.path().join("app-data");
    write_slot(
        &app_data,
        r#"{"responses":[{"kind":"text","text":"unused"}]}"#,
    );
    let shell = NativeShell::open(&tmp.path().join("business.sqlite")).unwrap();
    shell
        .configure_dev_sidecar(config(&app_data, 30_000))
        .unwrap();
    shell.start_configured_sidecar().unwrap();
    let probe = shell.probe_host_protocol().unwrap();
    assert!(probe.duplicate_rejected, "{probe:?}");
    assert!(probe.cross_run_rejected, "{probe:?}");
    assert!(probe.unknown_reply_rejected, "{probe:?}");
    assert_eq!(probe.scripted_invocations, 0);
    let pid = shell.sidecar_pid().unwrap();
    shell.close_sidecar_stdin().unwrap();
    let start = Instant::now();
    while shell.sidecar_status().connected && start.elapsed() < Duration::from_secs(5) {
        thread::sleep(Duration::from_millis(30));
    }
    assert!(
        !shell.sidecar_status().connected,
        "status stayed connected after stdin close: {:?}",
        shell.sidecar_status()
    );
    assert!(!shell.snapshot().unwrap().sidecar.connected);
    while pid_alive(pid) && start.elapsed() < Duration::from_secs(5) {
        thread::sleep(Duration::from_millis(30));
    }
    let stop = shell.stop_sidecar().unwrap();
    assert!(!stop.group_alive);
    assert!(!pid_alive(pid));

    shell.start_configured_sidecar().unwrap();
    let restarted = shell.sidecar_pid().unwrap();
    assert_ne!(restarted, pid);
    shell.kill_sidecar_child().unwrap();
    let start = Instant::now();
    while shell.sidecar_status().connected && start.elapsed() < Duration::from_secs(5) {
        thread::sleep(Duration::from_millis(20));
    }
    assert!(
        !shell.sidecar_status().connected,
        "status stayed connected after kill: {:?}",
        shell.sidecar_status()
    );
    assert!(!shell.snapshot().unwrap().sidecar.connected);
    while pid_alive(restarted) && start.elapsed() < Duration::from_secs(3) {
        thread::sleep(Duration::from_millis(20));
    }
    assert!(!pid_alive(restarted));
    let stop = shell.stop_sidecar().unwrap();
    assert!(!stop.group_alive);
    drop(shell);

    let shell = NativeShell::open(&tmp.path().join("drop.sqlite")).unwrap();
    shell
        .configure_dev_sidecar(config(&app_data, 30_000))
        .unwrap();
    shell.start_configured_sidecar().unwrap();
    let dropped = shell.sidecar_pid().unwrap();
    drop(shell);
    thread::sleep(Duration::from_millis(200));
    assert!(!pid_alive(dropped), "drop left a managed sidecar process");
}

struct ReleaseOnDrop(Arc<(Mutex<bool>, Condvar)>);

impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        if let Ok(mut held) = self.0 .0.lock() {
            *held = false;
        }
        self.0 .1.notify_all();
    }
}

#[test]
fn cancel_retry_rebinds_current_run_without_deleting_session_files() {
    let scripted = r#"{"responses":[{"kind":"hold","untilAbort":true},{"kind":"tool_call","name":"workspace.read_file","arguments":{"relativePath":"README.md"}},{"kind":"text","text":"Retry opening after cancel. Not StepFun."}]}"#;
    let ready = ready("retry-bind", scripted, 60_000);
    let ws = ready.workspace_id.clone();
    thread::scope(|scope| {
        let shell = &ready.shell;
        let ws_for_run = ws.clone();
        let handle = scope.spawn(move || shell.run_configured_opening(&ws_for_run));
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(40)
            && (shell.opening_session_binding(&ws).unwrap().is_none()
                || scripted_count(&shell.sidecar_stderr()) == 0)
        {
            thread::sleep(Duration::from_millis(40));
        }
        let first = shell
            .opening_session_binding(&ws)
            .unwrap()
            .expect("run.start did not bind before cancel");
        assert!(scripted_count(&shell.sidecar_stderr()) >= 1);
        shell.cancel_onboarding(&ws).unwrap();
        let err = handle.join().unwrap().unwrap_err();
        assert_eq!(err.code, "cancelled");
        let run_a = first.run_id.as_str().to_string();
        let session_a = first.session_ref.clone();
        let session_dir = ready.app_data.join("sessions").join(&ws);
        let before: Vec<_> = fs::read_dir(&session_dir)
            .unwrap()
            .map(|item| item.unwrap().path())
            .collect();
        assert!(!before.is_empty(), "pi session files missing before retry");
        shell.retry_onboarding(&ws).unwrap();
        let result = shell.run_configured_opening(&ws).unwrap();
        assert!(result.committed);
        assert_ne!(result.run_id, run_a);
        let bound = shell.opening_session_binding(&ws).unwrap().unwrap();
        assert_eq!(bound.run_id.as_str(), result.run_id);
        assert!(bound.session_ref.starts_with("pi:"));
        assert_ne!(bound.run_id.as_str(), run_a);
        for path in &before {
            assert!(path.exists(), "retry deleted {}", path.display());
        }
        assert!(
            fs::read_to_string(session_dir.join("index.json"))
                .unwrap()
                .contains(&session_a)
                || before.iter().any(|path| path.exists()),
            "old session reference disappeared"
        );
        assert_eq!(opening_count(shell, &ws), 1);
        assert_eq!(user_count(shell, &ws), 0);
        let checkpoint = shell.onboarding(&ws).unwrap();
        assert_eq!(
            checkpoint.active_run_id.as_ref().map(|id| id.as_str()),
            Some(result.run_id.as_str())
        );
        assert_no_key(&shell.sidecar_stderr());
        let stop = shell.stop_sidecar().unwrap();
        assert!(!stop.group_alive);
        assert!(stop.worker_stopped, "{stop:?}");
    });
}

#[test]
fn stalled_hook_stop_is_bounded_and_refuses_revival() {
    let scripted = r#"{"responses":[{"kind":"tool_call","name":"workspace.read_file","arguments":{"relativePath":"README.md"}},{"kind":"text","text":"should-not-commit"}]}"#;
    let ready = ready("stop-bound", scripted, 45_000);
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    let hook_gate = Arc::clone(&gate);
    ready
        .shell
        .set_before_tool_reply_hook(Some(Arc::new(move |_| {
            let (lock, cv) = &*hook_gate;
            let mut held = lock.lock().unwrap();
            *held = true;
            cv.notify_all();
            while *held {
                held = cv.wait(held).unwrap();
            }
        })));
    let ws = ready.workspace_id.clone();
    let pid = ready.shell.sidecar_pid().expect("node pid");
    thread::scope(|scope| {
        let shell = &ready.shell;
        let ws_for_run = ws.clone();
        let handle = scope.spawn(move || shell.run_configured_opening(&ws_for_run));
        let _release = ReleaseOnDrop(Arc::clone(&gate));
        let (lock, cv) = &*gate;
        let mut held = lock.lock().unwrap();
        let start = Instant::now();
        while !*held && start.elapsed() < Duration::from_secs(40) {
            let (next, timeout) = cv.wait_timeout(held, Duration::from_secs(1)).unwrap();
            held = next;
            if timeout.timed_out() && !*held && start.elapsed() >= Duration::from_secs(40) {
                break;
            }
        }
        assert!(*held, "tool hook did not run");
        drop(held);
        let started = Instant::now();
        let report = shell.stop_sidecar().unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(12),
            "stop was not bounded: {:?}",
            started.elapsed()
        );
        assert!(!report.worker_stopped, "{report:?}");
        assert!(!report.exited, "{report:?}");
        assert!(!report.group_alive, "{report:?}");
        assert!(!pid_alive(pid));
        assert!(!shell.sidecar_status().connected);
        assert!(!shell.snapshot().unwrap().sidecar.connected);
        let err = shell.start_configured_sidecar().unwrap_err();
        assert_eq!(err.code, "sidecar_stop_incomplete");
        *gate.0.lock().unwrap() = false;
        gate.1.notify_all();
        let err = handle.join().unwrap().unwrap_err();
        assert_ne!(err.code, "ok");
    });
    let start = Instant::now();
    loop {
        match ready.shell.start_configured_sidecar() {
            Ok(_) => break,
            Err(err)
                if err.code == "sidecar_stop_incomplete"
                    && start.elapsed() < Duration::from_secs(5) =>
            {
                thread::sleep(Duration::from_millis(30));
            }
            Err(err) => panic!("worker was not reaped: {err}"),
        }
    }
    let stop = ready.shell.stop_sidecar().unwrap();
    assert!(stop.worker_stopped, "{stop:?}");
    assert!(!stop.group_alive);
    assert!(!ready.shell.sidecar_status().connected);
}

fn kind_count(shell: &NativeShell, workspace_id: &str, kind: &str) -> usize {
    shell
        .list_conversation(workspace_id)
        .unwrap()
        .iter()
        .filter(|event| event.kind == kind)
        .count()
}

fn wait_terminal(events: &Mutex<Vec<RunStreamEvent>>) -> Vec<RunStreamEvent> {
    let start = Instant::now();
    loop {
        let guard = events.lock().unwrap();
        if guard.iter().any(|event| {
            matches!(
                event.event_type,
                "run_completed" | "run_cancelled" | "run_failed"
            )
        }) {
            return guard.clone();
        }
        drop(guard);
        if start.elapsed() > Duration::from_secs(45) {
            panic!("ordinary turn produced no terminal stream event");
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn assert_ordered(events: &[RunStreamEvent], run_id: &str) {
    assert!(!events.is_empty());
    let mut previous = 0_u64;
    for event in events {
        assert_eq!(event.schema_version, "hark.ui.v1");
        assert_eq!(event.run_id, run_id);
        assert!(event.seq > previous, "seq not monotonic: {events:?}");
        previous = event.seq;
    }
    assert_eq!(events.first().unwrap().event_type, "run_started");
    let completed = events
        .iter()
        .filter(|event| event.event_type == "run_completed");
    for event in completed {
        assert_eq!(event.payload.persistence_verified, Some(true));
        assert!(event.payload.persisted_message_id.is_some());
    }
}

#[test]
fn memory_tools_commit_real_receipts_and_recall_without_a_model() {
    let scripted = r#"{"responses":[{"kind":"tool_call","name":"workspace.read_file","arguments":{"relativePath":"README.md"}},{"kind":"text","text":"Synthetic opening, not a real model."},{"kind":"tool_call","name":"memory_propose_change","arguments":{"operation":"ADD","kind":"decision","content":"我决定先用 Tauri，Node 保底"}},{"kind":"tool_call","name":"opinion_propose_change","arguments":{"operation":"ADD","summary":"我决定先用 Tauri，Node 保底","evidenceRefs":[],"counterArguments":[],"uncertainties":["尚未比较运行时"]}},{"kind":"tool_call","name":"memory_recall","arguments":{"query":"保底"}},{"kind":"text","text":"Synthetic tool round completed."},{"kind":"tool_call","name":"memory_propose_change","arguments":{"operation":"ADD","kind":"decision","content":"采用 Bun"}},{"kind":"text","text":"Needs clarification; not saved."},{"kind":"tool_call","name":"memory_propose_change","arguments":{"operation":"ADD","kind":"decision","content":"我决定保留 CLI 入口"}},{"kind":"hold","untilAbort":true}]}"#;
    let ready = ready("memory-tools", scripted, 60_000);
    ready
        .shell
        .run_configured_opening(&ready.workspace_id)
        .unwrap();
    let ws = ready.shell.get_workspace(&ready.workspace_id).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let accepted = ready
        .shell
        .start_agent_turn(
            AgentTurnRequest {
                request_id: "memory-tool-round".into(),
                workspace_id: ready.workspace_id.clone(),
                conversation_id: ws.conversation_id.to_string(),
                user_prompt: "我决定先用 Tauri，Node 保底".into(),
            },
            TurnProgress::new(move |event| sink.lock().unwrap().push(event)),
        )
        .unwrap();
    let streamed = wait_terminal(&events);
    assert_eq!(
        streamed.last().unwrap().event_type,
        "run_completed",
        "{streamed:?}"
    );
    let receipts = ready
        .shell
        .list_memory_receipts(&ready.workspace_id)
        .unwrap();
    assert_eq!(receipts.len(), 1);
    assert!(receipts[0].recorded && receipts[0].committed_at.is_some());
    assert_eq!(
        receipts[0].source_message_id.as_deref(),
        Some(accepted.accepted_user_message.id.as_str())
    );
    let opinions = ready
        .shell
        .list_workspace_opinions(&ready.workspace_id)
        .unwrap();
    assert_eq!(opinions.len(), 1);
    assert!(opinions[0]
        .evidence_refs
        .contains(&accepted.accepted_user_message.id.to_string()));
    let rejected_events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&rejected_events);
    ready
        .shell
        .start_agent_turn(
            AgentTurnRequest {
                request_id: "memory-clarification-round".into(),
                workspace_id: ready.workspace_id.clone(),
                conversation_id: ws.conversation_id.to_string(),
                user_prompt: "我们决定不采用 Bun，继续使用 Node。".into(),
            },
            TurnProgress::new(move |event| sink.lock().unwrap().push(event)),
        )
        .unwrap();
    let terminal = wait_terminal(&rejected_events);
    assert_eq!(terminal.last().unwrap().event_type, "run_completed");
    assert_eq!(
        ready
            .shell
            .list_memory_receipts(&ready.workspace_id)
            .unwrap()
            .len(),
        1,
        "clarification is not a saved receipt"
    );

    let core = hark_core::Core::open(&ready.tmp.path().join("business.sqlite")).unwrap();
    let memories = core.list_workspace_memories(&ws.id).unwrap();
    assert_eq!(memories.len(), 1);
    let late = core.memory_propose_change(
        &hark_core::MemoryCallContext {
            workspace_id: ws.id.clone(),
            operation_id: "late-new-proposal".into(),
            current_user_message_id: Some(accepted.accepted_user_message.id.clone()),
            caller: hark_core::MemoryCaller::AgentRun {
                run_id: hark_core::RunId::parse(&accepted.run_id).unwrap(),
            },
        },
        &hark_core::MemoryChangeProposal {
            operation: hark_core::MemoryOperation::Add,
            kind: hark_core::MemoryNoteKind::Decision,
            content: "我决定先用 Tauri，Node 保底".into(),
            source_refs: vec![],
            target_id: None,
            expected_revision: None,
        },
    );
    assert!(
        late.is_err(),
        "finished model run must not append a new proposal"
    );
    let cancel_events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&cancel_events);
    let cancelled = ready
        .shell
        .start_agent_turn(
            AgentTurnRequest {
                request_id: "memory-before-cancel".into(),
                workspace_id: ready.workspace_id.clone(),
                conversation_id: ws.conversation_id.to_string(),
                user_prompt: "我决定保留 CLI 入口".into(),
            },
            TurnProgress::new(move |event| sink.lock().unwrap().push(event)),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while ready
        .shell
        .list_memory_receipts(&ready.workspace_id)
        .unwrap()
        .len()
        < 2
    {
        assert!(
            Instant::now() < deadline,
            "tool did not commit before cancel"
        );
        thread::sleep(Duration::from_millis(10));
    }
    ready
        .shell
        .cancel_agent_turn(&ready.workspace_id, &cancelled.run_id)
        .unwrap();
    let terminal = wait_terminal(&cancel_events);
    assert_eq!(terminal.last().unwrap().event_type, "run_cancelled");
    assert_eq!(
        kind_count(&ready.shell, &ready.workspace_id, "agent_message"),
        2
    );
    assert_eq!(
        ready
            .shell
            .list_memory_receipts(&ready.workspace_id)
            .unwrap()
            .len(),
        2
    );
    ready.shell.stop_sidecar().unwrap();
    drop(core);
    let restored = NativeShell::open(&ready.tmp.path().join("business.sqlite")).unwrap();
    assert_eq!(
        restored
            .list_memory_receipts(&ready.workspace_id)
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        restored
            .list_workspace_opinions(&ready.workspace_id)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn ordinary_turns_use_scripted_transport_not_a_real_model() {
    let scripted = r#"{"responses":[{"kind":"tool_call","name":"workspace.read_file","arguments":{"relativePath":"README.md"}},{"kind":"text","text":"Scripted opening. Not StepFun."},{"kind":"text","text":"scripted-chat-one"},{"kind":"text","text":"scripted-chat-two"},{"kind":"hold","untilAbort":true}]}"#;
    let ready = ready("chat", scripted, 60_000);
    let opening = ready
        .shell
        .run_configured_opening(&ready.workspace_id)
        .unwrap();
    assert!(opening.committed);
    assert!(opening.session_ref.starts_with("pi:"));
    let conversation_id = ready
        .shell
        .get_workspace(&ready.workspace_id)
        .unwrap()
        .conversation_id
        .as_str()
        .to_string();
    let events = Arc::new(Mutex::new(Vec::<RunStreamEvent>::new()));
    let turn = |request_id: &str, prompt: &str| {
        events.lock().unwrap().clear();
        let log = Arc::clone(&events);
        let accepted = ready
            .shell
            .start_agent_turn(
                AgentTurnRequest {
                    request_id: request_id.to_string(),
                    workspace_id: ready.workspace_id.clone(),
                    conversation_id: conversation_id.clone(),
                    user_prompt: prompt.to_string(),
                },
                TurnProgress::new(move |event| log.lock().unwrap().push(event)),
            )
            .unwrap();
        let streamed = wait_terminal(&events);
        (accepted, streamed)
    };
    let before = scripted_count(&ready.shell.sidecar_stderr());
    let (first, first_events) = turn("req-chat-1", "第一句");
    assert_eq!(first.accepted_user_message.body, "第一句");
    assert_ordered(&first_events, &first.run_id);
    assert!(first_events
        .iter()
        .any(|event| event.event_type == "text_delta"));
    assert_eq!(first_events.last().unwrap().event_type, "run_completed");
    assert_eq!(
        kind_count(&ready.shell, &ready.workspace_id, "user_message"),
        1
    );
    assert_eq!(
        kind_count(&ready.shell, &ready.workspace_id, "agent_message"),
        1
    );
    let assistant = ready
        .shell
        .list_conversation(&ready.workspace_id)
        .unwrap()
        .into_iter()
        .find(|event| event.kind == "agent_message")
        .unwrap();
    assert_eq!(assistant.body, "scripted-chat-one");
    assert!(assistant.source_ids.is_empty());
    let after_one = scripted_count(&ready.shell.sidecar_stderr());
    assert!(after_one > before);
    events.lock().unwrap().clear();
    let replay = ready
        .shell
        .start_agent_turn(
            AgentTurnRequest {
                request_id: "req-chat-1".to_string(),
                workspace_id: ready.workspace_id.clone(),
                conversation_id: conversation_id.clone(),
                user_prompt: "第一句".to_string(),
            },
            TurnProgress::new({
                let log = Arc::clone(&events);
                move |event| log.lock().unwrap().push(event)
            }),
        )
        .unwrap();
    assert_eq!(replay.run_id, first.run_id);
    assert_eq!(
        replay.accepted_user_message.id,
        first.accepted_user_message.id
    );
    let replayed = wait_terminal(&events);
    assert_ordered(&replayed, &first.run_id);
    assert_eq!(replayed.last().unwrap().event_type, "run_completed");
    assert_eq!(scripted_count(&ready.shell.sidecar_stderr()), after_one);
    assert_eq!(
        kind_count(&ready.shell, &ready.workspace_id, "user_message"),
        1
    );
    assert_eq!(
        kind_count(&ready.shell, &ready.workspace_id, "agent_message"),
        1
    );
    let (second, second_events) = turn("req-chat-2", "第二句");
    assert_ne!(second.run_id, first.run_id);
    assert_ordered(&second_events, &second.run_id);
    assert_eq!(second_events.last().unwrap().event_type, "run_completed");
    assert_eq!(
        kind_count(&ready.shell, &ready.workspace_id, "user_message"),
        2
    );
    assert_eq!(
        kind_count(&ready.shell, &ready.workspace_id, "agent_message"),
        2
    );
    let binding = ready
        .shell
        .opening_session_binding(&ready.workspace_id)
        .unwrap()
        .unwrap();
    assert_eq!(binding.session_ref, opening.session_ref);
    assert_eq!(binding.run_id.as_str(), opening.run_id);
    assert_eq!(
        ready
            .shell
            .latest_ordinary_session_ref(&ready.workspace_id)
            .unwrap()
            .as_deref(),
        Some(opening.session_ref.as_str())
    );
    let (third, _) = {
        events.lock().unwrap().clear();
        let log = Arc::clone(&events);
        let accepted = ready
            .shell
            .start_agent_turn(
                AgentTurnRequest {
                    request_id: "req-chat-cancel".to_string(),
                    workspace_id: ready.workspace_id.clone(),
                    conversation_id: conversation_id.clone(),
                    user_prompt: "取消这句".to_string(),
                },
                TurnProgress::new(move |event| log.lock().unwrap().push(event)),
            )
            .unwrap();
        let status = ready
            .shell
            .cancel_agent_turn(&ready.workspace_id, &accepted.run_id)
            .unwrap();
        assert_eq!(status.state, "cancelled");
        let streamed = wait_terminal(&events);
        assert_eq!(streamed.last().unwrap().event_type, "run_cancelled");
        (accepted, streamed)
    };
    let _ = third;
    assert_eq!(
        kind_count(&ready.shell, &ready.workspace_id, "user_message"),
        3
    );
    assert_eq!(
        kind_count(&ready.shell, &ready.workspace_id, "agent_message"),
        2
    );
    assert_eq!(opening_count(&ready.shell, &ready.workspace_id), 1);
    let saved = ready.shell.list_conversation(&ready.workspace_id).unwrap();
    let db = ready.tmp.path().join("business.sqlite");
    let workspace_id = ready.workspace_id.clone();
    let session_ref = opening.session_ref.clone();
    let opening_run = opening.run_id.clone();
    let stderr = ready.shell.sidecar_stderr();
    assert_no_key(&stderr);
    let stop = ready.shell.stop_sidecar().unwrap();
    assert!(!stop.group_alive);
    drop(ready.shell);
    let restored = NativeShell::open(&db).unwrap();
    let again = restored.list_conversation(&workspace_id).unwrap();
    assert_eq!(again.len(), saved.len());
    assert_eq!(
        again
            .iter()
            .map(|event| event.id.as_str())
            .collect::<Vec<_>>(),
        saved
            .iter()
            .map(|event| event.id.as_str())
            .collect::<Vec<_>>()
    );
    assert_eq!(kind_count(&restored, &workspace_id, "agent_message"), 2);
    assert_eq!(kind_count(&restored, &workspace_id, "user_message"), 3);
    let bound = restored
        .opening_session_binding(&workspace_id)
        .unwrap()
        .unwrap();
    assert_eq!(bound.session_ref, session_ref);
    assert_eq!(bound.run_id.as_str(), opening_run);
    println!(
        "CONVERSATION_EVIDENCE {{\"transport\":\"scripted\",\"stepFun\":\"unverified\",\"openingRun\":\"{opening_run}\",\"sessionRef\":\"{session_ref}\",\"userMessages\":3,\"agentMessages\":2,\"realModel\":false}}"
    );
}
