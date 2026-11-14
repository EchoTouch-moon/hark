use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use hark_core::{
    Core, FlameStage, MemoryCallContext, MemoryCaller, MemoryChangeProposal, MemoryNoteKind,
    MemoryOperation, NarrativeAvailability, ObservationStatus, OpinionChangeProposal, ServiceKind,
    ServiceStatus, SourceFreshness,
};
use hark_native_shell::{
    business_db_path, ConfirmRequest, NativeShell, SearchConfig, SearchProviderCredentials,
    Selection, FRONTEND_COMMANDS,
};

fn import_workspace(shell: &NativeShell, project: &Path) -> hark_core::Workspace {
    fs::create_dir_all(project).unwrap();
    fs::write(project.join("README.md"), "# Hark Soul Test\ninitial\n").unwrap();
    let ticket = shell.stage_native_pick(project).unwrap();
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
fn frontend_commands_expose_soul_observer_and_search_surface() {
    for cmd in [
        "get_narrative_state",
        "observe_workspace",
        "list_attention_items",
        "dismiss_attention_item",
        "set_search_grant",
        "get_search_config",
        "save_search_config",
        "set_observer_paused",
    ] {
        assert!(
            FRONTEND_COMMANDS.contains(&cmd),
            "FRONTEND_COMMANDS missing {cmd}"
        );
    }
}

#[test]
fn search_grant_and_search_config_persist_safely() {
    let tmp = tempfile::tempdir().unwrap();
    let db = business_db_path(tmp.path());
    let shell = NativeShell::open(&db).unwrap();
    let ws = import_workspace(&shell, &tmp.path().join("proj"));

    let initial_grants = shell.service_grants(ws.id.as_str()).unwrap();
    let search_grant = initial_grants
        .iter()
        .find(|g| g.service == ServiceKind::Search)
        .unwrap();
    assert_eq!(search_grant.status, ServiceStatus::Disabled);

    let enabled = shell.set_search_grant(ws.id.as_str(), true).unwrap();
    assert_eq!(enabled.service, ServiceKind::Search);
    assert_eq!(enabled.status, ServiceStatus::Enabled);

    let disabled = shell.set_search_grant(ws.id.as_str(), false).unwrap();
    assert_eq!(disabled.status, ServiceStatus::Disabled);

    // Default config when search-config.json does not exist
    let default_cfg = shell.get_search_config().unwrap();
    assert_eq!(default_cfg.active_provider, "tavily");
    assert!(default_cfg.configured_providers.is_empty());
    assert!(default_cfg.providers.is_empty());

    // Save config and verify persistence, redaction, and 0o600 permissions on Unix
    let secret = "tvly-test-secret-do-not-log-12345";
    let mut providers = BTreeMap::new();
    providers.insert(
        "tavily".to_string(),
        SearchProviderCredentials {
            api_key: Some(format!("  {secret}  ")),
            endpoint: None,
        },
    );
    providers.insert(
        "bing".to_string(),
        SearchProviderCredentials {
            api_key: Some("   ".to_string()),
            endpoint: None,
        },
    );
    let saved = shell
        .save_search_config(SearchConfig {
            active_provider: "tavily".to_string(),
            providers,
        })
        .unwrap();
    assert_eq!(saved.active_provider, "tavily");
    assert_eq!(saved.configured_providers, vec!["tavily".to_string()]);
    assert!(!saved.providers.contains_key("bing"));
    assert_eq!(saved.providers["tavily"].api_key.as_deref(), Some(secret));

    let debug_str = format!("{:?}", saved.providers["tavily"]);
    assert!(!debug_str.contains(secret), "Debug leaked apiKey");
    assert!(debug_str.contains("has_api_key: true"));

    let config_path = tmp.path().join("hark-r1").join("search-config.json");
    assert!(config_path.is_file());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&config_path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    let loaded = shell.get_search_config().unwrap();
    assert_eq!(loaded, saved);

    // Save zhipu_mcp provider with optional endpoint
    let mut zhipu_providers = loaded.providers.clone();
    zhipu_providers.insert(
        "zhipu_mcp".to_string(),
        SearchProviderCredentials {
            api_key: Some("zp-coding-test-key".to_string()),
            endpoint: Some("https://open.bigmodel.cn/api/mcp/web_search_prime/mcp".to_string()),
        },
    );
    let saved_zhipu = shell
        .save_search_config(SearchConfig {
            active_provider: "zhipu_mcp".to_string(),
            providers: zhipu_providers,
        })
        .unwrap();
    assert_eq!(saved_zhipu.active_provider, "zhipu_mcp");
    assert!(saved_zhipu
        .configured_providers
        .contains(&"zhipu_mcp".to_string()));
    assert_eq!(
        saved_zhipu.providers["zhipu_mcp"].endpoint.as_deref(),
        Some("https://open.bigmodel.cn/api/mcp/web_search_prime/mcp")
    );

    // Reject unknown provider or control characters in API key
    assert!(shell
        .save_search_config(SearchConfig {
            active_provider: "unknown-engine".to_string(),
            providers: BTreeMap::new(),
        })
        .is_err());

    let mut bad_providers = BTreeMap::new();
    bad_providers.insert(
        "tavily".to_string(),
        SearchProviderCredentials {
            api_key: Some("bad\nkey".to_string()),
            endpoint: None,
        },
    );
    assert!(shell
        .save_search_config(SearchConfig {
            active_provider: "tavily".to_string(),
            providers: bad_providers,
        })
        .is_err());
}

#[test]
fn narrative_observer_attention_and_pause_flow() {
    let tmp = tempfile::tempdir().unwrap();
    let db = business_db_path(tmp.path());
    let project = tmp.path().join("proj");
    let shell = NativeShell::open(&db).unwrap();
    let ws = import_workspace(&shell, &project);

    let narrative_initial = shell.get_narrative_state(ws.id.as_str()).unwrap();
    assert_eq!(
        narrative_initial.availability,
        NarrativeAvailability::Unknown
    );
    assert_eq!(narrative_initial.flame, FlameStage::Neutral);

    let read_report = shell.selective_key_read(ws.id.as_str()).unwrap();
    let readme_src = read_report
        .sources
        .iter()
        .find(|s| s.relative_path == "README.md")
        .unwrap();

    let narrative_after_read = shell.get_narrative_state(ws.id.as_str()).unwrap();
    assert_eq!(
        narrative_after_read.availability,
        NarrativeAvailability::Known
    );
    assert_eq!(narrative_after_read.flame, FlameStage::Ember);

    // Add a decision memory and an opinion citing README.md
    let core = Core::open(&db).unwrap();
    let msg = core
        .append_user_message(&ws.id, "采用 Tauri + Rust Core 本地优先架构")
        .unwrap();
    let ctx = |op: &str| MemoryCallContext {
        workspace_id: ws.id.clone(),
        operation_id: op.to_string(),
        current_user_message_id: Some(msg.id.clone()),
        caller: MemoryCaller::User,
    };
    let mem_receipt = core
        .memory_propose_change(
            &ctx("mem-dec-1"),
            &MemoryChangeProposal {
                operation: MemoryOperation::Add,
                kind: MemoryNoteKind::Decision,
                content: "采用 Tauri + Rust Core 本地优先架构".to_string(),
                source_refs: vec![msg.id.to_string(), readme_src.id.to_string()],
                target_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert!(mem_receipt.recorded);
    let op_receipt = core
        .opinion_propose_change(
            &ctx("op-1"),
            &OpinionChangeProposal {
                operation: MemoryOperation::Add,
                summary: "Hark Soul Test initial".to_string(),
                evidence_refs: vec![readme_src.id.to_string()],
                counter_arguments: vec![],
                uncertainties: vec![],
                target_opinion_id: None,
                expected_revision: None,
            },
        )
        .unwrap();
    assert!(op_receipt.recorded, "opinion receipt: {op_receipt:?}");
    let op = op_receipt.view.unwrap();
    drop(core);

    let narrative_bright = shell.get_narrative_state(ws.id.as_str()).unwrap();
    assert_eq!(narrative_bright.flame, FlameStage::Bright);
    assert!(!narrative_bright.stale);

    // Modify README.md on disk -> observe_workspace marks opinion stale & emits attention item
    fs::write(
        project.join("README.md"),
        "# Hark Soul Test\nmodified content\n",
    )
    .unwrap();
    let report = shell.observe_workspace(ws.id.as_str()).unwrap();
    assert_eq!(report.status, ObservationStatus::Observed);
    assert!(report
        .changed_files
        .iter()
        .any(|c| c.relative_path == "README.md" && c.freshness == SourceFreshness::Changed));
    assert!(report.stale_opinion_ids.contains(&op.id));
    assert!(!report.attention_items.is_empty());

    let listed = shell.list_attention_items(ws.id.as_str()).unwrap();
    assert_eq!(listed.len(), report.attention_items.len());
    assert!(listed.iter().all(|item| !item.dismissed));

    let first_id = listed[0].id.clone();
    assert!(shell
        .dismiss_attention_item(ws.id.as_str(), &first_id)
        .unwrap());
    assert!(!shell
        .dismiss_attention_item(ws.id.as_str(), &first_id)
        .unwrap());
    let after_dismiss = shell.list_attention_items(ws.id.as_str()).unwrap();
    assert!(
        after_dismiss
            .iter()
            .find(|item| item.id == first_id)
            .unwrap()
            .dismissed
    );

    // Pausing observer skips workspace during background observe_active_workspaces without revoking directory
    let paused = shell.set_observer_paused(ws.id.as_str(), true).unwrap();
    assert!(paused.paused);
    assert_eq!(paused.observer_state, "paused");
    assert!(shell.is_observer_paused(&ws.id).unwrap());

    fs::write(project.join("README.md"), "# Hark Soul Test\npaused edit\n").unwrap();
    let bg_while_paused = shell.observe_active_workspaces().unwrap();
    assert!(bg_while_paused.is_empty());

    let resumed = shell.set_observer_paused(ws.id.as_str(), false).unwrap();
    assert!(!resumed.paused);
    assert_eq!(resumed.observer_state, "active");
    assert!(!shell.is_observer_paused(&ws.id).unwrap());

    let bg_after_resume = shell.observe_active_workspaces().unwrap();
    assert_eq!(bg_after_resume.len(), 1);
    assert!(bg_after_resume[0]
        .changed_files
        .iter()
        .any(|c| c.relative_path == "README.md" && c.freshness == SourceFreshness::Changed));

    // Revoking directory blocks set_observer_paused and skips observe_active_workspaces
    shell.revoke_directory(ws.root_id.as_str()).unwrap();
    assert!(shell.set_observer_paused(ws.id.as_str(), false).is_err());
    assert!(shell.observe_active_workspaces().unwrap().is_empty());
}
