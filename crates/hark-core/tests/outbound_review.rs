#![cfg(all(unix, feature = "outbound-review"))]

use chrono::Utc;
use hark_core::{
    CancelFlag, ConfirmImport, ConversationRunStart, Core, ImportMode, OutboundBinding,
    OutboundSource, ScanBudget, ServiceGrantUpdate, ServiceKind, ServiceStatus,
    STEPFUN_OUTBOUND_ENDPOINT, STEPFUN_OUTBOUND_MODEL,
};
use std::fs;

struct Fixture {
    _tmp: tempfile::TempDir,
    db: std::path::PathBuf,
    root: std::path::PathBuf,
    core: Core,
    binding: OutboundBinding,
}

impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("synthetic-project");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("README.md"), "synthetic readme").unwrap();
        let db = tmp.path().join("hark.db");
        let core = Core::open(&db).unwrap();
        let root_record = core.authorize_directory(&root).unwrap();
        let budget = ScanBudget::default();
        let scan = core
            .run_initial_scan(&root_record.id, &budget, &CancelFlag::new())
            .unwrap();
        let workspace = core
            .confirm_import(&ConfirmImport {
                root_id: root_record.id.clone(),
                scan_id: scan.id,
                mode: ImportMode::SingleProject,
                enable_model_initial_read: false,
            })
            .unwrap()
            .workspaces
            .remove(0);
        core.set_service_grant(&ServiceGrantUpdate {
            workspace_id: workspace.id.clone(),
            service: ServiceKind::Model,
            status: ServiceStatus::Enabled,
            provider: Some("stepfun".into()),
            model: Some(STEPFUN_OUTBOUND_MODEL.into()),
        })
        .unwrap();
        let source = core
            .read_workspace_file(&workspace.id, "README.md", &budget)
            .unwrap()
            .source;
        let run = core
            .start_conversation_run(&ConversationRunStart {
                request_id: format!("req_{}", uuid::Uuid::new_v4().simple()),
                workspace_id: workspace.id.clone(),
                conversation_id: workspace.conversation_id,
                user_message_id: None,
                user_text: Some("synthetic prompt".into()),
            })
            .unwrap()
            .run;
        let binding = OutboundBinding {
            workspace_id: workspace.id,
            run_id: run.id,
            root_id: root_record.id,
            endpoint: STEPFUN_OUTBOUND_ENDPOINT.into(),
            provider: "stepfun".into(),
            model: STEPFUN_OUTBOUND_MODEL.into(),
            body_sha256: "a".repeat(64),
            limits_sha256: "b".repeat(64),
            sources: vec![OutboundSource {
                source_id: source.id,
                content_sha256: source.content_sha256,
                byte_len: source.byte_len,
                truncated: source.truncated,
            }],
            expires_at_ms: Utc::now().timestamp_millis() + 100_000,
        };
        Self {
            _tmp: tmp,
            db,
            root,
            core,
            binding,
        }
    }
}

fn opening_binding(f: &Fixture) -> OutboundBinding {
    let mut binding = f.binding.clone();
    binding.run_id = f
        .core
        .mark_analyzing(&binding.workspace_id)
        .unwrap()
        .active_run_id
        .expect("Core must issue an opening run");
    binding
}

#[test]
fn opening_review_is_owned_version_bound_and_consumed_once() {
    let f = Fixture::new();
    let binding = opening_binding(&f);
    let approval = f.core.approve_outbound(&binding).unwrap();
    let reopened = Core::open(&f.db).unwrap();
    let mut changed = binding.clone();
    changed.body_sha256 = "d".repeat(64);
    assert!(reopened.consume_outbound(&approval, &changed).is_err());
    changed = binding.clone();
    changed.sources[0].content_sha256 = "e".repeat(64);
    assert!(reopened.consume_outbound(&approval, &changed).is_err());
    reopened.consume_outbound(&approval, &binding).unwrap();
    assert!(f.core.consume_outbound(&approval, &binding).is_err());
}

