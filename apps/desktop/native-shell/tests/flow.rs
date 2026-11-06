use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use hark_native_shell::{
    business_db_path, decide_window_close, sidecar_status, AuthorizeRequest, ConfirmRequest,
    NativeShell, NotConnectedHost, OpeningHost, Selection, SourceRefRequest, UserMessageRequest,
    WindowCloseDecision, WorkspaceRef, CONTROLLED_PICK_ENTRY, FRONTEND_COMMANDS, PICK_TTL_MS,
};

fn synth_project(root: &Path) {
    fs::create_dir_all(root.join("app-a")).unwrap();
    fs::create_dir_all(root.join("app-b")).unwrap();
    fs::create_dir_all(root.join("node_modules")).unwrap();
    fs::write(root.join("README.md"), "synthetic local project\n").unwrap();
    fs::write(root.join("app-a/package.json"), "{\"name\":\"app-a\"}\n").unwrap();
    fs::write(
        root.join("app-b/Cargo.toml"),
        "[package]\nname = \"app-b\"\n",
    )
    .unwrap();
    fs::write(root.join(".env"), "TOKEN=synthetic-not-a-key\n").unwrap();
    fs::write(root.join("node_modules/left.js"), "ignored\n").unwrap();
}

fn fingerprint(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    for rel in [
        "README.md",
        "app-a/package.json",
        "app-b/Cargo.toml",
        ".env",
        "node_modules/left.js",
    ] {
        out.push((rel.to_string(), fs::read(root.join(rel)).unwrap()));
    }
    out
}

fn open_shell(dir: &Path) -> NativeShell {
    NativeShell::open(&dir.join("business.sqlite")).unwrap()
}

#[test]
fn command_surface_rejects_path_success_and_model_completion() {
    let forbidden = [
        "authorize_directory",
        "set_service_grant",
        "commit_agent_opening",
        "mark_analyzing",
        "record_model_unavailable",
        "read_workspace_file",
        "plugin:shell",
        "plugin:fs",
        "allow-all",
        "set_scan_hold",
        "set_read_hold",
    ];
    for name in forbidden {
        assert!(
            !FRONTEND_COMMANDS.contains(&name),
            "{name} must not be a frontend command"
        );
    }
    assert!(FRONTEND_COMMANDS.contains(&"confirm_import"));
    assert_eq!(CONTROLLED_PICK_ENTRY, "NativeShell::stage_native_pick");
    assert!(serde_json::from_str::<AuthorizeRequest>(
        r#"{"pickToken":"pick_x","path":"/tmp/forged"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<ConfirmRequest>(
        r#"{"rootId":"root_x","scanId":"scan_x","selection":{"kind":"single"},"success":true,"approved":true,"risk":"low"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<WorkspaceRef>(
        r#"{"workspaceId":"ws_x","relativePath":"../secret"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<UserMessageRequest>(
        r#"{"workspaceId":"ws_x","text":"hi","completed":true}"#
    )
    .is_err());
    assert!(serde_json::from_str::<SourceRefRequest>(
        r#"{"workspaceId":"ws_x","sourceId":"src_x","path":"/tmp"}"#
    )
    .is_err());
    let cap: serde_json::Value =
        serde_json::from_str(include_str!("../../src-tauri/capabilities/default.json")).unwrap();
    let permissions = cap["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    for permission in &permissions {
        assert!(!permission.contains("allow-all"), "{permission}");
        assert!(!permission.starts_with("fs:"), "{permission}");
        assert!(!permission.starts_with("shell:"), "{permission}");
        assert!(!permission.starts_with("dialog:"), "{permission}");
        assert_ne!(permission, "core:default");
        for closed in [
            "commit-agent-opening",
            "set-service-grant",
            "authorize-directory",
            "mark-analyzing",
        ] {
            assert!(!permission.contains(closed), "{permission}");
        }
    }
    for command in FRONTEND_COMMANDS {
        let permission = format!("allow-{}", command.replace('_', "-"));
        assert!(
            permissions.iter().any(|item| item == &permission),
            "capability missing {permission}"
        );
    }
    let build_rs = include_str!("../../src-tauri/build.rs");
    for command in FRONTEND_COMMANDS {
        assert!(
            build_rs.contains(&format!("\"{command}\"")),
            "build.rs missing {command}"
        );
    }
}

