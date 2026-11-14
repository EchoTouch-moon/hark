use hark_native_shell::{
    decide_window_close, AgentTurnRef, AgentTurnRequest, AgentTurnRequestRef, AuthorizeRequest,
    ConfirmRequest, ModelGrantRequest, NativeShell, OpeningRequest, ShellError, SourceRefRequest,
    StepFunKeyRequest, TurnProgress, UserMessageRequest, WindowCloseDecision,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;

const APP_EVENT_NAME: &str = "hark://app-event";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppEventPayload {
    #[serde(rename = "type")]
    event_type: &'static str,
    workspace_id: String,
    timestamp: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OutboundReviewRef {
    workspace_id: String,
    run_id: String,
    review_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum OutboundDecision {
    Approve,
    Reject,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OutboundReviewDecision {
    workspace_id: String,
    run_id: String,
    review_id: String,
    decision: OutboundDecision,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OutboundReviewView {
    review_id: String,
    workspace_id: String,
    run_id: String,
    recipient: String,
    model: String,
    limits: Vec<hark_native_shell::ReviewLimit>,
    sources: Vec<hark_native_shell::ReviewSource>,
    body: String,
}

#[tauri::command(rename_all = "camelCase", async)]
fn pick_directory(app: tauri::AppHandle) -> Result<hark_native_shell::PickTicket, ShellError> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择要本地只读初扫的目录")
        .set_can_create_directories(false)
        .blocking_pick_folder();
    let Some(picked) = picked else {
        return Err(ShellError::new("pick_cancelled", "未选择目录"));
    };
    let path = picked
        .into_path()
        .map_err(|_| ShellError::new("invalid_path", "选择结果不是本地路径"))?;
    app.state::<NativeShell>().stage_native_pick(&path)
}

#[tauri::command(rename_all = "camelCase")]
fn authorize_picked(
    shell: tauri::State<'_, NativeShell>,
    request: AuthorizeRequest,
) -> Result<hark_native_shell::AuthorizedRoot, ShellError> {
    shell.authorize_picked(&request.pick_token)
}

#[tauri::command(rename_all = "camelCase")]
fn list_roots(
    shell: tauri::State<'_, NativeShell>,
) -> Result<Vec<hark_native_shell::AuthorizedRoot>, ShellError> {
    shell.list_roots()
}

#[tauri::command(rename_all = "camelCase")]
fn pause_directory(
    shell: tauri::State<'_, NativeShell>,
    root_id: String,
) -> Result<hark_native_shell::AuthorizedRoot, ShellError> {
    shell.pause_directory(&root_id)
}

#[tauri::command(rename_all = "camelCase")]
fn resume_directory(
    shell: tauri::State<'_, NativeShell>,
    root_id: String,
) -> Result<hark_native_shell::AuthorizedRoot, ShellError> {
    shell.resume_directory(&root_id)
}

#[tauri::command(rename_all = "camelCase")]
fn revoke_directory(
    shell: tauri::State<'_, NativeShell>,
    root_id: String,
) -> Result<hark_native_shell::AuthorizedRoot, ShellError> {
    shell.revoke_directory(&root_id)
}

#[tauri::command(rename_all = "camelCase", async)]
fn scan_root(
    shell: tauri::State<'_, NativeShell>,
    root_id: String,
) -> Result<hark_native_shell::InitialScan, ShellError> {
    shell.scan_root(&root_id)
}

#[tauri::command(rename_all = "camelCase")]
fn cancel_scan(shell: tauri::State<'_, NativeShell>, root_id: String) -> Result<(), ShellError> {
    shell.cancel_scan(&root_id)
}

#[tauri::command(rename_all = "camelCase")]
fn get_scan(
    shell: tauri::State<'_, NativeShell>,
    scan_id: String,
) -> Result<hark_native_shell::InitialScan, ShellError> {
    shell.get_scan(&scan_id)
}

#[tauri::command(rename_all = "camelCase")]
fn confirm_import(
    shell: tauri::State<'_, NativeShell>,
    request: ConfirmRequest,
) -> Result<hark_native_shell::ConfirmResult, ShellError> {
    shell.confirm_import(&request)
}

#[tauri::command(rename_all = "camelCase")]
fn list_workspaces(
    shell: tauri::State<'_, NativeShell>,
) -> Result<Vec<hark_native_shell::Workspace>, ShellError> {
    shell.list_workspaces()
}

#[tauri::command(rename_all = "camelCase")]
fn get_workspace(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<hark_native_shell::Workspace, ShellError> {
    shell.get_workspace(&workspace_id)
}

#[tauri::command(rename_all = "camelCase", async)]
fn selective_key_read(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<hark_native_shell::SelectiveReadReport, ShellError> {
    shell.selective_key_read(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn cancel_read(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<(), ShellError> {
    shell.cancel_read(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn list_source_refs(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<Vec<hark_native_shell::SourceRef>, ShellError> {
    shell.list_source_refs(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn get_source_ref(
    shell: tauri::State<'_, NativeShell>,
    request: SourceRefRequest,
) -> Result<hark_native_shell::SourceRef, ShellError> {
    shell.get_source_ref(&request.workspace_id, &request.source_id)
}

#[tauri::command(rename_all = "camelCase")]
fn workspace_overview(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<hark_native_shell::WorkspaceOverview, ShellError> {
    shell.workspace_overview(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn commit_local_scan_card(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<hark_native_shell::FirstMessage, ShellError> {
    shell.commit_local_scan_card(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn list_conversation(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<Vec<hark_native_shell::ConversationEvent>, ShellError> {
    shell.list_conversation(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn append_user_message(
    shell: tauri::State<'_, NativeShell>,
    request: UserMessageRequest,
) -> Result<hark_native_shell::ConversationEvent, ShellError> {
    shell.append_user_message(&request.workspace_id, &request.text)
}

#[tauri::command(rename_all = "camelCase")]
fn onboarding(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<hark_native_shell::OnboardingCheckpoint, ShellError> {
    shell.onboarding(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn cancel_onboarding(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<hark_native_shell::OnboardingCheckpoint, ShellError> {
    shell.cancel_onboarding(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn retry_onboarding(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<hark_native_shell::OnboardingCheckpoint, ShellError> {
    shell.retry_onboarding(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn service_grants(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<Vec<hark_native_shell::ServiceGrant>, ShellError> {
    shell.service_grants(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn sidecar_status(shell: tauri::State<'_, NativeShell>) -> hark_native_shell::SidecarStatus {
    shell.sidecar_status()
}

#[tauri::command(rename_all = "camelCase", async)]
fn start_configured_opening(
    shell: tauri::State<'_, NativeShell>,
    request: OpeningRequest,
) -> Result<hark_native_shell::OpeningBridgeResult, ShellError> {
    shell.run_configured_opening(&request.workspace_id)
}

#[tauri::command(rename_all = "camelCase", async)]
fn start_agent_turn(
    shell: tauri::State<'_, NativeShell>,
    request: AgentTurnRequest,
    on_event: tauri::ipc::Channel<hark_native_shell::RunStreamEvent>,
) -> Result<hark_native_shell::AgentTurnAccepted, ShellError> {
    let progress = TurnProgress::new(move |event| {
        let _ = on_event.send(event);
    });
    shell.start_agent_turn(request, progress)
}

#[tauri::command(rename_all = "camelCase")]
fn get_agent_turn(
    shell: tauri::State<'_, NativeShell>,
    request: AgentTurnRef,
) -> Result<hark_native_shell::AgentTurnStatus, ShellError> {
    shell.agent_turn_status(&request.workspace_id, &request.run_id)
}

#[tauri::command(rename_all = "camelCase")]
fn get_agent_turn_by_request(
    shell: tauri::State<'_, NativeShell>,
    request: AgentTurnRequestRef,
) -> Result<Option<hark_native_shell::AgentTurnStatus>, ShellError> {
    shell.agent_turn_status_by_request(
        &request.workspace_id,
        &request.conversation_id,
        &request.request_id,
    )
}

#[tauri::command(rename_all = "camelCase")]
fn cancel_agent_turn(
    shell: tauri::State<'_, NativeShell>,
    request: AgentTurnRef,
) -> Result<hark_native_shell::AgentTurnStatus, ShellError> {
    shell.cancel_agent_turn(&request.workspace_id, &request.run_id)
}

#[tauri::command(rename_all = "camelCase")]
fn get_outbound_review(
    shell: tauri::State<'_, NativeShell>,
    request: OutboundReviewRef,
) -> Result<OutboundReviewView, ShellError> {
    let review =
        shell.get_outbound_review(&request.workspace_id, &request.run_id, &request.review_id)?;
    Ok(OutboundReviewView {
        review_id: review.review_id().to_owned(),
        workspace_id: review.workspace_id().as_str().to_owned(),
        run_id: review.run_id().as_str().to_owned(),
        recipient: review.recipient().to_owned(),
        model: review.model().to_owned(),
        limits: review.limits().to_vec(),
        sources: review.sources().to_vec(),
        body: review.body().to_owned(),
    })
}

#[tauri::command(rename_all = "camelCase")]
fn decide_outbound_review(
    shell: tauri::State<'_, NativeShell>,
    request: OutboundReviewDecision,
) -> Result<(), ShellError> {
    let decision = match request.decision {
        OutboundDecision::Approve => hark_native_shell::ReviewDecision::Approve,
        OutboundDecision::Reject => hark_native_shell::ReviewDecision::Reject,
    };
    shell.decide_outbound_review(
        &request.workspace_id,
        &request.run_id,
        &request.review_id,
        decision,
    )
}

#[tauri::command(rename_all = "camelCase")]
fn shell_snapshot(
    shell: tauri::State<'_, NativeShell>,
) -> Result<hark_native_shell::ShellSnapshot, ShellError> {
    shell.snapshot()
}

#[tauri::command(rename_all = "camelCase")]
fn configure_stepfun_session(
    shell: tauri::State<'_, NativeShell>,
    request: StepFunKeyRequest,
) -> Result<hark_native_shell::StepFunSessionStatus, ShellError> {
    shell.configure_stepfun_session(&request.api_key)
}

#[tauri::command(rename_all = "camelCase")]
fn clear_stepfun_session(
    shell: tauri::State<'_, NativeShell>,
) -> Result<hark_native_shell::StepFunSessionStatus, ShellError> {
    shell.clear_stepfun_session()
}

#[tauri::command(rename_all = "camelCase")]
fn stepfun_session_status(
    shell: tauri::State<'_, NativeShell>,
) -> Result<hark_native_shell::StepFunSessionStatus, ShellError> {
    shell.stepfun_session_status()
}

#[tauri::command(rename_all = "camelCase")]
fn get_opinion(
    shell: tauri::State<'_, NativeShell>,
    request: hark_native_shell::OpinionRequest,
) -> Result<hark_native_shell::OpinionView, ShellError> {
    shell.get_opinion(&request)
}

#[tauri::command(rename_all = "camelCase")]
fn list_workspace_opinions(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<Vec<hark_native_shell::OpinionView>, ShellError> {
    shell.list_workspace_opinions(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn submit_opinion_feedback(
    shell: tauri::State<'_, NativeShell>,
    request: hark_native_shell::OpinionFeedbackRequest,
) -> Result<hark_native_shell::OpinionView, ShellError> {
    shell.submit_opinion_feedback(&request)
}

#[tauri::command(rename_all = "camelCase")]
fn revert_memory_operation(
    shell: tauri::State<'_, NativeShell>,
    request: hark_native_shell::RevertMemoryRequest,
) -> Result<hark_native_shell::MemoryReceipt, ShellError> {
    shell.revert_memory_operation(&request)
}

#[tauri::command(rename_all = "camelCase", async)]
fn search_workspace_memory(
    shell: tauri::State<'_, NativeShell>,
    request: hark_native_shell::MemorySearchInput,
) -> Result<hark_native_shell::MemorySearchPage, ShellError> {
    shell.search_workspace_memory(&request)
}

#[tauri::command(rename_all = "camelCase")]
fn list_memory_receipts(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<Vec<hark_native_shell::MemoryReceipt>, ShellError> {
    shell.list_memory_receipts(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn get_message_evidence(
    shell: tauri::State<'_, NativeShell>,
    request: hark_native_shell::MessageEvidenceRequest,
) -> Result<hark_native_shell::ConversationEvent, ShellError> {
    shell.get_message_evidence(&request)
}

#[tauri::command(rename_all = "camelCase")]
fn set_model_grant(
    shell: tauri::State<'_, NativeShell>,
    request: ModelGrantRequest,
) -> Result<hark_native_shell::ServiceGrant, ShellError> {
    shell.set_model_grant(&request.workspace_id, request.enabled)
}

#[tauri::command(rename_all = "camelCase")]
fn get_narrative_state(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<hark_native_shell::NarrativeState, ShellError> {
    shell.get_narrative_state(&workspace_id)
}

#[tauri::command(rename_all = "camelCase", async)]
fn observe_workspace(
    app: tauri::AppHandle,
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<hark_native_shell::WorkspaceObservationReport, ShellError> {
    let report = shell.observe_workspace(&workspace_id)?;
    emit_observation_events(&app, &report, None);
    Ok(report)
}

#[tauri::command(rename_all = "camelCase")]
fn list_attention_items(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
) -> Result<Vec<hark_native_shell::AttentionItem>, ShellError> {
    shell.list_attention_items(&workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
fn dismiss_attention_item(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
    attention_id: String,
) -> Result<bool, ShellError> {
    shell.dismiss_attention_item(&workspace_id, &attention_id)
}

#[tauri::command(rename_all = "camelCase")]
fn set_search_grant(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
    enabled: bool,
) -> Result<hark_native_shell::ServiceGrant, ShellError> {
    shell.set_search_grant(&workspace_id, enabled)
}

#[tauri::command(rename_all = "camelCase")]
fn get_search_config(
    shell: tauri::State<'_, NativeShell>,
) -> Result<hark_native_shell::SearchConfigResponse, ShellError> {
    shell.get_search_config()
}

#[tauri::command(rename_all = "camelCase")]
fn save_search_config(
    shell: tauri::State<'_, NativeShell>,
    config: hark_native_shell::SearchConfig,
) -> Result<hark_native_shell::SearchConfigResponse, ShellError> {
    shell.save_search_config(config)
}

#[tauri::command(rename_all = "camelCase")]
fn set_observer_paused(
    shell: tauri::State<'_, NativeShell>,
    workspace_id: String,
    paused: bool,
) -> Result<hark_native_shell::ObserverStatus, ShellError> {
    shell.set_observer_paused(&workspace_id, paused)
}

#[tauri::command(rename_all = "camelCase")]
fn hide_window(app: tauri::AppHandle) -> Result<(), ShellError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| ShellError::new("window_missing", "主窗口不存在"))?;
    window
        .hide()
        .map_err(|err| ShellError::new("window_hide_failed", err.to_string()))
}

#[tauri::command(rename_all = "camelCase")]
fn quit_app(app: tauri::AppHandle) -> Result<(), ShellError> {
    if let Some(shell) = app.try_state::<NativeShell>() {
        shell.request_quit();
    }
    app.exit(0);
    Ok(())
}

fn open_shell(app_data_dir: &std::path::Path) -> Result<NativeShell, ShellError> {
    std::fs::create_dir_all(app_data_dir).map_err(|err| ShellError::new("io", err.to_string()))?;
    NativeShell::open_with_system_credentials(&hark_native_shell::business_db_path(app_data_dir))
}

fn install_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "完全退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    #[cfg(target_os = "macos")]
    let icon = tauri::include_image!("icons/tray.png");
    #[cfg(not(target_os = "macos"))]
    let icon = tauri::include_image!("icons/32x32.png");
    TrayIconBuilder::with_id("main")
        .menu(&menu)
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Hark")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                if let Some(shell) = app.try_state::<NativeShell>() {
                    shell.request_quit();
                }
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn emit_observation_events(
    app: &tauri::AppHandle,
    report: &hark_native_shell::WorkspaceObservationReport,
    seen_attention: Option<&mut std::collections::HashSet<String>>,
) {
    if report.status != hark_native_shell::ObservationStatus::Observed {
        return;
    }
    let has_changes = !report.changed_files.is_empty()
        || !report.stale_opinion_ids.is_empty()
        || report.git_head_changed;
    if has_changes {
        let _ = app.emit(
            APP_EVENT_NAME,
            AppEventPayload {
                event_type: "workspace_updated",
                workspace_id: report.workspace_id.as_str().to_string(),
                timestamp: report.observed_at.clone(),
            },
        );
    }
    let active_ids: Vec<&str> = report
        .attention_items
        .iter()
        .filter(|item| !item.dismissed)
        .map(|item| item.id.as_str())
        .collect();
    if active_ids.is_empty() {
        return;
    }
    let should_emit_attention = match seen_attention {
        Some(seen) => {
            let has_new = active_ids.iter().any(|id| !seen.contains(*id));
            for id in &active_ids {
                seen.insert((*id).to_string());
            }
            has_changes || has_new
        }
        None => true,
    };
    if should_emit_attention {
        let _ = app.emit(
            APP_EVENT_NAME,
            AppEventPayload {
                event_type: "attention_triggered",
                workspace_id: report.workspace_id.as_str().to_string(),
                timestamp: report.observed_at.clone(),
            },
        );
    }
}

fn sleep_until_next_tick(shell: &NativeShell, total: std::time::Duration) -> bool {
    let step = std::time::Duration::from_secs(1);
    let mut elapsed = std::time::Duration::ZERO;
    while elapsed < total {
        if shell.quit_requested() {
            return false;
        }
        let chunk = step.min(total - elapsed);
        std::thread::sleep(chunk);
        elapsed += chunk;
    }
    !shell.quit_requested()
}

fn run_background_observer(app: tauri::AppHandle) {
    let mut seen_attention = std::collections::HashSet::<String>::new();
    let initial_delay = std::time::Duration::from_secs(5);
    let tick_interval = std::time::Duration::from_secs(300);

    let Some(shell) = app.try_state::<NativeShell>() else {
        return;
    };
    if !sleep_until_next_tick(&shell, initial_delay) {
        return;
    }

    loop {
        if shell.quit_requested() {
            break;
        }
        if let Ok(reports) = shell.observe_active_workspaces() {
            let mut live_ids = std::collections::HashSet::new();
            for report in &reports {
                for item in &report.attention_items {
                    if !item.dismissed {
                        live_ids.insert(item.id.clone());
                    }
                }
                emit_observation_events(&app, report, Some(&mut seen_attention));
            }
            seen_attention.retain(|id| live_ids.contains(id));
        }
        if !sleep_until_next_tick(&shell, tick_interval) {
            break;
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            app.manage(
                open_shell(&app_data)
                    .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?,
            );
            install_tray(app.handle())?;
            let observer_app = app.handle().clone();
            std::thread::spawn(move || {
                run_background_observer(observer_app);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let quit = window
                    .try_state::<NativeShell>()
                    .is_some_and(|shell| shell.quit_requested());
                if decide_window_close(quit) == WindowCloseDecision::HideToTray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            pick_directory,
            authorize_picked,
            list_roots,
            pause_directory,
            resume_directory,
            revoke_directory,
            scan_root,
            cancel_scan,
            get_scan,
            confirm_import,
            list_workspaces,
            get_workspace,
            selective_key_read,
            cancel_read,
            list_source_refs,
            get_source_ref,
            workspace_overview,
            commit_local_scan_card,
            list_conversation,
            append_user_message,
            onboarding,
            cancel_onboarding,
            retry_onboarding,
            service_grants,
            sidecar_status,
            start_configured_opening,
            start_agent_turn,
            get_agent_turn,
            get_agent_turn_by_request,
            cancel_agent_turn,
            get_outbound_review,
            decide_outbound_review,
            shell_snapshot,
            hide_window,
            quit_app,
            configure_stepfun_session,
            clear_stepfun_session,
            stepfun_session_status,
            set_model_grant,
            get_opinion,
            list_workspace_opinions,
            submit_opinion_feedback,
            revert_memory_operation,
            search_workspace_memory,
            get_message_evidence,
            list_memory_receipts,
            get_narrative_state,
            observe_workspace,
            list_attention_items,
            dismiss_attention_item,
            set_search_grant,
            get_search_config,
            save_search_config,
            set_observer_paused
        ])
        .run(tauri::generate_context!())
        .expect("hark desktop failed to start");
}

#[cfg(test)]
mod outbound_review_tests {
    use super::{OutboundReviewDecision, OutboundReviewRef};

    #[test]
    fn review_commands_reject_replacement_contents_and_unknown_decisions() {
        assert!(serde_json::from_str::<OutboundReviewRef>(
            r#"{"workspaceId":"ws","runId":"run","reviewId":"review"}"#
        )
        .is_ok());
        assert!(serde_json::from_str::<OutboundReviewDecision>(
            r#"{"workspaceId":"ws","runId":"run","reviewId":"review","decision":"approve"}"#
        )
        .is_ok());
        assert!(serde_json::from_str::<OutboundReviewRef>(
            r#"{"workspaceId":"ws","runId":"run","reviewId":"review","body":"replacement"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<OutboundReviewDecision>(
            r#"{"workspaceId":"ws","runId":"run","reviewId":"review","decision":"approve","recipient":"https://attacker.invalid"}"#
        ).is_err());
        assert!(serde_json::from_str::<OutboundReviewDecision>(
            r#"{"workspaceId":"ws","runId":"run","reviewId":"review","decision":"send"}"#
        )
        .is_err());
    }
}
