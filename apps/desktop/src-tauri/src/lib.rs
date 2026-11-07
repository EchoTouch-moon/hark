use hark_native_shell::{
    decide_window_close, AgentTurnRef, AgentTurnRequest, AuthorizeRequest, ConfirmRequest,
    ModelGrantRequest, NativeShell, OpeningRequest, ShellError, SourceRefRequest,
    StepFunKeyRequest, TurnProgress, UserMessageRequest, WindowCloseDecision,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;

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
fn cancel_agent_turn(
    shell: tauri::State<'_, NativeShell>,
    request: AgentTurnRef,
) -> Result<hark_native_shell::AgentTurnStatus, ShellError> {
    shell.cancel_agent_turn(&request.workspace_id, &request.run_id)
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
    NativeShell::open(&hark_native_shell::business_db_path(app_data_dir))
}

fn install_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "完全退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut rgba = vec![0_u8; 16 * 16 * 4];
    for pixel in rgba.chunks_exact_mut(4) {
        pixel[1] = 96;
        pixel[2] = 72;
        pixel[3] = 255;
    }
    let icon = tauri::image::Image::new(&rgba, 16, 16);
    TrayIconBuilder::with_id("main")
        .menu(&menu)
        .icon(icon)
        .tooltip("Hark R1 开发入口")
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
            cancel_agent_turn,
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
            list_memory_receipts
        ])
        .run(tauri::generate_context!())
        .expect("hark desktop failed to start");
}