#[test]
fn pending_token_is_single_use_and_not_a_path() {
    let tmp = tempfile_dir("token");
    let project = tmp.join("proj");
    fs::create_dir_all(&project).unwrap();
    let now = Arc::new(AtomicU64::new(1_700_000_000_000));
    let clock = now.clone();
    let shell = NativeShell::open_with_clock(&tmp.join("business.sqlite"), move || {
        clock.load(Ordering::SeqCst)
    })
    .unwrap();
    let ticket = shell.stage_native_pick(&project).unwrap();
    let encoded = serde_json::to_string(&ticket).unwrap();
    assert!(!encoded.contains(project.to_str().unwrap()));
    assert!(ticket.pick_token.starts_with("pick_"));
    assert_eq!(ticket.pick_token.len(), 5 + 32);
    assert_eq!(ticket.expires_at_unix_ms, 1_700_000_000_000 + PICK_TTL_MS);
    assert!(ticket.remote_model.contains("未调用"));
    let root = shell.authorize_picked(&ticket.pick_token).unwrap();
    assert_eq!(serde_json::to_value(&root).unwrap()["status"], "active");
    let again = shell.authorize_picked(&ticket.pick_token).unwrap_err();
    assert_eq!(again.code, "pick_not_found");
    let forged = shell.authorize_picked("pick_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert_eq!(forged.unwrap_err().code, "pick_not_found");
    let _ = now;
}

#[test]
fn expired_token_does_not_authorize() {
    let tmp = tempfile_dir("expired");
    let project = tmp.join("proj");
    fs::create_dir_all(&project).unwrap();
    let now = Arc::new(AtomicU64::new(10_000));
    let clock = now.clone();
    let shell = NativeShell::open_with_clock(&tmp.join("business.sqlite"), move || {
        clock.load(Ordering::SeqCst)
    })
    .unwrap();
    let ticket = shell.stage_native_pick(&project).unwrap();
    now.store(ticket.expires_at_unix_ms + 1, Ordering::SeqCst);
    let err = shell.authorize_picked(&ticket.pick_token).unwrap_err();
    assert_eq!(err.code, "pick_expired");
    assert!(shell.list_roots().unwrap().is_empty());
}

#[test]
fn file_symlink_and_unknown_token_do_not_grant() {
    let tmp = tempfile_dir("neg");
    let project = tmp.join("proj");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("note.txt"), "x").unwrap();
    let shell = open_shell(&tmp);
    assert_eq!(
        shell
            .stage_native_pick(&project.join("note.txt"))
            .unwrap_err()
            .code,
        "pick_not_a_directory"
    );
    assert_eq!(
        shell
            .stage_native_pick(&tmp.join("missing"))
            .unwrap_err()
            .code,
        "pick_not_a_directory"
    );
    let link = tmp.join("link");
    std::os::unix::fs::symlink(&project, &link).unwrap();
    let ticket = shell.stage_native_pick(&link).unwrap();
    let err = shell.authorize_picked(&ticket.pick_token).unwrap_err();
    assert_eq!(err.code, "symlink_rejected");
    assert_eq!(
        shell.authorize_picked(&ticket.pick_token).unwrap_err().code,
        "pick_not_found"
    );
    assert!(shell.list_roots().unwrap().is_empty());
}