#[test]
fn opening_review_rejects_cancelled_stale_and_other_workspace_runs() {
    let f = Fixture::new();
    let binding = opening_binding(&f);
    let approval = f.core.approve_outbound(&binding).unwrap();
    let other_root_path = f._tmp.path().join("other-synthetic-project");
    fs::create_dir(&other_root_path).unwrap();
    fs::write(other_root_path.join("README.md"), "synthetic other").unwrap();
    let other_root = f.core.authorize_directory(&other_root_path).unwrap();
    let scan = f
        .core
        .run_initial_scan(&other_root.id, &ScanBudget::default(), &CancelFlag::new())
        .unwrap();
    let other_workspace = f
        .core
        .confirm_import(&ConfirmImport {
            root_id: other_root.id.clone(),
            scan_id: scan.id,
            mode: ImportMode::SingleProject,
            enable_model_initial_read: false,
        })
        .unwrap()
        .workspaces
        .remove(0);
    let mut wrong_workspace = binding.clone();
    wrong_workspace.workspace_id = other_workspace.id;
    wrong_workspace.root_id = other_root.id;
    wrong_workspace.sources.clear();
    assert!(f.core.approve_outbound(&wrong_workspace).is_err());
    assert!(f
        .core
        .consume_outbound(&approval, &wrong_workspace)
        .is_err());
    f.core.cancel_onboarding(&binding.workspace_id).unwrap();
    assert!(f.core.consume_outbound(&approval, &binding).is_err());
    f.core.retry_onboarding(&binding.workspace_id).unwrap();
    let new_binding = opening_binding(&f);
    assert_ne!(binding.run_id, new_binding.run_id);
    assert!(f.core.approve_outbound(&binding).is_err());
    assert!(f.core.consume_outbound(&approval, &binding).is_err());
    assert!(f.core.approve_outbound(&new_binding).is_ok());
}

#[test]
fn opening_review_rechecks_directory_and_model_grants() {
    let f = Fixture::new();
    let binding = opening_binding(&f);
    let approval = f.core.approve_outbound(&binding).unwrap();
    f.core.pause_directory(&binding.root_id).unwrap();
    assert!(f.core.consume_outbound(&approval, &binding).is_err());

    let f2 = Fixture::new();
    let binding2 = opening_binding(&f2);
    let approval2 = f2.core.approve_outbound(&binding2).unwrap();
    Core::open(&f2.db)
        .unwrap()
        .set_service_grant(&ServiceGrantUpdate {
            workspace_id: binding2.workspace_id.clone(),
            service: ServiceKind::Model,
            status: ServiceStatus::Disabled,
            provider: None,
            model: None,
        })
        .unwrap();
    assert!(f2.core.consume_outbound(&approval2, &binding2).is_err());
}

#[test]
fn collision_between_opening_and_conversation_run_ids_fails_closed() {
    let f = Fixture::new();
    let binding = opening_binding(&f);
    let sql = rusqlite::Connection::open(&f.db).unwrap();
    sql.execute(
        "UPDATE onboarding_runs SET active_run_id=?1 WHERE workspace_id=?2",
        rusqlite::params![f.binding.run_id.as_str(), binding.workspace_id.as_str()],
    )
    .unwrap();
    assert!(f.core.approve_outbound(&f.binding).is_err());
}

