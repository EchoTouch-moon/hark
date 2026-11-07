use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use hark_core::{
    AuthorizedRoot, CancelFlag, CandidateId, ConfirmImport, ConfirmResult, ConversationEvent, Core,
    FirstMessage, ImportMode, InitialScan, OnboardingCheckpoint, RootId, RunId, ScanBudget, ScanId,
    SelectiveReadReport, ServiceGrant, ServiceGrantUpdate, ServiceKind, ServiceStatus,
    SessionBinding, SourceId, SourceRef, Workspace, WorkspaceId, WorkspaceOverview,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::bridge::{
    map_agent_turn_status, unknown_agent_turn_status, AgentTurnAccepted, AgentTurnRequest,
    AgentTurnStatus, DevSidecarConfig, OpeningBridgeResult, ProtocolProbe, SidecarSupervisor,
    TurnProgress,
};
use crate::cognition::{
    MessageEvidenceRequest, OpinionFeedbackRequest, OpinionRequest, RevertMemoryRequest,
};
use crate::error::ShellError;
use crate::process::StopReport;
use crate::seam::SidecarStatus;

/// Short enough that a leaked token cannot be reused later, long enough for a
/// person to confirm the picker result in the dev form.
pub const PICK_TTL_MS: u64 = 120_000;

/// Rust-only admission used by the native picker callback and by tests.
/// Not a frontend command. The frontend never supplies the path.
pub const CONTROLLED_PICK_ENTRY: &str = "NativeShell::stage_native_pick";

/// Commands the Tauri window may invoke. Anything absent is not a frontend API.
pub const FRONTEND_COMMANDS: &[&str] = &[
    "pick_directory",
    "authorize_picked",
    "list_roots",
    "pause_directory",
    "resume_directory",
    "revoke_directory",
    "scan_root",
    "cancel_scan",
    "get_scan",
    "confirm_import",
    "list_workspaces",
    "get_workspace",
    "selective_key_read",
    "cancel_read",
    "list_source_refs",
    "get_source_ref",
    "workspace_overview",
    "commit_local_scan_card",
    "list_conversation",
    "append_user_message",
    "onboarding",
    "cancel_onboarding",
    "retry_onboarding",
    "service_grants",
    "sidecar_status",
    "start_configured_opening",
    "start_agent_turn",
    "get_agent_turn",
    "cancel_agent_turn",
    "hide_window",
    "quit_app",
    "shell_snapshot",
    "configure_stepfun_session",
    "clear_stepfun_session",
    "stepfun_session_status",
    "set_model_grant",
    "get_opinion",
    "list_workspace_opinions",
    "submit_opinion_feedback",
    "revert_memory_operation",
    "search_workspace_memory",
    "get_message_evidence",
    "list_memory_receipts",
];

pub fn business_db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("hark-r1").join("business.sqlite")
}

fn app_data_dir_of(db_path: &Path) -> PathBuf {
    if db_path.file_name().and_then(|name| name.to_str()) == Some("business.sqlite") {
        if let Some(parent) = db_path.parent() {
            if parent.file_name().and_then(|name| name.to_str()) == Some("hark-r1") {
                if let Some(app) = parent.parent() {
                    return app.to_path_buf();
                }
            }
            return parent.to_path_buf();
        }
    }
    db_path.parent().unwrap_or(db_path).to_path_buf()
}

fn accept_session_key(value: &str) -> Result<(), ShellError> {
    if value.len() < 8
        || value.len() > 512
        || value
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace() || ch == '/' || ch == '\\')
    {
        return Err(ShellError::new(
            "session_key_rejected",
            "key must be a single token for this run",
        ));
    }
    Ok(())
}

fn wipe_key(slot: &mut Option<String>) {
    if let Some(value) = slot.take() {
        let mut bytes = value.into_bytes();
        for byte in &mut bytes {
            *byte = 0;
        }
        drop(bytes);
    }
}

fn dev_repo_root() -> Result<PathBuf, ShellError> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let canon = root.canonicalize().map_err(|_| {
        ShellError::new(
            "dev_runtime_missing",
            "repo root missing; packaging is not done",
        )
    })?;
    if !canon.join("packages/agent-host/src/sidecar.ts").is_file() {
        return Err(ShellError::new(
            "dev_runtime_missing",
            "packaging is not done; sidecar.ts is dev-only",
        ));
    }
    Ok(canon)
}

