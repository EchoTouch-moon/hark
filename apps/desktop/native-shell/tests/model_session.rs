//! Synthetic session key stays in memory. Configure does not call the model.

use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use hark_native_shell::{business_db_path, NativeShell, Selection, ConfirmRequest};

const SYNTH: &str = "hark-session-test-key";

fn walk_contains(dir: &Path, needle: &str) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if walk_contains(&path, needle) {
                return true;
            }
            continue;
        }
        if fs::read(&path).ok().is_some_and(|bytes| {
            String::from_utf8_lossy(&bytes).contains(needle)
        }) {
            return true;
        }
    }
    false
}

#[test]
fn synthetic_key_does_not_fetch_or_land_and_grant_is_per_workspace() {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let tmp = std::env::temp_dir().join(format!("hark-model-session-{nanos}"));
    fs::create_dir_all(&tmp).unwrap();
    let project = tmp.join("proj");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("README.md"), "synthetic local project\n").unwrap();
    let db = business_db_path(&tmp);
    let shell = NativeShell::open(&db).unwrap();
    let before = shell.snapshot().unwrap();
    assert_eq!(before.remote_model_transport, "closed_no_approved_key");

    let status = shell.configure_stepfun_session(SYNTH).unwrap();
    assert!(status.configured);
    assert!(!status.authenticated);
    assert!(status.dev_only);
    assert!(status.restart_requires_key);
    assert!(status.sidecar_connected);
    assert_eq!(status.provider, "stepfun");
    assert_eq!(status.model, "step-3.7-flash");
    assert_eq!(status.base_url, "https://api.stepfun.com/step_plan");

    let snap = serde_json::to_string(&shell.snapshot().unwrap()).unwrap();
    assert!(snap.contains("stepfun_session_memory"));
    assert!(!snap.contains(SYNTH), "snapshot contained the session key");
    assert!(!walk_contains(&tmp, SYNTH), "session key landed in app data");
    let stderr = shell.sidecar_stderr();
    assert!(
        !stderr.contains("api.stepfun.com") && !stderr.contains("401"),
        "configure contacted StepFun"
    );

    let pid = shell.sidecar_pid().expect("sidecar pid");
    let args = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "args="])
        .output()
        .unwrap();
    assert!(
        !String::from_utf8_lossy(&args.stdout).contains(SYNTH),
        "session key was passed in argv"
    );

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
    let grants = shell.service_grants(&workspace_id).unwrap();
    assert!(grants.iter().any(|grant| grant.service.as_str() == "model" && grant.status.as_str() != "enabled"));
    let enabled = shell.set_model_grant(&workspace_id, true).unwrap();
    assert_eq!(enabled.status.as_str(), "enabled");
    assert_eq!(enabled.provider.as_deref(), Some("stepfun"));
    assert_eq!(enabled.model.as_deref(), Some("step-3.7-flash"));
    let disabled = shell.set_model_grant(&workspace_id, false).unwrap();
    assert_eq!(disabled.status.as_str(), "disabled");
    assert!(disabled.provider.is_none());

    let cleared = shell.clear_stepfun_session().unwrap();
    assert!(!cleared.configured);
    assert!(!cleared.sidecar_connected);
    assert_eq!(
        shell.snapshot().unwrap().remote_model_transport,
        "closed_no_approved_key"
    );
    assert!(!walk_contains(&tmp, SYNTH), "clear left the session key on disk");
    let _ = fs::remove_dir_all(&tmp);
}