#[test]
fn select_scan_confirm_card_and_restart_without_model() {
    let tmp = tempfile_dir("flow");
    let project = tmp.join("synth");
    synth_project(&project);
    let before = fingerprint(&project);
    let db = tmp.join("state").join("business.sqlite");
    let workspace_id = {
        let shell = NativeShell::open(&db).unwrap();
        assert!(shell.list_roots().unwrap().is_empty());
        let ticket = shell.stage_native_pick(&project).unwrap();
        let root = shell.authorize_picked(&ticket.pick_token).unwrap();
        let scan = shell.scan_root(root.id.as_str()).unwrap();
        let status = serde_json::to_value(&scan.status).unwrap();
        assert!(status == "completed" || status == "limited", "{status}");
        assert!(scan.default_single_project);
        let ignored = scan
            .ignored
            .iter()
            .map(|item| format!("{}:{}", item.relative_path, item.reason))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(ignored.contains(".env"), "{ignored}");
        assert!(ignored.contains("node_modules"), "{ignored}");
        let selected = scan
            .candidates
            .iter()
            .filter(|cand| cand.relative_path == "app-a" || cand.relative_path == "app-b")
            .map(|cand| cand.id.as_str().to_string())
            .collect::<Vec<_>>();
        assert_eq!(selected.len(), 2, "{:?}", scan.candidates);
        let forged = shell.confirm_import(&ConfirmRequest {
            root_id: root.id.as_str().to_string(),
            scan_id: scan.id.as_str().to_string(),
            selection: Selection::Selected {
                candidate_ids: vec!["cand_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()],
            },
        });
        assert_eq!(forged.unwrap_err().code, "candidate_not_in_scan");
        let root_and_child = {
            let mut ids = selected.clone();
            ids.push(
                scan.candidates
                    .iter()
                    .find(|cand| cand.relative_path.is_empty())
                    .unwrap()
                    .id
                    .as_str()
                    .to_string(),
            );
            shell.confirm_import(&ConfirmRequest {
                root_id: root.id.as_str().to_string(),
                scan_id: scan.id.as_str().to_string(),
                selection: Selection::Selected { candidate_ids: ids },
            })
        };
        assert_eq!(root_and_child.unwrap_err().code, "overlap_refused");
        let confirmed = shell
            .confirm_import(&ConfirmRequest {
                root_id: root.id.as_str().to_string(),
                scan_id: scan.id.as_str().to_string(),
                selection: Selection::Selected {
                    candidate_ids: selected,
                },
            })
            .unwrap();
        assert_eq!(confirmed.workspaces.len(), 2);
        assert!(!confirmed.replayed);
        let ws = &confirmed.workspaces[0];
        let report = shell.selective_key_read(ws.id.as_str()).unwrap();
        assert!(report
            .sources
            .iter()
            .any(|src| src.relative_path.ends_with("README.md")
                || src.relative_path.ends_with("package.json")
                || src.relative_path.ends_with("Cargo.toml")));
        assert!(report
            .sources
            .iter()
            .all(|src| !src.relative_path.ends_with(".env")));
        let card = shell.commit_local_scan_card(ws.id.as_str()).unwrap();
        assert!(!card.replayed);
        assert_eq!(card.event.kind, "local_scan_card");
        let again = shell.commit_local_scan_card(ws.id.as_str()).unwrap();
        assert!(again.replayed);
        assert_eq!(again.event.id, card.event.id);
        let onboarding = shell.onboarding(ws.id.as_str()).unwrap();
        assert_eq!(onboarding.state, "waiting_for_model_auth");
        assert!(!onboarding.model_analyzed);
        assert!(!onboarding.opening_presented);
        assert!(onboarding.active_run_id.is_none());
        assert_eq!(onboarding.model_status, "disabled");
        let overview = shell.workspace_overview(ws.id.as_str()).unwrap();
        assert!(!overview.model_inference);
        assert!(!overview.model_analyzed);
        let grants = shell.service_grants(ws.id.as_str()).unwrap();
        assert!(grants.iter().all(|grant| {
            serde_json::to_value(&grant.status).unwrap() == "disabled" && grant.provider.is_none()
        }));
        shell
            .append_user_message(ws.id.as_str(), "只是本地备注")
            .unwrap();
        let events = shell.list_conversation(ws.id.as_str()).unwrap();
        assert!(events.iter().any(|event| event.kind == "local_scan_card"));
        assert!(events
            .iter()
            .all(|event| event.kind != "agent_opening_message"));
        let stored = shell.get_scan(scan.id.as_str()).unwrap();
        assert!(!stored.ignored.is_empty());
        ws.id.as_str().to_string()
    };
    assert_eq!(fingerprint(&project), before);
    let restored = NativeShell::open(&db).unwrap();
    assert_eq!(restored.list_roots().unwrap().len(), 1);
    let events = restored.list_conversation(&workspace_id).unwrap();
    assert!(events.iter().any(|event| event.kind == "local_scan_card"));
    assert!(events.iter().any(|event| event.kind == "user_message"));
    assert!(events
        .iter()
        .all(|event| event.kind != "agent_opening_message"));
    let onboarding = restored.onboarding(&workspace_id).unwrap();
    assert_eq!(onboarding.state, "waiting_for_model_auth");
    assert!(!onboarding.model_analyzed);
    let snapshot = restored.snapshot().unwrap();
    assert_eq!(snapshot.remote_model_transport, "closed_no_approved_key");
    assert!(!snapshot.sidecar.connected);
    assert_eq!(snapshot.workspaces.len(), 2);
}

#[test]
fn pause_revoke_cancel_and_retry_do_not_invent_an_opening() {
    let tmp = tempfile_dir("authz");
    let project = tmp.join("proj");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("README.md"), "readme\n").unwrap();
    let shell = open_shell(&tmp);
    let ticket = shell.stage_native_pick(&project).unwrap();
    let root = shell.authorize_picked(&ticket.pick_token).unwrap();
    shell.pause_directory(root.id.as_str()).unwrap();
    assert_eq!(
        shell.scan_root(root.id.as_str()).unwrap_err().code,
        "root_paused"
    );
    shell.resume_directory(root.id.as_str()).unwrap();
    shell.arm_scan_cancel(root.id.as_str()).unwrap();
    let cancelled = shell.scan_root(root.id.as_str()).unwrap();
    assert_eq!(
        serde_json::to_value(&cancelled.status).unwrap(),
        "cancelled"
    );
    let refused = shell.confirm_import(&ConfirmRequest {
        root_id: root.id.as_str().to_string(),
        scan_id: cancelled.id.as_str().to_string(),
        selection: Selection::Single,
    });
    assert_eq!(refused.unwrap_err().code, "scan_not_confirmable");
    assert_eq!(
        shell.cancel_scan(root.id.as_str()).unwrap_err().code,
        "scan_not_running"
    );
    let scan = shell.scan_root(root.id.as_str()).unwrap();
    let confirmed = shell
        .confirm_import(&ConfirmRequest {
            root_id: root.id.as_str().to_string(),
            scan_id: scan.id.as_str().to_string(),
            selection: Selection::Single,
        })
        .unwrap();
    let ws = confirmed.workspaces[0].id.as_str().to_string();
    shell.selective_key_read(&ws).unwrap();
    shell.commit_local_scan_card(&ws).unwrap();
    let cancelled_onboarding = shell.cancel_onboarding(&ws).unwrap();
    assert_eq!(cancelled_onboarding.state, "cancelled");
    let retried = shell.retry_onboarding(&ws).unwrap();
    assert_eq!(retried.state, "workspace_created");
    assert!(retried.active_run_id.is_none());
    let events = shell.list_conversation(&ws).unwrap();
    assert!(events
        .iter()
        .all(|event| event.kind != "agent_opening_message"));
    shell.revoke_directory(root.id.as_str()).unwrap();
    let read_err = shell.selective_key_read(&ws).unwrap_err();
    assert_eq!(read_err.code, "root_revoked");
    assert!(!shell.list_conversation(&ws).unwrap().is_empty());
    assert_eq!(shell.cancel_read(&ws).unwrap_err().code, "read_not_running");
    assert_eq!(
        shell.append_user_message(&ws, "   ").unwrap_err().code,
        "invalid_message"
    );
}