#[test]
fn approval_is_persistent_bound_and_single_use() {
    let f = Fixture::new();
    let approval = f.core.approve_outbound(&f.binding).unwrap();
    let reopened = Core::open(&f.db).unwrap();
    let mut changed = f.binding.clone();
    changed.body_sha256 = "c".repeat(64);
    assert!(reopened.consume_outbound(&approval, &changed).is_err());
    changed = f.binding.clone();
    changed.limits_sha256 = "d".repeat(64);
    assert!(reopened.consume_outbound(&approval, &changed).is_err());
    changed = f.binding.clone();
    changed.sources.clear();
    assert!(reopened.consume_outbound(&approval, &changed).is_err());
    reopened.consume_outbound(&approval, &f.binding).unwrap();
    assert!(f.core.consume_outbound(&approval, &f.binding).is_err());
    let sql = rusqlite::Connection::open(&f.db).unwrap();
    assert!(sql
        .execute("DELETE FROM outbound_review_events", [])
        .is_err());
    assert_eq!(
        sql.query_row("SELECT COUNT(*) FROM outbound_review_events", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
}

#[test]
fn accepts_only_exact_recipient_model_and_known_distinct_sources() {
    let f = Fixture::new();
    let mut b = f.binding.clone();
    b.endpoint = "https://example.com".into();
    assert!(f.core.approve_outbound(&b).is_err());
    b = f.binding.clone();
    b.model = "other".into();
    assert!(f.core.approve_outbound(&b).is_err());
    b = f.binding.clone();
    b.sources[0].content_sha256 = "c".repeat(64);
    assert!(f.core.approve_outbound(&b).is_err());
    b = f.binding.clone();
    b.sources.push(b.sources[0].clone());
    assert!(f.core.approve_outbound(&b).is_err());
    b = f.binding.clone();
    b.expires_at_ms = Utc::now().timestamp_millis() - 1;
    assert!(f.core.approve_outbound(&b).is_err());
}

#[test]
fn unrelated_historical_source_does_not_invalidate_approval() {
    let f = Fixture::new();
    let approval = f.core.approve_outbound(&f.binding).unwrap();
    fs::write(f.root.join("notes.txt"), "synthetic unrelated").unwrap();
    f.core
        .read_workspace_file(&f.binding.workspace_id, "notes.txt", &ScanBudget::default())
        .unwrap();
    f.core.consume_outbound(&approval, &f.binding).unwrap();
}

#[test]
fn revocation_and_cancellation_on_another_connection_prevent_consumption() {
    let f = Fixture::new();
    let approval = f.core.approve_outbound(&f.binding).unwrap();
    let other = Core::open(&f.db).unwrap();
    other
        .set_service_grant(&ServiceGrantUpdate {
            workspace_id: f.binding.workspace_id.clone(),
            service: ServiceKind::Model,
            status: ServiceStatus::Disabled,
            provider: None,
            model: None,
        })
        .unwrap();
    assert!(f.core.consume_outbound(&approval, &f.binding).is_err());
    let f2 = Fixture::new();
    let approval2 = f2.core.approve_outbound(&f2.binding).unwrap();
    Core::open(&f2.db)
        .unwrap()
        .cancel_conversation_run(&f2.binding.workspace_id, &f2.binding.run_id)
        .unwrap();
    assert!(f2.core.consume_outbound(&approval2, &f2.binding).is_err());
}

#[test]
fn synchronous_begin_orders_other_connections_and_never_reuses_receipt() {
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    let f = Fixture::new();
    let approval = f.core.approve_outbound(&f.binding).unwrap();
    let sender = Core::open(&f.db).unwrap();
    let other = Core::open(&f.db).unwrap();
    let binding = f.binding.clone();
    let sender_id = approval.clone();
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let send_thread = thread::spawn(move || {
        sender.consume_and_begin_outbound(&sender_id, &binding, || {
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(3)).unwrap();
            Ok(())
        })
    });
    started_rx.recv_timeout(Duration::from_secs(3)).unwrap();

    let workspace_id = f.binding.workspace_id.clone();
    let (attempt_tx, attempt_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    let revoke_thread = thread::spawn(move || {
        attempt_tx.send(()).unwrap();
        let result = other.set_service_grant(&ServiceGrantUpdate {
            workspace_id,
            service: ServiceKind::Model,
            status: ServiceStatus::Disabled,
            provider: None,
            model: None,
        });
        result_tx.send(result).unwrap();
    });
    attempt_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    // The write transaction must wait while the synthetic boundary holds the lock.
    assert!(matches!(
        result_rx.recv_timeout(Duration::from_millis(150)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    release_tx.send(()).unwrap();
    send_thread.join().unwrap().unwrap();
    revoke_thread.join().unwrap();
    assert_eq!(
        result_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap()
            .status,
        ServiceStatus::Disabled
    );
    assert!(f
        .core
        .consume_and_begin_outbound(&approval, &f.binding, || Ok(()))
        .is_err());
}

#[test]
fn opening_cancel_waits_for_the_synchronous_admission_boundary() {
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    let f = Fixture::new();
    let binding = opening_binding(&f);
    let approval = f.core.approve_outbound(&binding).unwrap();
    let sender = Core::open(&f.db).unwrap();
    let other = Core::open(&f.db).unwrap();
    let workspace = binding.workspace_id.clone();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let send_thread = thread::spawn(move || {
        sender.consume_and_begin_outbound(&approval, &binding, || {
            entered_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(3)).unwrap();
            Ok(())
        })
    });
    entered_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    let (attempt_tx, attempt_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    let cancel_thread = thread::spawn(move || {
        attempt_tx.send(()).unwrap();
        result_tx.send(other.cancel_onboarding(&workspace)).unwrap();
    });
    attempt_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    assert!(matches!(
        result_rx.recv_timeout(Duration::from_millis(150)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    release_tx.send(()).unwrap();
    send_thread.join().unwrap().unwrap();
    cancel_thread.join().unwrap();
    assert_eq!(
        result_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap()
            .state,
        "cancelled"
    );
}

#[test]
fn failed_begin_keeps_the_approval_consumed() {
    let f = Fixture::new();
    let approval = f.core.approve_outbound(&f.binding).unwrap();
    let result: Result<(), hark_core::CoreError> =
        f.core
            .consume_and_begin_outbound(&approval, &f.binding, || {
                Err(hark_core::CoreError::new(
                    hark_core::ErrorCode::ModelNotAuthorized,
                    "synthetic sender failed",
                ))
            });
    assert!(result.is_err());
    assert!(f
        .core
        .consume_and_begin_outbound(&approval, &f.binding, || Ok(()))
        .is_err());
}

#[test]
fn edited_or_replaced_reviewed_file_refuses_begin_and_consumes_approval() {
    use std::cell::Cell;
    use std::os::unix::fs::symlink;

    for replace_with_symlink in [false, true] {
        let f = Fixture::new();
        let approval = f.core.approve_outbound(&f.binding).unwrap();
        let file = f.root.join("README.md");
        if replace_with_symlink {
            let outside = f._tmp.path().join("outside.txt");
            fs::write(&outside, "synthetic outside scope").unwrap();
            fs::remove_file(&file).unwrap();
            symlink(&outside, &file).unwrap();
        } else {
            fs::write(&file, "changed synthetic readme").unwrap();
        }
        let called = Cell::new(false);
        assert!(f
            .core
            .consume_and_begin_outbound(&approval, &f.binding, || {
                called.set(true);
                Ok(())
            })
            .is_err());
        assert!(!called.get());
        assert!(f.core.consume_outbound(&approval, &f.binding).is_err());
    }
}

#[test]
fn truncated_source_checks_the_previously_read_prefix() {
    let mut f = Fixture::new();
    fs::write(f.root.join("README.md"), "first part and remainder").unwrap();
    let budget = ScanBudget {
        max_file_bytes: 5,
        ..ScanBudget::default()
    };
    let source = f
        .core
        .read_workspace_file(&f.binding.workspace_id, "README.md", &budget)
        .unwrap()
        .source;
    assert!(source.truncated);
    f.binding.sources = vec![OutboundSource {
        source_id: source.id,
        content_sha256: source.content_sha256,
        byte_len: source.byte_len,
        truncated: true,
    }];
    let approval = f.core.approve_outbound(&f.binding).unwrap();
    // A different suffix was never read or sent; the reviewed prefix is unchanged.
    fs::write(f.root.join("README.md"), "first new remainder").unwrap();
    assert!(f
        .core
        .consume_and_begin_outbound(&approval, &f.binding, || Ok(()))
        .is_ok());
    let approval = f.core.approve_outbound(&f.binding).unwrap();
    fs::write(f.root.join("README.md"), "other new remainder").unwrap();
    assert!(f
        .core
        .consume_and_begin_outbound(&approval, &f.binding, || Ok(()))
        .is_err());
}