fn dev_node22() -> Result<PathBuf, ShellError> {
    for candidate in ["/usr/local/bin/node", "/opt/homebrew/bin/node"] {
        let path = PathBuf::from(candidate);
        if !path.is_file() {
            continue;
        }
        let Ok(output) = Command::new(&path).arg("-v").output() else {
            continue;
        };
        let text = String::from_utf8_lossy(&output.stdout);
        if text.trim().starts_with("v22.") {
            return Ok(path);
        }
    }
    Err(ShellError::new(
        "dev_runtime_missing",
        "packaging is not done. This session path is dev-only and needs Node 22.",
    ))
}

fn write_keyless_slot(path: &Path) -> Result<(), ShellError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| ShellError::new("io", err.to_string()))?;
    }
    let body = serde_json::json!({
        "enabled": true,
        "providerId": STEPFUN_PROVIDER,
        "modelId": STEPFUN_MODEL,
        "baseUrl": STEPFUN_BASE,
        "wire": "anthropic-messages",
        "allowRemote": true,
        "keyStorage": "process-memory",
        "authenticated": false
    });
    let text =
        serde_json::to_string(&body).map_err(|err| ShellError::new("io", err.to_string()))?;
    if text.contains("apiKey") {
        return Err(ShellError::new(
            "secret_material_rejected",
            "metadata writer refused a key field",
        ));
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &text).map_err(|err| ShellError::new("io", err.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, path).map_err(|err| ShellError::new("io", err.to_string()))?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickTicket {
    pub pick_token: String,
    pub display_name: String,
    pub expires_at_unix_ms: u64,
    pub directory_read: &'static str,
    pub remote_model: &'static str,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizeRequest {
    pub pick_token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdRequest {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceRef {
    pub workspace_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRefRequest {
    pub workspace_id: String,
    pub source_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserMessageRequest {
    pub workspace_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpeningRequest {
    pub workspace_id: String,
}

/// Frontend sends only the key. Paths, model, and endpoint are not fields.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StepFunKeyRequest {
    pub api_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelGrantRequest {
    pub workspace_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepFunSessionStatus {
    pub configured: bool,
    /// Saving a key does not call the model and does not prove the key works.
    pub authenticated: bool,
    pub provider: &'static str,
    pub model: &'static str,
    pub base_url: &'static str,
    pub wire: &'static str,
    pub dev_only: bool,
    pub packaging: &'static str,
    pub sidecar_connected: bool,
    pub restart_requires_key: bool,
}

const STEPFUN_PROVIDER: &str = "stepfun";
const STEPFUN_MODEL: &str = "step-3.7-flash";
const STEPFUN_BASE: &str = "https://api.stepfun.com/step_plan";

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Selection {
    Single,
    Selected { candidate_ids: Vec<String> },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmRequest {
    pub root_id: String,
    pub scan_id: String,
    pub selection: Selection,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSnapshot {
    pub roots: Vec<AuthorizedRoot>,
    pub workspaces: Vec<Workspace>,
    pub reader_capability: String,
    /// This process never calls a model, even if a future database row says enabled.
    pub remote_model_transport: &'static str,
    pub sidecar: SidecarStatus,
    pub notes: Vec<&'static str>,
}

struct PendingPick {
    path: PathBuf,
    expires_at_unix_ms: u64,
}

pub struct NativeShell {
    sidecar: SidecarSupervisor,
    core: Arc<Core>,
    picks: Mutex<HashMap<String, PendingPick>>,
    scan_flags: Mutex<HashMap<String, Arc<CancelFlag>>>,
    read_flags: Mutex<HashMap<String, Arc<CancelFlag>>>,
    armed_scan_cancel: Mutex<HashMap<String, CancelFlag>>,
    /// Test injection. Runs after a scan publishes its flag and before Core walks.
    /// Not a Tauri command. Production leaves this unset.
    scan_hold: Mutex<Option<TaskHold>>,
    /// Test injection. Same point for selective reads. Not a Tauri command.
    read_hold: Mutex<Option<TaskHold>>,
    clock_unix_ms: Arc<dyn Fn() -> u64 + Send + Sync>,
    quit_requested: AtomicBool,
    app_data_dir: PathBuf,
    session_key: Mutex<Option<String>>,
}

type TaskHold = Arc<dyn Fn() + Send + Sync>;

impl NativeShell {
    pub fn open(db_path: &Path) -> Result<Self, ShellError> {
        Self::open_with_clock(db_path, system_unix_ms)
    }

    pub fn open_with_clock(
        db_path: &Path,
        clock_unix_ms: impl Fn() -> u64 + Send + Sync + 'static,
    ) -> Result<Self, ShellError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| ShellError::new("io", err.to_string()))?;
        }
        let core = Arc::new(Core::open(db_path)?);
        Ok(Self {
            sidecar: SidecarSupervisor::new(Arc::clone(&core)),
            core,
            picks: Mutex::new(HashMap::new()),
            scan_flags: Mutex::new(HashMap::new()),
            read_flags: Mutex::new(HashMap::new()),
            armed_scan_cancel: Mutex::new(HashMap::new()),
            scan_hold: Mutex::new(None),
            read_hold: Mutex::new(None),
            clock_unix_ms: Arc::new(clock_unix_ms),
            quit_requested: AtomicBool::new(false),
            app_data_dir: app_data_dir_of(db_path),
            session_key: Mutex::new(None),
        })
    }

    pub fn request_quit(&self) {
        self.quit_requested.store(true, Ordering::SeqCst);
        let _ = self.sidecar.stop();
    }

    pub fn quit_requested(&self) -> bool {
        self.quit_requested.load(Ordering::SeqCst)
    }

    pub fn snapshot(&self) -> Result<ShellSnapshot, ShellError> {
        Ok(ShellSnapshot {
            roots: self.core.list_roots()?,
            workspaces: self.core.list_workspaces()?,
            reader_capability: self.core.reader_capability().to_string(),
            remote_model_transport: if self.session_key_present() {
                "stepfun_session_memory"
            } else {
                "closed_no_approved_key"
            },
            sidecar: self.sidecar.status(),
            notes: if self.session_key_present() {
                vec![
                    "目录读取与远程模型是两种许可。",
                    "StepFun Key 只在本次运行内存。重启后要重新填写，不会读取全局凭据。",
                    "保存不表示 Key 已认证，也不会自动发请求。",
                    "打包未做。这条模型路径是 dev-only。",
                ]
            } else {
                vec![
                    "目录读取与远程模型是两种许可。",
                    "未配置时不启动 Sidecar、不读 Key、不写开场，也不伪造普通聊天回复。",
                    "本地发现卡不是模型分析。开场只在 Core 提交成功后折叠。",
                    "Windows 未实现 Job Object 时 Sidecar 默认关闭。",
                ]
            },
        })
    }

    /// Store a path that the OS picker, or a test, already resolved.
    /// Returns a display name only. The path stays in this process.
    pub fn stage_native_pick(&self, path: &Path) -> Result<PickTicket, ShellError> {
        let meta = std::fs::metadata(path)
            .map_err(|_| ShellError::new("pick_not_a_directory", "选择结果不存在或不可读取"))?;
        if !meta.is_dir() {
            return Err(ShellError::new("pick_not_a_directory", "选择结果不是目录"));
        }
        let now = (self.clock_unix_ms)();
        let token = format!("pick_{}", Uuid::new_v4().simple());
        let expires_at_unix_ms = now.saturating_add(PICK_TTL_MS);
        let display_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty() && !name.contains('/') && !name.contains('\\'))
            .unwrap_or("已选择目录")
            .to_string();
        self.picks
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "pending pick lock"))?
            .insert(
                token.clone(),
                PendingPick {
                    path: path.to_path_buf(),
                    expires_at_unix_ms,
                },
            );
        Ok(PickTicket {
            pick_token: token,
            display_name,
            expires_at_unix_ms,
            directory_read: "尚未授权。确认 token 后才会做本地只读初扫。",
            remote_model: "未调用。模型授权关闭。",
        })
    }

    pub fn authorize_picked(&self, pick_token: &str) -> Result<AuthorizedRoot, ShellError> {
        let pending = {
            let mut picks = self
                .picks
                .lock()
                .map_err(|_| ShellError::new("lock_poisoned", "pending pick lock"))?;
            let Some(pending) = picks.remove(pick_token) else {
                return Err(ShellError::new(
                    "pick_not_found",
                    "token 不存在。前端不能用路径代替 token。",
                ));
            };
            pending
        };
        let now = (self.clock_unix_ms)();
        if now > pending.expires_at_unix_ms {
            return Err(ShellError::new(
                "pick_expired",
                "目录选择已过期，请重新选择",
            ));
        }
        self.core
            .authorize_directory(&pending.path)
            .map_err(Into::into)
    }

    pub fn list_roots(&self) -> Result<Vec<AuthorizedRoot>, ShellError> {
        Ok(self.core.list_roots()?)
    }

    pub fn pause_directory(&self, root_id: &str) -> Result<AuthorizedRoot, ShellError> {
        Ok(self.core.pause_directory(&parse_root(root_id)?)?)
    }

    pub fn resume_directory(&self, root_id: &str) -> Result<AuthorizedRoot, ShellError> {
        Ok(self.core.resume_directory(&parse_root(root_id)?)?)
    }

    pub fn revoke_directory(&self, root_id: &str) -> Result<AuthorizedRoot, ShellError> {
        Ok(self.core.revoke_directory(&parse_root(root_id)?)?)
    }

    /// Test/dev hook so cancel can be proven without a race. Not a Tauri command.
    pub fn arm_scan_cancel(&self, root_id: &str) -> Result<(), ShellError> {
        let flag = CancelFlag::new();
        flag.cancel();
        self.armed_scan_cancel
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "scan cancel lock"))?
            .insert(root_id.to_string(), flag);
        Ok(())
    }

    pub fn scan_root(&self, root_id: &str) -> Result<InitialScan, ShellError> {
        let id = parse_root(root_id)?;
        let lease = publish_exclusive(
            &self.scan_flags,
            root_id,
            || {
                Ok(self
                    .armed_scan_cancel
                    .lock()
                    .map_err(|_| ShellError::new("lock_poisoned", "scan cancel lock"))?
                    .remove(root_id)
                    .unwrap_or_else(CancelFlag::new))
            },
            "scan_already_running",
            "同一目录已有进行中的初扫",
            "scan flag lock",
        )?;
        self.invoke_hold(&self.scan_hold)?;
        let result = self
            .core
            .run_initial_scan(&id, &ScanBudget::default(), &lease.flag);
        Ok(result?)
    }

    pub fn cancel_scan(&self, root_id: &str) -> Result<(), ShellError> {
        let flags = self
            .scan_flags
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "scan flag lock"))?;
        let Some(flag) = flags.get(root_id) else {
            return Err(ShellError::new("scan_not_running", "没有进行中的初扫"));
        };
        flag.cancel();
        Ok(())
    }

    pub fn get_scan(&self, scan_id: &str) -> Result<InitialScan, ShellError> {
        Ok(self.core.get_scan(&parse_scan(scan_id)?)?)
    }

    pub fn confirm_import(&self, request: &ConfirmRequest) -> Result<ConfirmResult, ShellError> {
        let mode = match &request.selection {
            Selection::Single => ImportMode::SingleProject,
            Selection::Selected { candidate_ids } => {
                if candidate_ids.is_empty() {
                    return Err(ShellError::new("candidate_not_in_scan", "没有选中候选"));
                }
                let mut ids = Vec::with_capacity(candidate_ids.len());
                for id in candidate_ids {
                    ids.push(parse_candidate(id)?);
                }
                ImportMode::SelectedCandidates { candidate_ids: ids }
            }
        };
        // Model initial-read intent stays false until a real key source is approved.
        let req = ConfirmImport {
            root_id: parse_root(&request.root_id)?,
            scan_id: parse_scan(&request.scan_id)?,
            mode,
            enable_model_initial_read: false,
        };
        Ok(self.core.confirm_import(&req)?)
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>, ShellError> {
        Ok(self.core.list_workspaces()?)
    }

    pub fn get_workspace(&self, workspace_id: &str) -> Result<Workspace, ShellError> {
        Ok(self.core.get_workspace(&parse_workspace(workspace_id)?)?)
    }

    pub fn selective_key_read(
        &self,
        workspace_id: &str,
    ) -> Result<SelectiveReadReport, ShellError> {
        let id = parse_workspace(workspace_id)?;
        let lease = publish_exclusive(
            &self.read_flags,
            workspace_id,
            || Ok(CancelFlag::new()),
            "read_already_running",
            "同一工作区已有进行中的选择性读取",
            "read flag lock",
        )?;
        self.invoke_hold(&self.read_hold)?;
        let result = self
            .core
            .selective_key_read(&id, &ScanBudget::default(), &lease.flag);
        Ok(result?)
    }

    pub fn cancel_read(&self, workspace_id: &str) -> Result<(), ShellError> {
        let flags = self
            .read_flags
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "read flag lock"))?;
        let Some(flag) = flags.get(workspace_id) else {
            return Err(ShellError::new(
                "read_not_running",
                "没有进行中的选择性读取",
            ));
        };
        flag.cancel();
        Ok(())
    }

    pub fn list_source_refs(&self, workspace_id: &str) -> Result<Vec<SourceRef>, ShellError> {
        Ok(self
            .core
            .list_source_refs(&parse_workspace(workspace_id)?)?)
    }

    pub fn get_source_ref(
        &self,
        workspace_id: &str,
        source_id: &str,
    ) -> Result<SourceRef, ShellError> {
        Ok(self
            .core
            .get_source_ref(&parse_workspace(workspace_id)?, &parse_source(source_id)?)?)
    }

    pub fn workspace_overview(&self, workspace_id: &str) -> Result<WorkspaceOverview, ShellError> {
        Ok(self
            .core
            .workspace_overview(&parse_workspace(workspace_id)?)?)
    }

    pub fn commit_local_scan_card(&self, workspace_id: &str) -> Result<FirstMessage, ShellError> {
        Ok(self
            .core
            .commit_local_scan_card(&parse_workspace(workspace_id)?)?)
    }

    pub fn get_opinion(
        &self,
        request: &OpinionRequest,
    ) -> Result<hark_core::OpinionView, ShellError> {
        let workspace_id = parse_workspace(&request.workspace_id)?;
        let opinion = self.core.get_opinion(&request.opinion_id)?;
        if opinion.workspace_id != workspace_id {
            return Err(ShellError::new(
                "cross_workspace_ref",
                "opinion belongs to another workspace",
            ));
        }
        Ok(opinion)
    }

    pub fn list_workspace_opinions(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<hark_core::OpinionView>, ShellError> {
        Ok(self
            .core
            .list_workspace_opinions(&parse_workspace(workspace_id)?)?)
    }

    pub fn submit_opinion_feedback(
        &self,
        request: &OpinionFeedbackRequest,
    ) -> Result<hark_core::OpinionView, ShellError> {
        Ok(self
            .core
            .submit_opinion_feedback(&hark_core::OpinionFeedbackInput {
                request_id: request.request_id.clone(),
                workspace_id: parse_workspace(&request.workspace_id)?,
                opinion_id: request.opinion_id.clone(),
                expected_revision: request.expected_revision,
                action: request.action,
                user_comment: request.user_comment.clone(),
                caller: hark_core::MemoryCaller::User,
            })?)
    }

    pub fn revert_memory_operation(
        &self,
        request: &RevertMemoryRequest,
    ) -> Result<hark_core::MemoryReceipt, ShellError> {
        Ok(self.core.revert_memory_operation(
            &parse_workspace(&request.workspace_id)?,
            &request.operation_id,
        )?)
    }

    pub fn search_workspace_memory(
        &self,
        request: &hark_core::MemorySearchInput,
    ) -> Result<hark_core::MemorySearchPage, ShellError> {
        Ok(self.core.search_workspace_memory(request)?)
    }

    pub fn list_memory_receipts(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<hark_core::MemoryReceipt>, ShellError> {
        Ok(self
            .core
            .list_workspace_memory_receipts(&parse_workspace(workspace_id)?)?)
    }

    pub fn get_message_evidence(
        &self,
        request: &MessageEvidenceRequest,
    ) -> Result<ConversationEvent, ShellError> {
        let message_id = hark_core::MessageId::parse(&request.message_id)
            .map_err(|_| ShellError::new("invalid_id", "message id"))?;
        self.list_conversation(&request.workspace_id)?
            .into_iter()
            .find(|event| event.id == message_id)
            .ok_or_else(|| {
                ShellError::new("source_ref_not_found", "message is not in this workspace")
            })
    }

    pub fn list_conversation(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<ConversationEvent>, ShellError> {
        Ok(self
            .core
            .list_conversation(&parse_workspace(workspace_id)?)?)
    }

    pub fn append_user_message(
        &self,
        workspace_id: &str,
        text: &str,
    ) -> Result<ConversationEvent, ShellError> {
        Ok(self
            .core
            .append_user_message(&parse_workspace(workspace_id)?, text)?)
    }

    pub fn onboarding(&self, workspace_id: &str) -> Result<OnboardingCheckpoint, ShellError> {
        Ok(self.core.onboarding(&parse_workspace(workspace_id)?)?)
    }

    pub fn cancel_onboarding(
        &self,
        workspace_id: &str,
    ) -> Result<OnboardingCheckpoint, ShellError> {
        let _ = self.sidecar.cancel(workspace_id);
        Ok(self
            .core
            .cancel_onboarding(&parse_workspace(workspace_id)?)?)
    }

    pub fn retry_onboarding(&self, workspace_id: &str) -> Result<OnboardingCheckpoint, ShellError> {
        Ok(self
            .core
            .retry_onboarding(&parse_workspace(workspace_id)?)?)
    }

    pub fn service_grants(&self, workspace_id: &str) -> Result<Vec<ServiceGrant>, ShellError> {
        let id = parse_workspace(workspace_id)?;
        let mut grants = Vec::with_capacity(4);
        for service in [
            ServiceKind::Model,
            ServiceKind::Search,
            ServiceKind::BackgroundModel,
            ServiceKind::Notification,
        ] {
            grants.push(self.core.get_service_grant(&id, service)?);
        }
        Ok(grants)
    }

    /// Test hook. Not a Tauri command. The callback runs on the scan thread after
    /// the cancel flag is published and before Core walks, so a test can overlap
    /// a second call without sleeping.
    pub fn set_scan_hold(&self, hold: Option<TaskHold>) -> Result<(), ShellError> {
        *self
            .scan_hold
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "scan hold"))? = hold;
        Ok(())
    }

    /// Test hook. Not a Tauri command. Same publish point as `set_scan_hold`.
    pub fn set_read_hold(&self, hold: Option<TaskHold>) -> Result<(), ShellError> {
        *self
            .read_hold
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "read hold"))? = hold;
        Ok(())
    }

    fn invoke_hold(&self, slot: &Mutex<Option<TaskHold>>) -> Result<(), ShellError> {
        let hold = slot
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "task hold"))?
            .clone();
        if let Some(hold) = hold {
            hold();
        }
        Ok(())
    }

    /// Not registered as a command. A relative path is not an authorization.
    pub fn read_workspace_file_closed(&self) -> Result<(), ShellError> {
        Err(ShellError::new(
            "path_read_closed",
            "前端不能传相对路径读取。本壳只提供 selective_key_read。",
        ))
    }

    pub fn sidecar_status(&self) -> SidecarStatus {
        self.sidecar.status()
    }

    /// Trusted process config. Not a Tauri command and not a frontend path.
    pub fn configure_dev_sidecar(&self, config: DevSidecarConfig) -> Result<(), ShellError> {
        self.sidecar.configure(config)
    }

    /// Store a run-only key, write keyless metadata, and start the dev sidecar.
    /// This does not call the model and does not authorize every workspace.
    pub fn configure_stepfun_session(
        &self,
        api_key: &str,
    ) -> Result<StepFunSessionStatus, ShellError> {
        accept_session_key(api_key)?;
        let repo = dev_repo_root()?;
        let node = dev_node22()?;
        let slot_path = self.provider_slot_path();
        write_keyless_slot(&slot_path)?;
        {
            let mut guard = self
                .session_key
                .lock()
                .map_err(|_| ShellError::new("lock_poisoned", "session key"))?;
            wipe_key(&mut guard);
            *guard = Some(api_key.to_string());
        }
        if self.sidecar.status().connected || self.sidecar.pid().is_some() {
            let _ = self.sidecar.stop();
        }
        let config = DevSidecarConfig {
            node_path: node,
            host_entry: repo.join("packages/agent-host/src/sidecar.ts"),
            app_data_dir: self.app_data_dir.clone(),
            working_dir: repo,
            provider_config_path: slot_path,
            scripted_transport_path: None,
            run_timeout_ms: 60_000,
        };
        if let Err(err) = self.sidecar.configure_session(config, api_key) {
            self.rollback_session();
            return Err(err);
        }
        if let Err(err) = self.sidecar.start() {
            self.rollback_session();
            return Err(ShellError::new(
                err.code,
                "sidecar did not become ready. No model request was sent.",
            ));
        }
        self.session_status()
    }

    pub fn clear_stepfun_session(&self) -> Result<StepFunSessionStatus, ShellError> {
        self.rollback_session();
        self.session_status()
    }

    pub fn stepfun_session_status(&self) -> Result<StepFunSessionStatus, ShellError> {
        self.session_status()
    }

    /// Enable or disable the model grant for one workspace. Does not read or send the key.
    pub fn set_model_grant(
        &self,
        workspace_id: &str,
        enabled: bool,
    ) -> Result<ServiceGrant, ShellError> {
        Ok(self.core.set_service_grant(&ServiceGrantUpdate {
            workspace_id: parse_workspace(workspace_id)?,
            service: ServiceKind::Model,
            status: if enabled {
                ServiceStatus::Enabled
            } else {
                ServiceStatus::Disabled
            },
            provider: if enabled {
                Some(STEPFUN_PROVIDER.to_string())
            } else {
                None
            },
            model: if enabled {
                Some(STEPFUN_MODEL.to_string())
            } else {
                None
            },
        })?)
    }

    fn provider_slot_path(&self) -> PathBuf {
        self.app_data_dir.join("hark-r1").join("provider-slot.json")
    }

    fn session_key_present(&self) -> bool {
        self.session_key
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    fn session_status(&self) -> Result<StepFunSessionStatus, ShellError> {
        Ok(StepFunSessionStatus {
            configured: self.session_key_present(),
            authenticated: false,
            provider: STEPFUN_PROVIDER,
            model: STEPFUN_MODEL,
            base_url: STEPFUN_BASE,
            wire: "anthropic-messages",
            dev_only: true,
            packaging: "not_packaged",
            sidecar_connected: self.sidecar.status().connected,
            restart_requires_key: true,
        })
    }

    fn rollback_session(&self) {
        if let Ok(mut guard) = self.session_key.lock() {
            wipe_key(&mut guard);
        }
        let _ = fs::remove_file(self.provider_slot_path());
        let _ = self.sidecar.stop();
    }

    pub fn start_configured_sidecar(&self) -> Result<SidecarStatus, ShellError> {
        self.sidecar.start()
    }

    pub fn stop_sidecar(&self) -> Result<StopReport, ShellError> {
        self.sidecar.stop()
    }

    pub fn run_configured_opening(
        &self,
        workspace_id: &str,
    ) -> Result<OpeningBridgeResult, ShellError> {
        self.sidecar.opening(workspace_id)
    }

    /// Trusted ordinary turn. Frontend supplies only the four request fields.
    /// Register and commit stay inside this process.
    pub fn start_agent_turn(
        &self,
        request: AgentTurnRequest,
        progress: TurnProgress,
    ) -> Result<AgentTurnAccepted, ShellError> {
        self.sidecar.conversation(request, progress)
    }

    pub fn agent_turn_status(
        &self,
        workspace_id: &str,
        run_id: &str,
    ) -> Result<AgentTurnStatus, ShellError> {
        let ws = parse_workspace(workspace_id)?;
        let id = parse_run(run_id)?;
        match self.core.get_conversation_run(&ws, &id) {
            Ok(run) => Ok(map_agent_turn_status(&run)),
            Err(err) if err.code_str() == "run_mismatch" => {
                Err(ShellError::new("run_mismatch", "run_not_found"))
            }
            Err(_) => Ok(unknown_agent_turn_status(workspace_id, run_id)),
        }
    }

    pub fn cancel_agent_turn(
        &self,
        workspace_id: &str,
        run_id: &str,
    ) -> Result<AgentTurnStatus, ShellError> {
        let _ = self.sidecar.cancel_turn(workspace_id, run_id);
        let ws = parse_workspace(workspace_id)?;
        let id = parse_run(run_id)?;
        match self.core.cancel_conversation_run(&ws, &id) {
            Ok(run) => Ok(map_agent_turn_status(&run)),
            Err(_) => self.agent_turn_status(workspace_id, run_id),
        }
    }

    pub fn close_sidecar_stdin(&self) -> Result<(), ShellError> {
        self.sidecar.close_stdin()
    }

    pub fn kill_sidecar_child(&self) -> Result<(), ShellError> {
        self.sidecar.kill_child()
    }

    pub fn probe_host_protocol(&self) -> Result<ProtocolProbe, ShellError> {
        self.sidecar.probe_protocol()
    }

    pub fn sidecar_stderr(&self) -> String {
        self.sidecar.stderr_tail()
    }

    pub fn sidecar_pid(&self) -> Option<u32> {
        self.sidecar.pid()
    }

    /// Test injection. Not a Tauri command.
    pub fn set_before_tool_reply_hook(&self, hook: Option<Arc<dyn Fn(&str) + Send + Sync>>) {
        self.sidecar.set_before_tool_reply(hook);
    }

    /// Test injection. Not a Tauri command.
    pub fn set_mismatch_next_tool(&self, enabled: bool) {
        self.sidecar.set_mismatch_next_tool(enabled);
    }

    /// Test injection. Not a Tauri command.
    pub fn set_opening_read_budget(&self, files: u32) {
        self.sidecar.set_read_budget(files);
    }

    /// Synthetic model permit for local probes. Not registered as frontend IPC.
    pub fn dev_set_synthetic_model_grant(
        &self,
        workspace_id: &str,
        provider: &str,
        model: &str,
    ) -> Result<ServiceGrant, ShellError> {
        if provider.contains("key")
            || model.contains("key")
            || provider.len() > 64
            || model.len() > 64
        {
            return Err(ShellError::new(
                "secret_material_rejected",
                "synthetic grant labels must not look like credentials",
            ));
        }
        Ok(self.core.set_service_grant(&ServiceGrantUpdate {
            workspace_id: parse_workspace(workspace_id)?,
            service: ServiceKind::Model,
            status: ServiceStatus::Enabled,
            provider: Some(provider.to_string()),
            model: Some(model.to_string()),
        })?)
    }

    pub fn opening_session_binding(
        &self,
        workspace_id: &str,
    ) -> Result<Option<SessionBinding>, ShellError> {
        Ok(self
            .core
            .opening_session_binding(&parse_workspace(workspace_id)?)?)
    }

    /// Test/restore helper. Not a frontend command and not the opening binding.
    pub fn latest_ordinary_session_ref(
        &self,
        workspace_id: &str,
    ) -> Result<Option<String>, ShellError> {
        Ok(self
            .core
            .latest_ordinary_session(&parse_workspace(workspace_id)?)?
            .map(|hint| hint.session_ref))
    }
}