#[test]
fn sqlite_path_stays_in_app_data_and_host_is_closed() {
    let app_data = Path::new("/tmp/hark-app-data-example");
    let db = business_db_path(app_data);
    assert!(db.starts_with(app_data));
    assert!(db.ends_with("hark-r1/business.sqlite"));
    let project = Path::new("/tmp/hark-synth-project");
    assert!(!db.starts_with(project));
    let status = sidecar_status();
    assert!(!status.connected);
    assert_eq!(status.windows_job_object, "unverified_no_sidecar");
    let host = NotConnectedHost;
    assert_eq!(
        host.start_opening(&hark_native_shell::IssuedOpeningRun {
            workspace_id: "ws".into(),
            run_id: "run".into(),
        })
        .unwrap_err(),
        "sidecar_not_connected"
    );
    assert_eq!(decide_window_close(false), WindowCloseDecision::HideToTray);
    assert_eq!(decide_window_close(true), WindowCloseDecision::AllowQuit);
    let tmp = tempfile_dir("quit");
    let shell = open_shell(&tmp);
    assert!(!shell.quit_requested());
    shell.request_quit();
    assert!(shell.quit_requested());
    assert_eq!(
        shell.read_workspace_file_closed().unwrap_err().code,
        "path_read_closed"
    );
}

