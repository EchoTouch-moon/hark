//! Real Node + Pi SDK + Core stdio probe. The model transport is scripted.
//! It is not a StepFun call and it does not read a real key.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use hark_native_shell::{
    ConfirmRequest, DevSidecarConfig, NativeShell, Selection, FRONTEND_COMMANDS,
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