/// One published cancel flag per key. A duplicate call is rejected under this
/// lock, so the key stays owned by this lease until drop. Removal still matches
/// the Arc: a late drop cannot clear a different task's flag. No generation table.
struct FlagLease<'a> {
    map: &'a Mutex<HashMap<String, Arc<CancelFlag>>>,
    key: String,
    flag: Arc<CancelFlag>,
}

impl Drop for FlagLease<'_> {
    fn drop(&mut self) {
        let mut flags = match self.map.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if flags
            .get(&self.key)
            .is_some_and(|current| Arc::ptr_eq(current, &self.flag))
        {
            flags.remove(&self.key);
        }
    }
}

fn publish_exclusive<'a>(
    map: &'a Mutex<HashMap<String, Arc<CancelFlag>>>,
    key: &str,
    make_flag: impl FnOnce() -> Result<CancelFlag, ShellError>,
    busy_code: &'static str,
    busy_detail: &'static str,
    lock_detail: &'static str,
) -> Result<FlagLease<'a>, ShellError> {
    let mut flags = map
        .lock()
        .map_err(|_| ShellError::new("lock_poisoned", lock_detail))?;
    if flags.contains_key(key) {
        return Err(ShellError::new(busy_code, busy_detail));
    }
    let flag = Arc::new(make_flag()?);
    flags.insert(key.to_string(), Arc::clone(&flag));
    Ok(FlagLease {
        map,
        key: key.to_string(),
        flag,
    })
}

fn system_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn parse_root(value: &str) -> Result<RootId, ShellError> {
    RootId::parse(value).map_err(|_| ShellError::new("invalid_id", "root id"))
}

fn parse_scan(value: &str) -> Result<ScanId, ShellError> {
    ScanId::parse(value).map_err(|_| ShellError::new("invalid_id", "scan id"))
}

fn parse_candidate(value: &str) -> Result<CandidateId, ShellError> {
    CandidateId::parse(value).map_err(|_| ShellError::new("invalid_id", "candidate id"))
}

fn parse_workspace(value: &str) -> Result<WorkspaceId, ShellError> {
    WorkspaceId::parse(value).map_err(|_| ShellError::new("invalid_id", "workspace id"))
}

fn parse_run(value: &str) -> Result<RunId, ShellError> {
    RunId::parse(value).map_err(|_| ShellError::new("invalid_id", "run id"))
}

fn parse_source(value: &str) -> Result<SourceId, ShellError> {
    SourceId::parse(value).map_err(|_| ShellError::new("invalid_id", "source id"))
}