/// First caller waits until `release`. Later callers return immediately so an
/// unfixed second invoke cannot deadlock the negative test.
struct HoldGate {
    entered: Mutex<bool>,
    entered_cv: Condvar,
    release: Mutex<bool>,
    release_cv: Condvar,
    callers: AtomicUsize,
}

impl HoldGate {
    fn new() -> Self {
        Self {
            entered: Mutex::new(false),
            entered_cv: Condvar::new(),
            release: Mutex::new(false),
            release_cv: Condvar::new(),
            callers: AtomicUsize::new(0),
        }
    }

    fn callback(self: &Arc<Self>) -> Arc<dyn Fn() + Send + Sync> {
        let gate = Arc::clone(self);
        Arc::new(move || {
            if gate.callers.fetch_add(1, Ordering::SeqCst) != 0 {
                return;
            }
            {
                let mut entered = gate.entered.lock().unwrap();
                *entered = true;
                gate.entered_cv.notify_all();
            }
            let mut release = gate.release.lock().unwrap();
            while !*release {
                release = gate.release_cv.wait(release).unwrap();
            }
        })
    }

    fn wait_entered(&self) {
        let mut entered = self.entered.lock().unwrap();
        while !*entered {
            entered = self.entered_cv.wait(entered).unwrap();
        }
    }

    fn release(&self) {
        let mut release = self.release.lock().unwrap();
        *release = true;
        self.release_cv.notify_all();
    }
}

struct ReleaseOnDrop<'a>(&'a HoldGate);

impl Drop for ReleaseOnDrop<'_> {
    fn drop(&mut self) {
        self.0.release();
    }
}

fn confirm_workspace(shell: &NativeShell, project: &Path) -> (String, String) {
    let ticket = shell.stage_native_pick(project).unwrap();
    let root = shell.authorize_picked(&ticket.pick_token).unwrap();
    let scan = shell.scan_root(root.id.as_str()).unwrap();
    let confirmed = shell
        .confirm_import(&ConfirmRequest {
            root_id: root.id.as_str().to_string(),
            scan_id: scan.id.as_str().to_string(),
            selection: Selection::Single,
        })
        .unwrap();
    (
        root.id.as_str().to_string(),
        confirmed.workspaces[0].id.as_str().to_string(),
    )
}

#[test]
fn overlapping_scan_root_rejects_second_call_and_cancel_hits_the_original() {
    let tmp = tempfile_dir("overlap-scan");
    let project = tmp.join("proj");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("README.md"), "synthetic overlap scan\n").unwrap();
    let shell = Arc::new(open_shell(&tmp));
    let ticket = shell.stage_native_pick(&project).unwrap();
    let root_id = shell
        .authorize_picked(&ticket.pick_token)
        .unwrap()
        .id
        .as_str()
        .to_string();
    let gate = Arc::new(HoldGate::new());
    shell.set_scan_hold(Some(gate.callback())).unwrap();
    let worker_shell = Arc::clone(&shell);
    let worker_root = root_id.clone();
    let worker = thread::spawn(move || worker_shell.scan_root(&worker_root));
    let release = ReleaseOnDrop(&gate);
    gate.wait_entered();
    let second = shell.scan_root(&root_id);
    let Err(busy) = second else {
        panic!("overlapping scan_root returned success; it replaced the running cancel flag");
    };
    assert_eq!(busy.code, "scan_already_running");
    shell
        .cancel_scan(&root_id)
        .expect("busy must not delete the original flag; cancel must still hit it");
    drop(release);
    let original = worker.join().unwrap().unwrap();
    assert_eq!(
        serde_json::to_value(&original.status).unwrap(),
        "cancelled",
        "cancel must hit the original scan, not a replacement flag"
    );
    assert_eq!(
        shell.cancel_scan(&root_id).unwrap_err().code,
        "scan_not_running",
        "the original must clear its own flag only after it finishes"
    );
    shell.set_scan_hold(None).unwrap();
    let retried = shell.scan_root(&root_id).unwrap();
    assert_ne!(
        serde_json::to_value(&retried.status).unwrap(),
        "cancelled",
        "retry after the original finishes must be allowed"
    );
}

#[test]
fn overlapping_selective_key_read_rejects_second_call_and_cancel_hits_the_original() {
    let tmp = tempfile_dir("overlap-read");
    let project = tmp.join("proj");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("README.md"), "synthetic overlap read\n").unwrap();
    let shell = Arc::new(open_shell(&tmp));
    let (_root_id, workspace_id) = confirm_workspace(&shell, &project);
    let gate = Arc::new(HoldGate::new());
    shell.set_read_hold(Some(gate.callback())).unwrap();
    let worker_shell = Arc::clone(&shell);
    let worker_ws = workspace_id.clone();
    let worker = thread::spawn(move || worker_shell.selective_key_read(&worker_ws));
    let release = ReleaseOnDrop(&gate);
    gate.wait_entered();
    let second = shell.selective_key_read(&workspace_id);
    let Err(busy) = second else {
        panic!(
            "overlapping selective_key_read returned success; it replaced the running cancel flag"
        );
    };
    assert_eq!(busy.code, "read_already_running");
    shell
        .cancel_read(&workspace_id)
        .expect("busy must not delete the original flag; cancel must still hit it");
    drop(release);
    let original = worker.join().unwrap().unwrap();
    assert!(
        original.skipped.iter().any(|item| item == "cancelled"),
        "cancel must hit the original read, not a replacement flag: {:?}",
        original.skipped
    );
    assert_eq!(
        shell.cancel_read(&workspace_id).unwrap_err().code,
        "read_not_running",
        "the original must clear its own flag only after it finishes"
    );
    shell.set_read_hold(None).unwrap();
    let retried = shell.selective_key_read(&workspace_id).unwrap();
    assert!(
        !retried.skipped.iter().any(|item| item == "cancelled"),
        "retry after the original finishes must be allowed"
    );
    assert!(!retried.sources.is_empty());
}

fn tempfile_dir(name: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("hark-native-{name}-{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}
