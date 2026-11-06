//! Core ↔ Host stdio for the first opening run. Not an HTTP server, not a Pi CLI,
//! and not a general execution framework.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{
    self, Receiver, RecvTimeoutError, Sender, SyncSender, TryRecvError, TrySendError,
};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use hark_core::{
    encode_frame, AgentOpeningReceipt, ConversationCommit, ConversationEvent, ConversationRunStart,
    Core, ErrorId, Frame, FrameKind, NdjsonParser, RequestId, RootStatus, RunId, ServiceKind,
    ServiceStatus, SessionBinding, SourceId, WorkspaceId,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::ShellError;
use crate::process::{SpawnedSidecar, StopReport};
use crate::seam::SidecarStatus;

const MAX_READS_DEFAULT: u32 = 8;
const MAX_READ_BYTES: u64 = 256 * 1024;
const HOST_TEXT_CAP: usize = 65_536;
/// stdout → worker frame cap. Same number as the IPC control queue.
/// Overflow closes the affected run and pipe; it is not a second bus.
pub const FRAME_INGRESS_CAP: usize = hark_core::MAX_CONTROL_QUEUE;
const STOP_REPLY_WAIT: Duration = Duration::from_secs(5);
const STOP_JOIN_WAIT: Duration = Duration::from_secs(2);
pub const OPENING_INTERNAL_INSTRUCTION: &str = "Internal first-read instruction for the initial opening run only. Use workspace.overview and workspace.read_file. This text is not a stored Hark user message, not an L0/L1 container, and not evidence of a user decision. There is no memory engine.";

#[derive(Debug, Clone)]
pub struct DevSidecarConfig {
    pub node_path: PathBuf,
    pub host_entry: PathBuf,
    pub app_data_dir: PathBuf,
    pub working_dir: PathBuf,
    pub provider_config_path: PathBuf,
    pub scripted_transport_path: Option<PathBuf>,
    pub run_timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpeningBridgeResult {
    pub workspace_id: String,
    pub run_id: String,
    pub session_ref: String,
    pub source_ids: Vec<String>,
    pub committed: bool,
    pub folded_local_card: bool,
    pub replayed: bool,
    pub node_pid: u32,
    pub transport: &'static str,
    pub step_fun: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolProbe {
    pub duplicate_rejected: bool,
    pub cross_run_rejected: bool,
    pub unknown_reply_rejected: bool,
    pub scripted_invocations: u32,
}

/// Frontend turn input. No success, provider, sessionRef, or completion flag.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentTurnRequest {
    pub request_id: String,
    pub workspace_id: String,
    pub conversation_id: String,
    pub user_prompt: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentTurnRef {
    pub workspace_id: String,
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnAccepted {
    pub run_id: String,
    pub accepted_user_message: ConversationEvent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnErrorBody {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnStatus {
    pub run_id: String,
    pub workspace_id: String,
    pub conversation_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persisted_assistant_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_error: Option<TurnErrorBody>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStreamPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persisted_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persistence_verified: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<TurnErrorBody>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStreamEvent {
    pub schema_version: &'static str,
    pub workspace_id: String,
    pub conversation_id: String,
    pub run_id: String,
    pub seq: u64,
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub payload: RunStreamPayload,
}

/// Per-turn progress. Not a process-wide event bus.
#[derive(Clone)]
pub struct TurnProgress(Arc<dyn Fn(RunStreamEvent) + Send + Sync>);

impl TurnProgress {
    pub fn new(callback: impl Fn(RunStreamEvent) + Send + Sync + 'static) -> Self {
        Self(Arc::new(callback))
    }

    fn emit(&self, event: RunStreamEvent) {
        (self.0)(event);
    }
}

#[derive(Clone)]
struct ProviderSlot {
    provider: String,
    model: String,
    secret: String,
    scripted: bool,
}

struct Hooks {
    before_tool: Mutex<Option<Arc<dyn Fn(&str) + Send + Sync>>>,
    mismatch_next: AtomicBool,
    max_reads: AtomicU32,
    timeout_ms: AtomicU64,
    provider: Mutex<String>,
    model: Mutex<String>,
}

#[derive(Debug)]
enum IngressNote {
    Eof,
    Protocol(#[allow(dead_code)] String),
    Overflow,
}

enum Command {
    Opening {
        workspace_id: String,
        reply: Sender<Result<OpeningBridgeResult, ShellError>>,
    },
    Conversation {
        request_id: String,
        workspace_id: String,
        conversation_id: String,
        user_prompt: String,
        progress: TurnProgress,
        reply: Sender<Result<AgentTurnAccepted, ShellError>>,
    },
    Cancel {
        workspace_id: String,
    },
    CancelTurn {
        workspace_id: String,
        run_id: String,
    },
    CloseStdin,
    KillChild,
    WaitReady {
        reply: Sender<Result<(), ShellError>>,
    },
    Probe {
        reply: Sender<Result<ProtocolProbe, ShellError>>,
    },
    Stop {
        reply: Sender<StopReport>,
    },
}

struct Active {
    reply: Option<Sender<Result<OpeningBridgeResult, ShellError>>>,
    purpose: &'static str,
    client_request_id: String,
    user_message_id: Option<String>,
    user_text: String,
    handoff_id: Option<String>,
    recent_messages: Vec<Value>,
    seq: u64,
    progress: Option<TurnProgress>,
    accepted_event: Option<ConversationEvent>,
    workspace_id: String,
    conversation_id: String,
    run_id: String,
    /// Host frame id. Not the HarkBridge requestId.
    request_id: String,
    provider: String,
    model: String,
    root_id: String,
    root_updated_at: String,
    grant_updated_at: String,
    deadline: u64,
    session_ref: Option<String>,
    receipts: Vec<String>,
    bytes: u64,
    reads: u32,
    candidate: String,
    cancelled: bool,
    timed_out: bool,
    finished: bool,
    node_pid: u32,
}

pub struct SidecarSupervisor {
    core: Arc<Core>,
    config: Mutex<Option<DevSidecarConfig>>,
    slot: Mutex<Option<ProviderSlot>>,
    cmd_tx: Mutex<Option<Sender<Command>>>,
    worker: Mutex<Option<JoinHandle<()>>>,
    zombie: Mutex<Option<JoinHandle<()>>>,
    status: Arc<Mutex<SidecarStatus>>,
    worker_done: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
    stderr: Arc<Mutex<String>>,
    pgid: Arc<AtomicU32>,
    pid: Arc<AtomicU32>,
    hooks: Arc<Hooks>,
    last_stop: Mutex<Option<StopReport>>,
}

impl SidecarSupervisor {
    pub fn new(core: Arc<Core>) -> Self {
        Self {
            core,
            config: Mutex::new(None),
            slot: Mutex::new(None),
            cmd_tx: Mutex::new(None),
            worker: Mutex::new(None),
            zombie: Mutex::new(None),
            status: Arc::new(Mutex::new(disconnected("sidecar_not_configured"))),
            worker_done: Arc::new(AtomicBool::new(true)),
            stop_requested: Arc::new(AtomicBool::new(false)),
            stderr: Arc::new(Mutex::new(String::new())),
            pgid: Arc::new(AtomicU32::new(0)),
            pid: Arc::new(AtomicU32::new(0)),
            hooks: Arc::new(Hooks {
                before_tool: Mutex::new(None),
                mismatch_next: AtomicBool::new(false),
                max_reads: AtomicU32::new(MAX_READS_DEFAULT),
                timeout_ms: AtomicU64::new(60_000),
                provider: Mutex::new(String::new()),
                model: Mutex::new(String::new()),
            }),
            last_stop: Mutex::new(None),
        }
    }

    pub fn status(&self) -> SidecarStatus {
        self.status
            .lock()
            .map(|slot| slot.clone())
            .unwrap_or_else(|_| disconnected("lock_poisoned"))
    }

    pub fn stderr_tail(&self) -> String {
        self.stderr
            .lock()
            .map(|slot| slot.clone())
            .unwrap_or_default()
    }

    pub fn pid(&self) -> Option<u32> {
        let pid = self.pid.load(Ordering::SeqCst);
        if pid == 0 {
            None
        } else {
            Some(pid)
        }
    }

    pub fn set_before_tool_reply(&self, hook: Option<Arc<dyn Fn(&str) + Send + Sync>>) {
        if let Ok(mut slot) = self.hooks.before_tool.lock() {
            *slot = hook;
        }
    }

    pub fn set_mismatch_next_tool(&self, enabled: bool) {
        self.hooks.mismatch_next.store(enabled, Ordering::SeqCst);
    }

    pub fn set_read_budget(&self, files: u32) {
        self.hooks.max_reads.store(files, Ordering::SeqCst);
    }

    pub fn configure(&self, config: DevSidecarConfig) -> Result<(), ShellError> {
        if self
            .worker
            .lock()
            .map(|slot| slot.is_some())
            .unwrap_or(true)
        {
            return Err(ShellError::new(
                "sidecar_running",
                "stop the sidecar before changing its config",
            ));
        }
        let slot = validate_config(&config)?;
        *self
            .slot
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "slot"))? = Some(slot);
        *self
            .config
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "config"))? = Some(config);
        *self
            .status
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "status"))? =
            disconnected("configured_not_started");
        Ok(())
    }

    pub fn start(&self) -> Result<SidecarStatus, ShellError> {
        #[cfg(not(unix))]
        {
            let status = SidecarStatus {
                connected: false,
                transport: "disabled",
                windows_job_object: "not_implemented_sidecar_disabled",
                reason: "Windows Job Object is not implemented. Sidecar stays off.",
            };
            *self
                .status
                .lock()
                .map_err(|_| ShellError::new("lock_poisoned", "status"))? = status.clone();
            return Err(ShellError::new("sidecar_disabled_windows", status.reason));
        }
        #[cfg(unix)]
        {
            if self
                .worker
                .lock()
                .map(|slot| slot.is_some())
                .unwrap_or(true)
            {
                return Err(ShellError::new(
                    "sidecar_running",
                    "sidecar already started",
                ));
            }
            if !self.reap_finished_worker() {
                return Err(ShellError::new(
                    "sidecar_stop_incomplete",
                    "previous worker has not exited; refusing to revive the same core task",
                ));
            }
            self.stop_requested.store(false, Ordering::SeqCst);
            self.worker_done.store(false, Ordering::SeqCst);
            let config = self
                .config
                .lock()
                .map_err(|_| ShellError::new("lock_poisoned", "config"))?
                .clone()
                .ok_or_else(|| {
                    ShellError::new("sidecar_not_configured", "no trusted sidecar config")
                })?;
            let slot = self
                .slot
                .lock()
                .map_err(|_| ShellError::new("lock_poisoned", "slot"))?
                .clone()
                .ok_or_else(|| {
                    ShellError::new("sidecar_not_configured", "provider slot missing")
                })?;
            let fake_home = config.app_data_dir.join("fake-home");
            fs::create_dir_all(&fake_home).map_err(|err| ShellError::new("io", err.to_string()))?;
            let args = spawn_args(&config);
            self.hooks
                .timeout_ms
                .store(config.run_timeout_ms, Ordering::SeqCst);
            if let Ok(mut provider) = self.hooks.provider.lock() {
                *provider = slot.provider.clone();
            }
            if let Ok(mut model) = self.hooks.model.lock() {
                *model = slot.model.clone();
            }
            let (proc, stdout) = SpawnedSidecar::spawn(
                &config.node_path,
                &args,
                &config.working_dir,
                &fake_home,
                &slot.secret,
                Arc::clone(&self.stderr),
            )?;
            self.pid.store(proc.pid, Ordering::SeqCst);
            self.pgid.store(proc.pgid, Ordering::SeqCst);
            let (cmd_tx, cmd_rx) = mpsc::channel();
            let (frame_tx, frame_rx, note_tx, note_rx) = open_frame_ingress();
            spawn_stdout_reader(stdout, frame_tx, note_tx);
            let core = Arc::clone(&self.core);
            let hooks = Arc::clone(&self.hooks);
            let status_for_worker = Arc::clone(&self.status);
            let pgid = Arc::clone(&self.pgid);
            let pid = Arc::clone(&self.pid);
            let stderr_out = Arc::clone(&self.stderr);
            let worker_done = Arc::clone(&self.worker_done);
            let stop_requested = Arc::clone(&self.stop_requested);
            let handle = thread::spawn(move || {
                worker(
                    proc,
                    core,
                    cmd_rx,
                    frame_rx,
                    note_rx,
                    hooks,
                    slot.scripted,
                    status_for_worker,
                    stderr_out,
                    pgid,
                    pid,
                    worker_done,
                    stop_requested,
                );
            });
            *self
                .cmd_tx
                .lock()
                .map_err(|_| ShellError::new("lock_poisoned", "cmd"))? = Some(cmd_tx.clone());
            *self
                .worker
                .lock()
                .map_err(|_| ShellError::new("lock_poisoned", "worker"))? = Some(handle);
            let (ready_tx, ready_rx) = mpsc::channel();
            cmd_tx
                .send(Command::WaitReady { reply: ready_tx })
                .map_err(|_| {
                    ShellError::new("sidecar_not_connected", "worker exited before ready")
                })?;
            match ready_rx.recv_timeout(Duration::from_secs(15)) {
                Ok(Ok(())) => {}
                Ok(Err(err)) => return Err(err),
                Err(_) => {
                    let tail = self
                        .stderr
                        .lock()
                        .map(|slot| slot.clone())
                        .unwrap_or_default();
                    let _ = self.stop();
                    return Err(ShellError::new(
                        "timeout",
                        format!(
                            "host.ready timed out: {}",
                            tail.chars().take(180).collect::<String>()
                        ),
                    ));
                }
            }
            let published = self.status();
            if !published.connected {
                let _ = self.stop();
                return Err(ShellError::new("sidecar_not_connected", published.reason));
            }
            Ok(published)
        }
    }

    pub fn opening(&self, workspace_id: &str) -> Result<OpeningBridgeResult, ShellError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(Command::Opening {
            workspace_id: workspace_id.to_string(),
            reply: reply_tx,
        })?;
        reply_rx
            .recv_timeout(Duration::from_secs(120))
            .map_err(|_| ShellError::new("timeout", "opening bridge timed out"))?
    }

    pub fn cancel(&self, workspace_id: &str) -> Result<(), ShellError> {
        self.send(Command::Cancel {
            workspace_id: workspace_id.to_string(),
        })
    }

    /// Accept an ordinary turn. The model stream continues on this worker and
    /// reports through `progress`. A missing sidecar does not invent a reply.
    pub fn conversation(
        &self,
        request: AgentTurnRequest,
        progress: TurnProgress,
    ) -> Result<AgentTurnAccepted, ShellError> {
        if !self.status().connected {
            return Err(ShellError::new(
                "model_not_configured",
                "sidecar is not connected. No agent reply was invented.",
            ));
        }
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(Command::Conversation {
            request_id: request.request_id,
            workspace_id: request.workspace_id,
            conversation_id: request.conversation_id,
            user_prompt: request.user_prompt,
            progress,
            reply: reply_tx,
        })?;
        reply_rx
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| ShellError::new("timeout", "conversation accept timed out"))?
    }

    pub fn cancel_turn(&self, workspace_id: &str, run_id: &str) -> Result<(), ShellError> {
        self.send(Command::CancelTurn {
            workspace_id: workspace_id.to_string(),
            run_id: run_id.to_string(),
        })
    }

    pub fn close_stdin(&self) -> Result<(), ShellError> {
        self.send(Command::CloseStdin)
    }

    pub fn kill_child(&self) -> Result<(), ShellError> {
        self.send(Command::KillChild)
    }

    pub fn probe_protocol(&self) -> Result<ProtocolProbe, ShellError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(Command::Probe { reply: reply_tx })?;
        reply_rx
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| ShellError::new("timeout", "protocol probe timed out"))?
    }

    pub fn stop(&self) -> Result<StopReport, ShellError> {
        self.stop_requested.store(true, Ordering::SeqCst);
        let pgid = self.pgid.load(Ordering::SeqCst);
        let pid = self.pid.load(Ordering::SeqCst);
        force_kill(pgid);
        process_kill_pid(pid);
        let tx = self
            .cmd_tx
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "cmd"))?
            .take();
        if let Some(tx) = tx {
            let (reply_tx, reply_rx) = mpsc::channel();
            let _ = tx.send(Command::Stop { reply: reply_tx });
            let deadline = Instant::now() + STOP_REPLY_WAIT;
            loop {
                if self.worker_done.load(Ordering::SeqCst) {
                    if let Ok(report) = reply_rx.try_recv() {
                        *self
                            .last_stop
                            .lock()
                            .map_err(|_| ShellError::new("lock_poisoned", "stop"))? = Some(report);
                    }
                    break;
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break;
                }
                match reply_rx.recv_timeout(remaining.min(Duration::from_millis(50))) {
                    Ok(report) => {
                        *self
                            .last_stop
                            .lock()
                            .map_err(|_| ShellError::new("lock_poisoned", "stop"))? = Some(report);
                        break;
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                    Err(RecvTimeoutError::Timeout) => {}
                }
            }
        }
        let handle = self
            .worker
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "worker"))?
            .take();
        let worker_stopped = if let Some(handle) = handle {
            match join_within(handle, STOP_JOIN_WAIT) {
                Ok(()) => true,
                Err(waiter) => {
                    if self.worker_done.load(Ordering::SeqCst) {
                        let _ = waiter.join();
                        true
                    } else {
                        *self
                            .zombie
                            .lock()
                            .map_err(|_| ShellError::new("lock_poisoned", "zombie"))? =
                            Some(waiter);
                        false
                    }
                }
            }
        } else {
            self.reap_finished_worker()
        };
        force_kill(pgid);
        process_kill_pid(pid);
        crate::process::reap_pid(pid);
        self.pid.store(0, Ordering::SeqCst);
        self.pgid.store(0, Ordering::SeqCst);
        let reason = if worker_stopped {
            "stopped"
        } else {
            "stop_timeout"
        };
        *self
            .status
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "status"))? = disconnected(reason);
        let group_alive = crate::process::process_group_alive(pgid);
        let mut report = self
            .last_stop
            .lock()
            .ok()
            .and_then(|slot| slot.clone())
            .unwrap_or(StopReport {
                pid,
                pgid,
                group_alive,
                exited: false,
                forced_kill: pid != 0,
                worker_stopped: false,
            });
        report.group_alive = group_alive;
        report.worker_stopped = worker_stopped;
        report.pid = pid;
        report.pgid = pgid;
        if !worker_stopped || group_alive {
            report.exited = false;
        }
        *self
            .last_stop
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "stop"))? = Some(report.clone());
        Ok(report)
    }

    fn send(&self, msg: Command) -> Result<(), ShellError> {
        let guard = self
            .cmd_tx
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "cmd"))?;
        let tx = guard
            .as_ref()
            .ok_or_else(|| ShellError::new("sidecar_not_connected", "sidecar is not started"))?;
        tx.send(msg)
            .map_err(|_| ShellError::new("sidecar_not_connected", "sidecar worker is gone"))
    }

    /// True when no previous worker is still inside a Core call or test hook.
    fn reap_finished_worker(&self) -> bool {
        let mut slot = match self.zombie.lock() {
            Ok(slot) => slot,
            Err(_) => return false,
        };
        if slot.is_none() {
            return true;
        }
        if self.worker_done.load(Ordering::SeqCst) {
            if let Some(handle) = slot.take() {
                let _ = handle.join();
            }
            return true;
        }
        false
    }
}

impl Drop for SidecarSupervisor {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn disconnected(reason: &'static str) -> SidecarStatus {
    SidecarStatus {
        connected: false,
        transport: "not_started",
        windows_job_object: "unverified_no_sidecar",
        reason,
    }
}

fn validate_config(config: &DevSidecarConfig) -> Result<ProviderSlot, ShellError> {
    let node = safe_file(&config.node_path, "node")?;
    let entry = safe_file(&config.host_entry, "host entry")?;
    if entry.file_name().and_then(|name| name.to_str()) != Some("sidecar.ts") {
        return Err(ShellError::new(
            "sidecar_config",
            "host entry must be the embedded sidecar.ts",
        ));
    }
    let app_data = safe_dir(&config.app_data_dir, "app data")?;
    let working = safe_dir(&config.working_dir, "working dir")?;
    let provider_path = safe_file(&config.provider_config_path, "provider config")?;
    if !provider_path.starts_with(&app_data) {
        return Err(ShellError::new(
            "sidecar_config",
            "provider config must stay inside app-data",
        ));
    }
    if let Some(scripted) = &config.scripted_transport_path {
        let scripted = safe_file(scripted, "scripted transport")?;
        if !scripted.starts_with(&app_data) {
            return Err(ShellError::new(
                "sidecar_config",
                "scripted transport must stay inside app-data",
            ));
        }
    } else {
        return Err(ShellError::new(
            "sidecar_transport_closed",
            "this slice only starts with an explicit scripted transport. Remote StepFun stays closed.",
        ));
    }
    if config.run_timeout_ms == 0 || config.run_timeout_ms > 120_000 {
        return Err(ShellError::new(
            "sidecar_config",
            "run timeout must be 1..=120000 ms",
        ));
    }
    let _ = (node, &working);
    let raw =
        fs::read_to_string(&provider_path).map_err(|err| ShellError::new("io", err.to_string()))?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|_| ShellError::new("sidecar_config", "provider config is not json"))?;
    let enabled = value
        .get("enabled")
        .and_then(|item| item.as_bool())
        .unwrap_or(false);
    let allow_remote = value
        .get("allowRemote")
        .and_then(|item| item.as_bool())
        .unwrap_or(true);
    let provider = value
        .get("providerId")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string();
    let model = value
        .get("modelId")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string();
    let wire = value
        .get("wire")
        .and_then(|item| item.as_str())
        .unwrap_or("");
    let secret = value
        .get("apiKey")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string();
    if !enabled
        || allow_remote
        || wire != "openai-completions"
        || provider.is_empty()
        || model.is_empty()
        || secret.is_empty()
    {
        return Err(ShellError::new(
            "sidecar_transport_closed",
            "provider slot must be enabled, non-remote, openai-completions, with an explicit synthetic key",
        ));
    }
    if provider == "faux" || model == "faux" {
        return Err(ShellError::new("sidecar_config", "faux is not a provider"));
    }
    if !entry.starts_with(&working) && !entry.starts_with(Path::new("/")) {
        return Err(ShellError::new(
            "sidecar_config",
            "host entry is not an absolute trusted file",
        ));
    }
    Ok(ProviderSlot {
        provider,
        model,
        secret,
        scripted: true,
    })
}

fn safe_file(path: &Path, label: &str) -> Result<PathBuf, ShellError> {
    let canon = path
        .canonicalize()
        .map_err(|_| ShellError::new("sidecar_config", format!("{label} is missing")))?;
    reject_private(&canon)?;
    if !canon.is_file() {
        return Err(ShellError::new(
            "sidecar_config",
            format!("{label} is not a file"),
        ));
    }
    Ok(canon)
}

fn safe_dir(path: &Path, label: &str) -> Result<PathBuf, ShellError> {
    fs::create_dir_all(path).map_err(|err| ShellError::new("io", err.to_string()))?;
    let canon = path
        .canonicalize()
        .map_err(|_| ShellError::new("sidecar_config", format!("{label} is missing")))?;
    reject_private(&canon)?;
    if !canon.is_dir() {
        return Err(ShellError::new(
            "sidecar_config",
            format!("{label} is not a directory"),
        ));
    }
    Ok(canon)
}

fn reject_private(path: &Path) -> Result<(), ShellError> {
    let text = path.to_string_lossy();
    if text.contains("personal-vault") || text.contains("memory-vault") {
        return Err(ShellError::new(
            "sidecar_config",
            "private vault is not a sidecar path",
        ));
    }
    Ok(())
}

fn spawn_args(config: &DevSidecarConfig) -> Vec<String> {
    let mut args = vec![
        "--experimental-strip-types".to_string(),
        config.host_entry.to_string_lossy().to_string(),
        "--app-data".to_string(),
        config.app_data_dir.to_string_lossy().to_string(),
        "--provider-config".to_string(),
        config.provider_config_path.to_string_lossy().to_string(),
    ];
    if let Some(scripted) = &config.scripted_transport_path {
        args.push("--scripted-transport".to_string());
        args.push(scripted.to_string_lossy().to_string());
    }
    args
}

fn open_frame_ingress() -> (
    SyncSender<Frame>,
    Receiver<Frame>,
    Sender<IngressNote>,
    Receiver<IngressNote>,
) {
    let (frames, frame_rx) = mpsc::sync_channel(FRAME_INGRESS_CAP);
    let (notes, note_rx) = mpsc::channel();
    (frames, frame_rx, notes, note_rx)
}

fn spawn_stdout_reader(
    stdout: std::process::ChildStdout,
    frames: SyncSender<Frame>,
    notes: Sender<IngressNote>,
) {
    thread::spawn(move || read_stdout(stdout, frames, notes));
}

fn read_stdout(
    mut stdout: std::process::ChildStdout,
    frames: SyncSender<Frame>,
    notes: Sender<IngressNote>,
) {
    let mut parser = NdjsonParser::new();
    let mut buf = [0_u8; 8192];
    loop {
        match std::io::Read::read(&mut stdout, &mut buf) {
            Ok(0) => {
                let _ = notes.send(IngressNote::Eof);
                break;
            }
            Err(_) => {
                let _ = notes.send(IngressNote::Protocol("stdout read failed".to_string()));
                let _ = notes.send(IngressNote::Eof);
                break;
            }
            Ok(n) => match parser.push(&buf[..n]) {
                Ok(parsed) => {
                    for frame in parsed {
                        match frames.try_send(frame) {
                            Ok(()) => {}
                            Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
                                let _ = notes.send(IngressNote::Overflow);
                                drop(stdout);
                                return;
                            }
                        }
                    }
                }
                Err(err) => {
                    let _ = notes.send(IngressNote::Protocol(err.detail));
                }
            },
        }
    }
}

enum Wake {
    Command(Command),
    Frame(Frame),
    Note(IngressNote),
    Idle,
    Closed,
}

fn poll_bridge(
    cmd_rx: &Receiver<Command>,
    frame_rx: &Receiver<Frame>,
    note_rx: &Receiver<IngressNote>,
) -> Wake {
    match cmd_rx.try_recv() {
        Ok(cmd) => return Wake::Command(cmd),
        Err(TryRecvError::Disconnected) => return Wake::Closed,
        Err(TryRecvError::Empty) => {}
    }
    match note_rx.try_recv() {
        Ok(note) => return Wake::Note(note),
        Err(TryRecvError::Disconnected) => return Wake::Note(IngressNote::Eof),
        Err(TryRecvError::Empty) => {}
    }
    match frame_rx.try_recv() {
        Ok(frame) => return Wake::Frame(frame),
        Err(TryRecvError::Disconnected) => return Wake::Note(IngressNote::Eof),
        Err(TryRecvError::Empty) => {}
    }
    match cmd_rx.recv_timeout(Duration::from_millis(40)) {
        Ok(cmd) => Wake::Command(cmd),
        Err(RecvTimeoutError::Timeout) => Wake::Idle,
        Err(RecvTimeoutError::Disconnected) => Wake::Closed,
    }
}

fn join_within(handle: JoinHandle<()>, timeout: Duration) -> Result<(), JoinHandle<()>> {
    let (tx, rx) = mpsc::channel();
    let waiter = thread::spawn(move || {
        let _ = handle.join();
        let _ = tx.send(());
    });
    match rx.recv_timeout(timeout) {
        Ok(()) => {
            let _ = waiter.join();
            Ok(())
        }
        Err(_) => Err(waiter),
    }
}

struct WorkerFinished(Arc<AtomicBool>);

impl Drop for WorkerFinished {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

fn worker(
    mut proc: SpawnedSidecar,
    core: Arc<Core>,
    cmd_rx: Receiver<Command>,
    frame_rx: Receiver<Frame>,
    note_rx: Receiver<IngressNote>,
    hooks: Arc<Hooks>,
    scripted: bool,
    status: Arc<Mutex<SidecarStatus>>,
    stderr_out: Arc<Mutex<String>>,
    pgid: Arc<AtomicU32>,
    pid: Arc<AtomicU32>,
    worker_done: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
) {
    let _finished = WorkerFinished(worker_done);
    let _ = stderr_out;
    let mut ready = false;
    let mut ready_waiters: Vec<Sender<Result<(), ShellError>>> = Vec::new();
    let mut active: Option<Active> = None;
    let mut pending: Option<Command> = None;
    let mut seen = HashSet::new();
    let started = Instant::now();
    let transport = if scripted { "scripted" } else { "closed" };
    loop {
        if !ready
            && started.elapsed() > Duration::from_secs(15)
            && active.is_none()
            && pending.is_none()
        {
            // Keep waiting for commands; host.ready timeout fails an opening below.
        }
        match poll_bridge(&cmd_rx, &frame_rx, &note_rx) {
            Wake::Frame(frame) => {
                if frame.method == "host.ready" && frame.kind == FrameKind::Request {
                    ready = true;
                    publish_connected(&status);
                    let _ = reply_ready(&mut proc, &frame);
                    for waiter in ready_waiters.drain(..) {
                        let _ = waiter.send(Ok(()));
                    }
                    if let Some(command) = pending.take() {
                        let pid = proc.pid;
                        active =
                            launch(&mut proc, &core, &hooks, &mut seen, command, pid, transport);
                    }
                    continue;
                }
                if let Some(run) = active.as_mut() {
                    if handle_frame(&mut proc, &core, &hooks, run, &frame, &mut seen) {
                        active = None;
                    }
                }
            }
            Wake::Note(IngressNote::Overflow) => {
                let _ = shutdown_sidecar(
                    &mut proc,
                    &core,
                    &mut active,
                    &mut pending,
                    &mut ready_waiters,
                    &status,
                    &pgid,
                    &pid,
                    ShellError::new(
                        "queue_overflow",
                        format!(
                            "stdout frame ingress exceeded {FRAME_INGRESS_CAP}; closing the affected run and pipe"
                        ),
                    ),
                );
                if let Ok(mut slot) = status.lock() {
                    slot.connected = false;
                    slot.reason = "stdout frame ingress full; run and pipe closed";
                }
                break;
            }
            Wake::Note(IngressNote::Eof) | Wake::Note(IngressNote::Protocol(_)) => {
                let _ = shutdown_sidecar(
                    &mut proc,
                    &core,
                    &mut active,
                    &mut pending,
                    &mut ready_waiters,
                    &status,
                    &pgid,
                    &pid,
                    ShellError::new("sidecar_eof", "sidecar stdout closed before a core commit"),
                );
                break;
            }
            Wake::Command(command) => match command {
                Command::Opening {
                    workspace_id,
                    reply,
                } => {
                    if active.is_some() {
                        let _ = reply.send(Err(ShellError::new(
                            "correlation_rejected",
                            "host busy: one opening run is active",
                        )));
                    } else if !ready {
                        pending = Some(Command::Opening {
                            workspace_id,
                            reply,
                        });
                    } else {
                        let pid = proc.pid;
                        active = launch(
                            &mut proc,
                            &core,
                            &hooks,
                            &mut seen,
                            Command::Opening {
                                workspace_id,
                                reply,
                            },
                            pid,
                            transport,
                        );
                    }
                }
                Command::Conversation {
                    request_id,
                    workspace_id,
                    conversation_id,
                    user_prompt,
                    progress,
                    reply,
                } => {
                    if let Some(run) = active.as_ref() {
                        reply_busy_or_same(run, &request_id, &workspace_id, reply);
                    } else if !ready {
                        pending = Some(Command::Conversation {
                            request_id,
                            workspace_id,
                            conversation_id,
                            user_prompt,
                            progress,
                            reply,
                        });
                    } else {
                        let pid = proc.pid;
                        active = launch(
                            &mut proc,
                            &core,
                            &hooks,
                            &mut seen,
                            Command::Conversation {
                                request_id,
                                workspace_id,
                                conversation_id,
                                user_prompt,
                                progress,
                                reply,
                            },
                            pid,
                            transport,
                        );
                    }
                }
                Command::Cancel { workspace_id } => {
                    if let Some(run) = active.as_mut() {
                        if run.purpose == "opening" && run.workspace_id == workspace_id {
                            run.cancelled = true;
                            let _ = send_cancel(&mut proc, run);
                            finish_active(
                                &mut active,
                                Err(ShellError::new(
                                    "cancelled",
                                    "opening cancelled before core commit",
                                )),
                            );
                        }
                    }
                }
                Command::CancelTurn {
                    workspace_id,
                    run_id,
                } => {
                    cancel_live_turn(&mut proc, &core, &mut active, &workspace_id, &run_id);
                }
                Command::CloseStdin => {
                    proc.close_stdin();
                }
                Command::KillChild => {
                    process_kill_pid(proc.pid);
                }
                Command::WaitReady { reply } => {
                    if ready {
                        let _ = reply.send(Ok(()));
                    } else {
                        ready_waiters.push(reply);
                    }
                }
                Command::Probe { reply } => {
                    let result = if !ready {
                        Err(ShellError::new(
                            "sidecar_not_connected",
                            "host.ready has not arrived",
                        ))
                    } else if active.is_some() {
                        Err(ShellError::new(
                            "correlation_rejected",
                            "probe refused while a run is active",
                        ))
                    } else {
                        run_probe(&mut proc, &cmd_rx, &frame_rx, &note_rx, &mut seen)
                    };
                    let _ = reply.send(result);
                }
                Command::Stop { reply } => {
                    let report = shutdown_sidecar(
                        &mut proc,
                        &core,
                        &mut active,
                        &mut pending,
                        &mut ready_waiters,
                        &status,
                        &pgid,
                        &pid,
                        ShellError::new("cancelled", "sidecar stop before core commit"),
                    );
                    let _ = reply.send(report);
                    break;
                }
            },
            Wake::Idle => {
                if stop_requested.load(Ordering::SeqCst) {
                    let _ = shutdown_sidecar(
                        &mut proc,
                        &core,
                        &mut active,
                        &mut pending,
                        &mut ready_waiters,
                        &status,
                        &pgid,
                        &pid,
                        ShellError::new("cancelled", "sidecar stop before core commit"),
                    );
                    break;
                }
                expire_pending(&mut pending, started);
                expire_active(&mut proc, &core, &mut active);
            }
            Wake::Closed => {
                let _ = shutdown_sidecar(
                    &mut proc,
                    &core,
                    &mut active,
                    &mut pending,
                    &mut ready_waiters,
                    &status,
                    &pgid,
                    &pid,
                    ShellError::new("sidecar_closed", "bridge channel closed"),
                );
                break;
            }
        }
    }
}

fn shutdown_sidecar(
    proc: &mut SpawnedSidecar,
    core: &Core,
    active: &mut Option<Active>,
    pending: &mut Option<Command>,
    ready_waiters: &mut Vec<Sender<Result<(), ShellError>>>,
    status: &Mutex<SidecarStatus>,
    pgid: &AtomicU32,
    pid: &AtomicU32,
    err: ShellError,
) -> StopReport {
    fail_pending(pending, err.clone());
    for waiter in ready_waiters.drain(..) {
        let _ = waiter.send(Err(err.clone()));
    }
    fail_live(core, active, err.clone());
    fail_active(active, err);
    let report = proc.stop();
    pgid.store(0, Ordering::SeqCst);
    pid.store(0, Ordering::SeqCst);
    publish_stopped(status, &report);
    report
}

fn publish_connected(status: &Mutex<SidecarStatus>) {
    if let Ok(mut slot) = status.lock() {
        *slot = SidecarStatus {
            connected: true,
            transport: "stdio",
            windows_job_object: "not_applicable_unix_process_group",
            reason:
                "Node sidecar ready. Model transport is the explicit scripted slot, not StepFun.",
        };
    }
}

fn publish_stopped(status: &Mutex<SidecarStatus>, report: &StopReport) {
    if let Ok(mut slot) = status.lock() {
        slot.connected = false;
        slot.transport = "not_started";
        slot.reason = if report.group_alive {
            "stop returned but the process group was still alive"
        } else {
            "sidecar stopped and the process group is gone"
        };
    }
}

fn begin_opening(
    proc: &mut SpawnedSidecar,
    core: &Core,
    hooks: &Hooks,
    seen: &mut HashSet<String>,
    workspace_id: String,
    reply: Sender<Result<OpeningBridgeResult, ShellError>>,
    pid: u32,
    transport: &'static str,
) -> Option<Active> {
    let expected_provider = hooks
        .provider
        .lock()
        .map(|slot| slot.clone())
        .unwrap_or_default();
    let expected_model = hooks
        .model
        .lock()
        .map(|slot| slot.clone())
        .unwrap_or_default();
    match prepare_opening(
        core,
        &workspace_id,
        hooks.max_reads.load(Ordering::SeqCst),
        hooks.timeout_ms.load(Ordering::SeqCst),
        &expected_provider,
        &expected_model,
    ) {
        Ok(mut active) => {
            active.reply = Some(reply);
            active.node_pid = pid;
            let frame = run_start_frame(&active, core);
            match frame.and_then(|frame| {
                seen.insert(frame.id.clone());
                write_frame(proc, &frame)
            }) {
                Ok(()) => Some(active),
                Err(err) => {
                    if let Some(reply) = active.reply.take() {
                        let _ = reply.send(Err(err));
                    }
                    None
                }
            }
        }
        Err(err) => {
            let _ = reply.send(Err(err));
            let _ = transport;
            None
        }
    }
}

fn prepare_opening(
    core: &Core,
    workspace_id: &str,
    max_reads: u32,
    timeout_ms: u64,
    expected_provider: &str,
    expected_model: &str,
) -> Result<Active, ShellError> {
    let workspace_id = WorkspaceId::parse(workspace_id)
        .map_err(|_| ShellError::new("invalid_id", "workspace id"))?;
    let checkpoint = core.onboarding(&workspace_id)?;
    if checkpoint.opening_presented {
        return Err(ShellError::new(
            "onboarding_already_presented",
            "opening already stored. This slice will not reset welcome state or insert another first sentence.",
        ));
    }
    if checkpoint.state == "cancelled" || checkpoint.state == "failed" {
        return Err(ShellError::new(
            checkpoint.state,
            "retry is a separate onboarding action. This slice does not reset welcome state.",
        ));
    }
    let issued = core.mark_analyzing(&workspace_id)?;
    let run_id = issued
        .active_run_id
        .clone()
        .ok_or_else(|| ShellError::new("run_mismatch", "core did not issue a run"))?;
    let ws = core.get_workspace(&workspace_id)?;
    let root = core.get_root(&ws.root_id)?;
    let grant = core.get_service_grant(&workspace_id, ServiceKind::Model)?;
    if grant.status != ServiceStatus::Enabled || root.status != RootStatus::Active {
        return Err(ShellError::new(
            "model_not_authorized",
            "grant or directory is not active",
        ));
    }
    let provider = grant.provider.clone().unwrap_or_default();
    let model = grant.model.clone().unwrap_or_default();
    if provider.is_empty() || model.is_empty() {
        return Err(ShellError::new(
            "model_not_authorized",
            "explicit provider and model required",
        ));
    }
    if provider != expected_provider || model != expected_model {
        return Err(ShellError::new(
            "model_not_authorized",
            "core grant does not match the explicit sidecar slot",
        ));
    }
    let timeout = timeout_ms.clamp(1, 120_000);
    let _ = max_reads;
    Ok(Active {
        reply: None,
        purpose: "opening",
        client_request_id: String::new(),
        user_message_id: None,
        user_text: String::new(),
        handoff_id: None,
        recent_messages: Vec::new(),
        seq: 0,
        progress: None,
        accepted_event: None,
        workspace_id: workspace_id.as_str().to_string(),
        conversation_id: ws.conversation_id.as_str().to_string(),
        run_id: run_id.as_str().to_string(),
        request_id: RequestId::new().as_str().to_string(),
        provider,
        model,
        root_id: root.id.as_str().to_string(),
        root_updated_at: root.updated_at,
        grant_updated_at: grant.updated_at,
        deadline: now_ms().saturating_add(timeout),
        session_ref: core
            .opening_session_binding(&workspace_id)?
            .map(|item| item.session_ref),
        receipts: Vec::new(),
        bytes: 0,
        reads: 0,
        candidate: String::new(),
        cancelled: false,
        timed_out: false,
        finished: false,
        node_pid: 0,
    })
}

fn run_start_frame(active: &Active, core: &Core) -> Result<Frame, ShellError> {
    let workspace_id = WorkspaceId::parse(&active.workspace_id)?;
    let auth = current_authorization(core, &workspace_id, &active.run_id, active.purpose)?;
    if auth.get("current").and_then(|item| item.as_bool()) != Some(true) {
        return Err(ShellError::new(
            "model_not_authorized",
            "refusing to start from a non-current authorization",
        ));
    }
    let (revision, source_version, overview) = context_facts(core, &workspace_id)?;
    let user_text = if active.purpose == "conversation" {
        active.user_text.as_str()
    } else {
        OPENING_INTERNAL_INSTRUCTION
    };
    let mut payload = json!({
        "provider": active.provider,
        "model": active.model,
        "purpose": active.purpose,
        "authorization": auth,
        "contextSnapshot": {
            "contextPackRevision": revision,
            "sourceVersion": source_version,
            "empty": true,
            "identity": "memory-engine-absent",
            "overview": overview,
        },
        "userText": user_text,
        "sessionRef": active.session_ref,
        "handoffId": active.handoff_id,
        "syntheticCore": false,
    });
    let object = payload.as_object_mut().unwrap();
    if active.purpose == "conversation" {
        object.insert("userMessageId".to_string(), json!(active.user_message_id));
        object.insert("recentMessages".to_string(), json!(active.recent_messages));
    } else {
        // Opening omits userMessageId. Do not invent a msg_ id.
        object.remove("userMessageId");
        object.insert("handoffId".to_string(), Value::Null);
    }
    Ok(Frame {
        v: 1,
        kind: FrameKind::Request,
        id: active.request_id.clone(),
        reply_to: None,
        workspace_id: Some(active.workspace_id.clone()),
        run_id: Some(active.run_id.clone()),
        method: "run.start".to_string(),
        deadline_unix_ms: Some(active.deadline),
        payload,
        error: None,
    })
}

fn handle_frame(
    proc: &mut SpawnedSidecar,
    core: &Core,
    hooks: &Hooks,
    run: &mut Active,
    frame: &Frame,
    seen: &mut HashSet<String>,
) -> bool {
    if run.finished {
        return false;
    }
    if now_ms() > run.deadline {
        run.timed_out = true;
        return close_turn(
            core,
            run,
            ShellError::new("timeout", "late frame after deadline"),
        );
    }
    if frame.workspace_id.as_deref() != Some(run.workspace_id.as_str())
        && frame.method != "host.ready"
    {
        let _ = send_error(
            proc,
            frame,
            &run.workspace_id,
            &run.run_id,
            "workspace_mismatch",
            "cross-workspace frame rejected",
        );
        return false;
    }
    if frame.run_id.as_deref() != Some(run.run_id.as_str()) && frame.kind != FrameKind::Response {
        let _ = send_error(
            proc,
            frame,
            &run.workspace_id,
            &run.run_id,
            "run_mismatch",
            "cross-run frame rejected",
        );
        return false;
    }
    if frame.kind == FrameKind::Request {
        if !seen.insert(frame.id.clone()) {
            let _ = send_error(
                proc,
                frame,
                &run.workspace_id,
                &run.run_id,
                "correlation_rejected",
                "duplicate request id",
            );
            return false;
        }
        if run.cancelled || run.timed_out {
            let _ = send_error(
                proc,
                frame,
                &run.workspace_id,
                &run.run_id,
                "cancelled",
                "late request after cancel",
            );
            return false;
        }
        if frame.method == "tool.request" {
            let _ = answer_tool(proc, core, hooks, run, frame);
        } else {
            let _ = send_error(
                proc,
                frame,
                &run.workspace_id,
                &run.run_id,
                "invalid_frame",
                "unsupported host request",
            );
        }
        return false;
    }
    if frame.reply_to.as_deref() != Some(run.request_id.as_str()) {
        if frame.kind != FrameKind::Error {
            let _ = send_error(
                proc,
                frame,
                &run.workspace_id,
                &run.run_id,
                "correlation_rejected",
                "reply does not match the active request",
            );
        }
        // A late error for run.cancel or the previous run must not fail the current run.
        return false;
    }
    if run.cancelled || run.timed_out {
        return close_turn(
            core,
            run,
            ShellError::new("cancelled", "late success frame ignored"),
        );
    }
    if frame.kind == FrameKind::Error {
        let code = frame
            .error
            .as_ref()
            .map(|item| item.code.as_str())
            .unwrap_or("invalid_frame");
        let detail = if run.purpose == "conversation" {
            "host rejected the conversation run"
        } else {
            "host rejected the opening run"
        };
        return close_turn(core, run, ShellError::new(code, detail));
    }
    if frame.method == "run.start" && frame.kind == FrameKind::Response {
        let accepted = frame
            .payload
            .get("accepted")
            .and_then(|item| item.as_bool())
            .unwrap_or(false);
        let session_ref = frame
            .payload
            .get("sessionRef")
            .and_then(|item| item.as_str())
            .unwrap_or("");
        let committed_by_host = frame
            .payload
            .get("committedByHost")
            .and_then(|item| item.as_bool())
            .unwrap_or(true);
        if !accepted || committed_by_host || !session_ref_ok(session_ref) {
            return close_turn(
                core,
                run,
                ShellError::new(
                    "correlation_rejected",
                    "host acceptance is not a core commit",
                ),
            );
        }
        if run.purpose == "conversation" {
            return match register_ordinary_session(core, run, session_ref) {
                Ok(()) => false,
                Err(err) => close_turn(core, run, err),
            };
        }
        let binding = SessionBinding {
            workspace_id: WorkspaceId::parse(&run.workspace_id)
                .unwrap_or_else(|_| WorkspaceId::from_trusted(run.workspace_id.clone())),
            conversation_id: hark_core::ConversationId::parse(&run.conversation_id).unwrap_or_else(
                |_| hark_core::ConversationId::from_trusted(run.conversation_id.clone()),
            ),
            run_id: RunId::parse(&run.run_id)
                .unwrap_or_else(|_| RunId::from_trusted(run.run_id.clone())),
            session_ref: session_ref.to_string(),
            bound_at: String::new(),
        };
        let policy = frame
            .payload
            .get("contextPolicy")
            .and_then(|item| item.as_str())
            .unwrap_or("");
        if let Err(err) = bind_reported_session(core, &binding, policy) {
            return close_turn(core, run, err.into());
        }
        run.session_ref = Some(session_ref.to_string());
        return false;
    }
    if frame.method == "stream.delta" {
        if let Some(text) = frame.payload.get("text").and_then(|item| item.as_str()) {
            run.candidate.push_str(text);
            if run.purpose == "conversation" {
                emit_event(
                    run,
                    "text_delta",
                    RunStreamPayload {
                        delta: Some(text.to_string()),
                        persisted_message_id: None,
                        persistence_verified: None,
                        error: None,
                    },
                );
            }
        }
        return false;
    }
    if frame.method == "stream.done" {
        if run.purpose == "conversation" {
            commit_conversation_done(core, run, frame);
        } else {
            let _ = commit_done(core, run, frame);
        }
        return true;
    }
    false
}

fn answer_tool(
    proc: &mut SpawnedSidecar,
    core: &Core,
    hooks: &Hooks,
    run: &mut Active,
    frame: &Frame,
) -> Result<(), ShellError> {
    if let Ok(guard) = hooks.before_tool.lock() {
        if let Some(hook) = guard.as_ref() {
            hook(
                frame
                    .payload
                    .get("tool")
                    .and_then(|item| item.as_str())
                    .unwrap_or(""),
            );
        }
    }
    let tool = frame
        .payload
        .get("tool")
        .and_then(|item| item.as_str())
        .unwrap_or("");
    let workspace_id = WorkspaceId::parse(&run.workspace_id)?;
    let auth = current_authorization(core, &workspace_id, &run.run_id, run.purpose)?;
    let current = auth
        .get("current")
        .and_then(|item| item.as_bool())
        .unwrap_or(false);
    if !current {
        if tool == "workspace.overview" {
            return write_response(
                proc,
                frame,
                &run.workspace_id,
                &run.run_id,
                json!({
                    "authorization": auth,
                    "sourceIds": [],
                    "sourceVersion": "sv-not-current",
                    "contextPackRevision": "cp-not-current",
                    "overviewText": "authorization is not current. no file bytes returned.",
                }),
            );
        }
        return send_error(
            proc,
            frame,
            &run.workspace_id,
            &run.run_id,
            "model_not_authorized",
            "current authorization refused the read",
        );
    }
    if tool == "workspace.overview" {
        let (revision, source_version, overview) = context_facts(core, &workspace_id)?;
        let ids = current_source_ids(core, &workspace_id)?;
        return write_response(
            proc,
            frame,
            &run.workspace_id,
            &run.run_id,
            json!({
                "authorization": auth,
                "sourceIds": ids,
                "sourceVersion": source_version,
                "contextPackRevision": revision,
                "overviewText": overview,
            }),
        );
    }
    if tool != "workspace.read_file" {
        return send_error(
            proc,
            frame,
            &run.workspace_id,
            &run.run_id,
            "invalid_frame",
            "tool is not on the opening allowlist",
        );
    }
    let max_reads = hooks.max_reads.load(Ordering::SeqCst);
    if run.reads >= max_reads || run.bytes >= MAX_READ_BYTES {
        return send_error(
            proc,
            frame,
            &run.workspace_id,
            &run.run_id,
            "budget_rejected",
            "per-run read budget exhausted",
        );
    }
    let relative = frame
        .payload
        .get("input")
        .and_then(|item| item.get("relativePath"))
        .and_then(|item| item.as_str())
        .unwrap_or("");
    if relative.is_empty() || relative.starts_with('/') || relative.contains("..") {
        return send_error(
            proc,
            frame,
            &run.workspace_id,
            &run.run_id,
            "path_escape",
            "relative path rejected",
        );
    }
    let budget = hark_core::ScanBudget::default();
    let read = match core.read_workspace_file(&workspace_id, relative, &budget) {
        Ok(read) => read,
        Err(err) => {
            return send_error(
                proc,
                frame,
                &run.workspace_id,
                &run.run_id,
                err.code_str(),
                &err.detail,
            );
        }
    };
    let mut text = read.text.unwrap_or_default();
    let mut truncated = read.source.truncated || !read.complete;
    if text.chars().count() > HOST_TEXT_CAP {
        text = text.chars().take(HOST_TEXT_CAP).collect();
        truncated = true;
    }
    let unavailable = text.is_empty() || read.source.binary || !read.source.content_available;
    if hooks.mismatch_next.swap(false, Ordering::SeqCst) {
        let payload = json!({
            "relativePath": relative,
            "text": "",
            "unavailable": true,
            "truncated": true,
            "complete": false,
        });
        let mut mismatched = response_frame(
            frame,
            "ws_00000000000000000000000000000001",
            &run.run_id,
            payload,
        );
        mismatched.workspace_id = Some("ws_00000000000000000000000000000001".to_string());
        mismatched.run_id = Some("run_00000000000000000000000000000001".to_string());
        return write_frame(proc, &mismatched);
    }
    run.reads += 1;
    run.bytes = run.bytes.saturating_add(read.source.byte_len);
    if !unavailable {
        run.receipts.push(read.source.id.as_str().to_string());
    }
    write_response(
        proc,
        frame,
        &run.workspace_id,
        &run.run_id,
        json!({
            "relativePath": relative,
            "text": text,
            "sourceId": read.source.id.as_str(),
            "unavailable": unavailable,
            "truncated": truncated,
            "complete": read.complete && !truncated && !unavailable,
        }),
    )
}

fn commit_done(
    core: &Core,
    run: &mut Active,
    frame: &Frame,
) -> Result<OpeningBridgeResult, ShellError> {
    if run.cancelled || run.timed_out || run.session_ref.is_none() {
        return finish_run(
            run,
            Err(ShellError::new(
                "model_receipt_rejected",
                "stream end is not a commit without a live session and run",
            )),
        );
    }
    let text = frame
        .payload
        .get("text")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if text.is_empty() {
        return finish_run(
            run,
            Err(ShellError::new(
                "model_receipt_rejected",
                "empty stream is not an opening",
            )),
        );
    }
    let workspace_id = WorkspaceId::parse(&run.workspace_id)?;
    let auth = current_authorization(core, &workspace_id, &run.run_id, run.purpose)?;
    if auth.get("current").and_then(|item| item.as_bool()) != Some(true)
        || auth.get("rootId").and_then(|item| item.as_str()) != Some(run.root_id.as_str())
        || auth.get("rootUpdatedAt").and_then(|item| item.as_str())
            != Some(run.root_updated_at.as_str())
        || auth.get("grantUpdatedAt").and_then(|item| item.as_str())
            != Some(run.grant_updated_at.as_str())
    {
        return finish_run(
            run,
            Err(ShellError::new(
                "model_not_authorized",
                "authorization changed before commit",
            )),
        );
    }
    if run.receipts.is_empty() {
        return finish_run(
            run,
            Err(ShellError::new(
                "model_receipt_rejected",
                "no core read receipt for this run",
            )),
        );
    }
    let mut source_ids = Vec::new();
    for id in &run.receipts {
        let source_id = SourceId::parse(id)?;
        let source = core.get_source_ref(&workspace_id, &source_id)?;
        if source.workspace_id.as_str() != workspace_id.as_str() || !source.content_available {
            return finish_run(
                run,
                Err(ShellError::new(
                    "cross_workspace_ref",
                    "receipt source is not a current core read",
                )),
            );
        }
        source_ids.push(source_id);
    }
    let receipt = AgentOpeningReceipt {
        workspace_id: workspace_id.clone(),
        run_id: RunId::parse(&run.run_id)?,
        receipt_id: format!("bridge-{}", &run.run_id[4..12.min(run.run_id.len())]),
        provider: run.provider.clone(),
        model: run.model.clone(),
        success: true,
        body: text,
        source_ids,
    };
    let stored = core.commit_agent_opening(&receipt)?;
    let result = OpeningBridgeResult {
        workspace_id: run.workspace_id.clone(),
        run_id: run.run_id.clone(),
        session_ref: run.session_ref.clone().unwrap_or_default(),
        source_ids: run.receipts.clone(),
        committed: true,
        folded_local_card: stored.folded_local_card,
        replayed: stored.replayed,
        node_pid: run.node_pid,
        transport: "scripted",
        step_fun: "unverified",
    };
    finish_run(run, Ok(result))
}

fn finish_run(
    run: &mut Active,
    result: Result<OpeningBridgeResult, ShellError>,
) -> Result<OpeningBridgeResult, ShellError> {
    run.finished = true;
    if let Some(reply) = run.reply.take() {
        let _ = reply.send(result.clone());
    }
    result
}

fn finish_active(active: &mut Option<Active>, result: Result<OpeningBridgeResult, ShellError>) {
    if let Some(run) = active.as_mut() {
        let _ = finish_run(run, result);
    }
    *active = None;
}

fn fail_active(active: &mut Option<Active>, err: ShellError) {
    finish_active(active, Err(err));
}

fn launch(
    proc: &mut SpawnedSidecar,
    core: &Core,
    hooks: &Hooks,
    seen: &mut HashSet<String>,
    command: Command,
    pid: u32,
    transport: &'static str,
) -> Option<Active> {
    match command {
        Command::Opening {
            workspace_id,
            reply,
        } => begin_opening(proc, core, hooks, seen, workspace_id, reply, pid, transport),
        Command::Conversation {
            request_id,
            workspace_id,
            conversation_id,
            user_prompt,
            progress,
            reply,
        } => begin_conversation(
            proc,
            core,
            hooks,
            seen,
            request_id,
            workspace_id,
            conversation_id,
            user_prompt,
            progress,
            reply,
            pid,
        ),
        Command::Cancel { .. }
        | Command::CancelTurn { .. }
        | Command::CloseStdin
        | Command::KillChild
        | Command::WaitReady { .. }
        | Command::Probe { .. }
        | Command::Stop { .. } => None,
    }
}

fn begin_conversation(
    proc: &mut SpawnedSidecar,
    core: &Core,
    hooks: &Hooks,
    seen: &mut HashSet<String>,
    request_id: String,
    workspace_id: String,
    conversation_id: String,
    user_prompt: String,
    progress: TurnProgress,
    reply: Sender<Result<AgentTurnAccepted, ShellError>>,
    pid: u32,
) -> Option<Active> {
    match prepare_conversation(
        core,
        hooks,
        request_id,
        workspace_id,
        conversation_id,
        user_prompt,
        progress,
    ) {
        Ok(PreparedTurn::Replay(accepted)) => {
            let _ = reply.send(Ok(accepted));
            None
        }
        Ok(PreparedTurn::Live(mut active)) => {
            active.node_pid = pid;
            emit_event(
                &mut active,
                "run_started",
                RunStreamPayload {
                    delta: None,
                    persisted_message_id: None,
                    persistence_verified: None,
                    error: None,
                },
            );
            let started = match run_start_frame(&active, core) {
                Ok(frame) => {
                    seen.insert(frame.id.clone());
                    write_frame(proc, &frame)
                }
                Err(err) => Err(err),
            };
            match started {
                Ok(()) => {
                    let accepted = accepted_from(&active);
                    let _ = reply.send(Ok(accepted));
                    Some(active)
                }
                Err(err) => {
                    settle_conversation_failure(core, &mut active, &err.code, &err.detail);
                    let _ = reply.send(Err(err));
                    None
                }
            }
        }
        Err(err) => {
            let _ = reply.send(Err(err));
            None
        }
    }
}

enum PreparedTurn {
    Replay(AgentTurnAccepted),
    Live(Active),
}

fn prepare_conversation(
    core: &Core,
    hooks: &Hooks,
    request_id: String,
    workspace_id: String,
    conversation_id: String,
    user_prompt: String,
    progress: TurnProgress,
) -> Result<PreparedTurn, ShellError> {
    let prompt = user_prompt.trim();
    if prompt.is_empty() {
        return Err(ShellError::new("invalid_message", "user prompt empty"));
    }
    if prompt.chars().count() > 16_000 {
        return Err(ShellError::new(
            "invalid_message",
            "user prompt exceeds the host userText cap",
        ));
    }
    let workspace_id = WorkspaceId::parse(&workspace_id)
        .map_err(|_| ShellError::new("invalid_id", "workspace id"))?;
    let conversation_id = hark_core::ConversationId::parse(&conversation_id)
        .map_err(|_| ShellError::new("invalid_id", "conversation id"))?;
    let expected_provider = hooks
        .provider
        .lock()
        .map(|slot| slot.clone())
        .unwrap_or_default();
    let expected_model = hooks
        .model
        .lock()
        .map(|slot| slot.clone())
        .unwrap_or_default();
    let grant = core.get_service_grant(&workspace_id, ServiceKind::Model)?;
    let provider = grant.provider.clone().unwrap_or_default();
    let model = grant.model.clone().unwrap_or_default();
    if grant.status != ServiceStatus::Enabled
        || provider.is_empty()
        || model.is_empty()
        || provider != expected_provider
        || model != expected_model
    {
        return Err(ShellError::new(
            "model_not_authorized",
            "core grant does not match the explicit sidecar slot",
        ));
    }
    let started = core.start_conversation_run(&ConversationRunStart {
        request_id,
        workspace_id: workspace_id.clone(),
        conversation_id,
        user_message_id: None,
        user_text: Some(prompt.to_string()),
    })?;
    let accepted = AgentTurnAccepted {
        run_id: started.run.id.as_str().to_string(),
        accepted_user_message: started.accepted_user_message.clone(),
    };
    if started.replayed {
        emit_replay(&progress, &started.run);
        return Ok(PreparedTurn::Replay(accepted));
    }
    if let Ok(current) = core.get_conversation_run(&workspace_id, &started.run.id) {
        if current.state == "cancelled" || current.state == "failed" {
            emit_replay(&progress, &current);
            return Ok(PreparedTurn::Replay(accepted));
        }
    }
    let ws = core.get_workspace(&workspace_id)?;
    let root = core.get_root(&ws.root_id)?;
    let (recent_messages, handoff_id) = recent_messages(
        core,
        &workspace_id,
        started.accepted_user_message.id.as_str(),
    )?;
    let timeout = hooks.timeout_ms.load(Ordering::SeqCst).clamp(1, 120_000);
    Ok(PreparedTurn::Live(Active {
        reply: None,
        purpose: "conversation",
        client_request_id: started.run.request_id.clone(),
        user_message_id: Some(started.accepted_user_message.id.as_str().to_string()),
        user_text: started.accepted_user_message.body.clone(),
        handoff_id,
        recent_messages,
        seq: 0,
        progress: Some(progress),
        accepted_event: Some(started.accepted_user_message),
        workspace_id: workspace_id.as_str().to_string(),
        conversation_id: ws.conversation_id.as_str().to_string(),
        run_id: started.run.id.as_str().to_string(),
        request_id: RequestId::new().as_str().to_string(),
        provider,
        model,
        root_id: root.id.as_str().to_string(),
        root_updated_at: started.run.root_updated_at,
        grant_updated_at: started.run.grant_updated_at,
        deadline: now_ms().saturating_add(timeout),
        session_ref: conversation_session_ref(core, &workspace_id)?,
        receipts: Vec::new(),
        bytes: 0,
        reads: 0,
        candidate: String::new(),
        cancelled: false,
        timed_out: false,
        finished: false,
        node_pid: 0,
    }))
}

fn conversation_session_ref(
    core: &Core,
    workspace_id: &WorkspaceId,
) -> Result<Option<String>, ShellError> {
    if let Some(hint) = core.latest_ordinary_session(workspace_id)? {
        if session_ref_ok(&hint.session_ref) {
            return Ok(Some(hint.session_ref));
        }
    }
    Ok(core
        .opening_session_binding(workspace_id)?
        .filter(|item| session_ref_ok(&item.session_ref))
        .map(|item| item.session_ref))
}

fn recent_messages(
    core: &Core,
    workspace_id: &WorkspaceId,
    current_user_id: &str,
) -> Result<(Vec<Value>, Option<String>), ShellError> {
    let events = core.list_conversation(workspace_id)?;
    let mut items = Vec::new();
    for event in events {
        if event.id.as_str() == current_user_id {
            continue;
        }
        let role = match event.kind.as_str() {
            "user_message" => "user",
            "agent_message" | "agent_opening_message" => "assistant",
            _ => continue,
        };
        let text: String = event.body.chars().take(4000).collect();
        if text.is_empty() {
            continue;
        }
        items.push(json!({
            "messageId": event.id.as_str(),
            "role": role,
            "text": text,
            "createdAtUnixMs": 0,
        }));
    }
    if items.len() > 10 {
        items = items.split_off(items.len() - 10);
    }
    let handoff_id = items
        .last()
        .and_then(|item| item.get("messageId"))
        .and_then(|item| item.as_str())
        .map(|id| format!("ord-{id}"));
    Ok((items, handoff_id))
}

fn emit_replay(progress: &TurnProgress, run: &hark_core::ConversationRun) {
    let base = |seq, event_type, payload| RunStreamEvent {
        schema_version: "hark.ui.v1",
        workspace_id: run.workspace_id.as_str().to_string(),
        conversation_id: run.conversation_id.as_str().to_string(),
        run_id: run.id.as_str().to_string(),
        seq,
        event_type,
        payload,
    };
    let started = RunStreamPayload {
        delta: None,
        persisted_message_id: None,
        persistence_verified: None,
        error: None,
    };
    match run.state.as_str() {
        "committed" => {
            progress.emit(base(1, "run_started", started));
            progress.emit(base(
                2,
                "run_completed",
                RunStreamPayload {
                    delta: None,
                    persisted_message_id: run
                        .assistant_message_id
                        .as_ref()
                        .map(|id| id.as_str().to_string()),
                    persistence_verified: Some(true),
                    error: None,
                },
            ));
        }
        "cancelled" => {
            progress.emit(base(1, "run_started", started));
            progress.emit(base(
                2,
                "run_cancelled",
                RunStreamPayload {
                    delta: None,
                    persisted_message_id: None,
                    persistence_verified: Some(false),
                    error: None,
                },
            ));
        }
        "failed" => {
            progress.emit(base(1, "run_started", started.clone()));
            progress.emit(base(
                2,
                "run_failed",
                RunStreamPayload {
                    delta: None,
                    persisted_message_id: None,
                    persistence_verified: Some(false),
                    error: Some(turn_error(
                        run.error_code.as_deref().unwrap_or("failed"),
                        "stored failure replayed without calling the model",
                        false,
                    )),
                },
            ));
        }
        _ => {}
    }
}

fn accepted_from(active: &Active) -> AgentTurnAccepted {
    AgentTurnAccepted {
        run_id: active.run_id.clone(),
        accepted_user_message: active
            .accepted_event
            .clone()
            .unwrap_or_else(|| ConversationEvent {
                id: hark_core::MessageId::from_trusted(
                    active.user_message_id.clone().unwrap_or_default(),
                ),
                workspace_id: WorkspaceId::from_trusted(active.workspace_id.clone()),
                conversation_id: active.conversation_id.clone(),
                kind: "user_message".to_string(),
                generation: None,
                body: active.user_text.clone(),
                presentation: "normal".to_string(),
                source_ids: Vec::new(),
                created_at: String::new(),
            }),
    }
}

fn reply_busy_or_same(
    run: &Active,
    request_id: &str,
    workspace_id: &str,
    reply: Sender<Result<AgentTurnAccepted, ShellError>>,
) {
    if run.purpose == "conversation"
        && run.client_request_id == request_id
        && run.workspace_id == workspace_id
    {
        if run.accepted_event.is_some() {
            let _ = reply.send(Ok(accepted_from(run)));
            return;
        }
    }
    let _ = reply.send(Err(ShellError::new(
        "run_already_active",
        "host busy: one run is active",
    )));
}

fn expire_pending(pending: &mut Option<Command>, started: Instant) {
    if started.elapsed() <= Duration::from_secs(15) {
        return;
    }
    if matches!(
        pending,
        Some(Command::Opening { .. } | Command::Conversation { .. })
    ) {
        fail_pending(pending, ShellError::new("timeout", "host.ready timed out"));
    }
}

fn expire_active(proc: &mut SpawnedSidecar, core: &Core, active: &mut Option<Active>) {
    let expired = active
        .as_ref()
        .is_some_and(|run| !run.finished && now_ms() > run.deadline);
    if !expired {
        return;
    }
    if let Some(run) = active.as_mut() {
        run.timed_out = true;
        run.cancelled = true;
        let _ = send_cancel(proc, run);
        if run.purpose == "conversation" {
            settle_conversation_failure(core, run, "timeout", "conversation deadline exceeded");
        }
    }
    if active
        .as_ref()
        .is_some_and(|run| run.purpose != "conversation")
    {
        finish_active(
            active,
            Err(ShellError::new("timeout", "opening deadline exceeded")),
        );
    } else {
        *active = None;
    }
}

fn fail_pending(pending: &mut Option<Command>, err: ShellError) {
    match pending.take() {
        Some(Command::Opening { reply, .. }) => {
            let _ = reply.send(Err(err));
        }
        Some(Command::Conversation { reply, .. }) => {
            let _ = reply.send(Err(err));
        }
        Some(other) => {
            *pending = Some(other);
        }
        None => {}
    }
}

fn fail_live(core: &Core, active: &mut Option<Active>, err: ShellError) {
    let Some(run) = active.as_mut() else {
        return;
    };
    if run.purpose == "conversation" && !run.finished {
        settle_conversation_failure(core, run, &err.code, &err.detail);
    }
}

fn cancel_live_turn(
    proc: &mut SpawnedSidecar,
    core: &Core,
    active: &mut Option<Active>,
    workspace_id: &str,
    run_id: &str,
) {
    let matches = active.as_ref().is_some_and(|run| {
        run.purpose == "conversation"
            && run.workspace_id == workspace_id
            && run.run_id == run_id
            && !run.finished
    });
    if !matches {
        return;
    }
    if let Some(run) = active.as_mut() {
        run.cancelled = true;
        let _ = send_cancel(proc, run);
        match (
            WorkspaceId::parse(&run.workspace_id),
            RunId::parse(&run.run_id),
        ) {
            (Ok(ws), Ok(id)) => match core.cancel_conversation_run(&ws, &id) {
                Ok(_) => emit_cancelled(run),
                Err(_) => {
                    settle_conversation_failure(core, run, "cancelled", "cancel after commit")
                }
            },
            _ => settle_conversation_failure(core, run, "invalid_id", "cancel ids"),
        }
        run.finished = true;
    }
    *active = None;
}

fn close_turn(core: &Core, run: &mut Active, err: ShellError) -> bool {
    if run.purpose == "conversation" {
        settle_conversation_failure(core, run, &err.code, &err.detail);
        return true;
    }
    let _ = finish_run(run, Err(err));
    true
}

fn register_ordinary_session(
    core: &Core,
    run: &mut Active,
    session_ref: &str,
) -> Result<(), ShellError> {
    let workspace_id = WorkspaceId::parse(&run.workspace_id)?;
    let run_id = RunId::parse(&run.run_id)?;
    core.register_conversation_run(&workspace_id, &run_id, Some(session_ref))?;
    run.session_ref = Some(session_ref.to_string());
    Ok(())
}

fn commit_conversation_done(core: &Core, run: &mut Active, frame: &Frame) {
    if run.finished {
        return;
    }
    if run.cancelled || run.timed_out || run.session_ref.is_none() {
        settle_conversation_failure(
            core,
            run,
            "model_receipt_rejected",
            "stream end is not a commit without a live session",
        );
        return;
    }
    let text = frame
        .payload
        .get("text")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if text.is_empty() {
        settle_conversation_failure(
            core,
            run,
            "model_receipt_rejected",
            "empty stream is not an assistant message",
        );
        return;
    }
    let Ok(workspace_id) = WorkspaceId::parse(&run.workspace_id) else {
        settle_conversation_failure(core, run, "invalid_id", "workspace id");
        return;
    };
    let Ok(run_id) = RunId::parse(&run.run_id) else {
        settle_conversation_failure(core, run, "invalid_id", "run id");
        return;
    };
    match current_authorization(core, &workspace_id, &run.run_id, "conversation") {
        Ok(auth) if authorization_matches(run, &auth) => {}
        Ok(_) => {
            settle_conversation_failure(
                core,
                run,
                "model_not_authorized",
                "authorization changed before commit",
            );
            return;
        }
        Err(err) => {
            settle_conversation_failure(core, run, &err.code, &err.detail);
            return;
        }
    }
    let mut source_ids = Vec::new();
    for id in &run.receipts {
        match SourceId::parse(id) {
            Ok(source_id) => source_ids.push(source_id),
            Err(_) => {
                settle_conversation_failure(
                    core,
                    run,
                    "model_receipt_rejected",
                    "receipt source id invalid",
                );
                return;
            }
        }
    }
    let commit = ConversationCommit {
        workspace_id,
        run_id,
        receipt_id: format!("conv-{}", run.run_id),
        provider: run.provider.clone(),
        model: run.model.clone(),
        body: text,
        source_ids,
    };
    match core.commit_conversation_message(&commit) {
        Ok(turn) => {
            emit_completed(run, Some(turn.assistant_message.id.as_str().to_string()));
            run.finished = true;
        }
        Err(err) => {
            settle_conversation_failure(core, run, err.code_str(), &err.detail);
        }
    }
}

fn authorization_matches(run: &Active, auth: &Value) -> bool {
    auth.get("current").and_then(|item| item.as_bool()) == Some(true)
        && auth.get("rootId").and_then(|item| item.as_str()) == Some(run.root_id.as_str())
        && auth.get("rootUpdatedAt").and_then(|item| item.as_str())
            == Some(run.root_updated_at.as_str())
        && auth.get("grantUpdatedAt").and_then(|item| item.as_str())
            == Some(run.grant_updated_at.as_str())
}

fn settle_conversation_failure(core: &Core, run: &mut Active, code: &str, detail: &str) {
    if run.finished {
        return;
    }
    match query_ordinary(core, run) {
        OrdinaryView::Committed(message_id) => emit_completed(run, message_id),
        OrdinaryView::Cancelled => emit_cancelled(run),
        OrdinaryView::Failed(error_code) => {
            emit_failed(run, error_code.as_deref().unwrap_or(code), detail, false)
        }
        OrdinaryView::Open => {
            if let (Ok(ws), Ok(id)) = (
                WorkspaceId::parse(&run.workspace_id),
                RunId::parse(&run.run_id),
            ) {
                let _ = core.fail_conversation_run(&ws, &id, &fail_reason(code));
            }
            emit_failed(run, code, detail, retryable_code(code));
        }
        OrdinaryView::Unknown => emit_failed(
            run,
            "persistence_unknown",
            "Core query failed. Candidate text was not treated as done.",
            true,
        ),
    }
    run.finished = true;
}

enum OrdinaryView {
    Committed(Option<String>),
    Cancelled,
    Failed(Option<String>),
    Open,
    Unknown,
}

fn query_ordinary(core: &Core, run: &Active) -> OrdinaryView {
    let Ok(ws) = WorkspaceId::parse(&run.workspace_id) else {
        return OrdinaryView::Unknown;
    };
    let Ok(id) = RunId::parse(&run.run_id) else {
        return OrdinaryView::Unknown;
    };
    match core.get_conversation_run(&ws, &id) {
        Ok(stored) if stored.state == "committed" => OrdinaryView::Committed(
            stored
                .assistant_message_id
                .as_ref()
                .map(|item| item.as_str().to_string()),
        ),
        Ok(stored) if stored.state == "cancelled" => OrdinaryView::Cancelled,
        Ok(stored) if stored.state == "failed" => OrdinaryView::Failed(stored.error_code),
        Ok(_) => OrdinaryView::Open,
        Err(_) => OrdinaryView::Unknown,
    }
}

fn fail_reason(code: &str) -> String {
    let trimmed = code.trim();
    let reason = if trimmed.is_empty() {
        "failed"
    } else {
        trimmed
    };
    reason.chars().take(200).collect()
}

fn retryable_code(code: &str) -> bool {
    matches!(
        code,
        "timeout" | "sqlite" | "io" | "persistence_unknown" | "queue_overflow"
    )
}

fn turn_error(code: &str, detail: &str, retryable: bool) -> TurnErrorBody {
    TurnErrorBody {
        code: code.chars().take(64).collect(),
        message: detail.chars().take(180).collect(),
        retryable,
    }
}

fn emit_event(run: &mut Active, event_type: &'static str, payload: RunStreamPayload) {
    let Some(progress) = run.progress.clone() else {
        return;
    };
    run.seq = run.seq.saturating_add(1);
    progress.emit(RunStreamEvent {
        schema_version: "hark.ui.v1",
        workspace_id: run.workspace_id.clone(),
        conversation_id: run.conversation_id.clone(),
        run_id: run.run_id.clone(),
        seq: run.seq,
        event_type,
        payload,
    });
}

fn emit_completed(run: &mut Active, message_id: Option<String>) {
    emit_event(
        run,
        "run_completed",
        RunStreamPayload {
            delta: None,
            persisted_message_id: message_id,
            persistence_verified: Some(true),
            error: None,
        },
    );
}

fn emit_cancelled(run: &mut Active) {
    emit_event(
        run,
        "run_cancelled",
        RunStreamPayload {
            delta: None,
            persisted_message_id: None,
            persistence_verified: Some(false),
            error: None,
        },
    );
}

fn emit_failed(run: &mut Active, code: &str, detail: &str, retryable: bool) {
    emit_event(
        run,
        "run_failed",
        RunStreamPayload {
            delta: None,
            persisted_message_id: None,
            persistence_verified: Some(false),
            error: Some(turn_error(code, detail, retryable)),
        },
    );
}

fn ordinary_run_current(
    core: &Core,
    workspace_id: &WorkspaceId,
    run_id: &str,
    provider: &str,
    model: &str,
    grant_updated_at: &str,
    root_updated_at: &str,
) -> bool {
    let Ok(id) = RunId::parse(run_id) else {
        return false;
    };
    let Ok(run) = core.get_conversation_run(workspace_id, &id) else {
        return false;
    };
    matches!(run.state.as_str(), "pending" | "running")
        && run.provider == provider
        && run.model == model
        && run.grant_updated_at == grant_updated_at
        && run.root_updated_at == root_updated_at
}

pub fn map_agent_turn_status(run: &hark_core::ConversationRun) -> AgentTurnStatus {
    let (state, latest_error) = match run.state.as_str() {
        "committed" => ("completed", None),
        "cancelled" => ("cancelled", None),
        "failed" => (
            "failed",
            Some(turn_error(
                run.error_code.as_deref().unwrap_or("failed"),
                "普通回合失败。用户原文保留，没有伪造助手回复。",
                false,
            )),
        ),
        "pending" | "running" => ("running", None),
        _ => (
            "persistence_unknown",
            Some(turn_error(
                "persistence_unknown",
                "Core run state is not a completed assistant message.",
                true,
            )),
        ),
    };
    AgentTurnStatus {
        run_id: run.id.as_str().to_string(),
        workspace_id: run.workspace_id.as_str().to_string(),
        conversation_id: run.conversation_id.as_str().to_string(),
        state: state.to_string(),
        persisted_assistant_message_id: run
            .assistant_message_id
            .as_ref()
            .map(|id| id.as_str().to_string()),
        latest_error,
    }
}

pub fn unknown_agent_turn_status(workspace_id: &str, run_id: &str) -> AgentTurnStatus {
    AgentTurnStatus {
        run_id: run_id.to_string(),
        workspace_id: workspace_id.to_string(),
        conversation_id: String::new(),
        state: "persistence_unknown".to_string(),
        persisted_assistant_message_id: None,
        latest_error: Some(turn_error(
            "persistence_unknown",
            "Core query failed. Candidate text was not treated as done.",
            true,
        )),
    }
}

fn current_authorization(
    core: &Core,
    workspace_id: &WorkspaceId,
    run_id: &str,
    purpose: &str,
) -> Result<Value, ShellError> {
    let checkpoint = core.onboarding(workspace_id)?;
    let ws = core.get_workspace(workspace_id)?;
    let root = core.get_root(&ws.root_id).ok();
    let grant = core
        .get_service_grant(workspace_id, ServiceKind::Model)
        .ok();
    let directory = root
        .as_ref()
        .map(|item| match item.status {
            RootStatus::Active => "active",
            RootStatus::Paused => "paused",
            RootStatus::Revoked => "revoked",
        })
        .unwrap_or("missing");
    let model_status = grant
        .as_ref()
        .map(|item| match item.status {
            ServiceStatus::Enabled => "active",
            ServiceStatus::Paused => "paused",
            ServiceStatus::Revoked => "revoked",
            ServiceStatus::Disabled => "missing",
        })
        .unwrap_or("missing");
    let provider = grant
        .as_ref()
        .and_then(|item| item.provider.clone())
        .unwrap_or_default();
    let model = grant
        .as_ref()
        .and_then(|item| item.model.clone())
        .unwrap_or_default();
    let root_updated = root
        .as_ref()
        .map(|item| item.updated_at.clone())
        .unwrap_or_default();
    let grant_updated = grant
        .as_ref()
        .map(|item| item.updated_at.clone())
        .unwrap_or_default();
    let root_id = root
        .as_ref()
        .map(|item| item.id.as_str().to_string())
        .unwrap_or_else(|| "root_00000000000000000000000000000000".to_string());
    let opening_current = purpose != "conversation"
        && checkpoint.active_run_id.as_ref().map(|item| item.as_str()) == Some(run_id)
        && checkpoint.state == "analyzing"
        && checkpoint.auth_provider.as_deref() == Some(provider.as_str())
        && checkpoint.auth_model.as_deref() == Some(model.as_str())
        && checkpoint.auth_grant_updated_at.as_deref() == Some(grant_updated.as_str())
        && checkpoint.auth_root_updated_at.as_deref() == Some(root_updated.as_str());
    let conversation_current = purpose == "conversation"
        && ordinary_run_current(
            core,
            workspace_id,
            run_id,
            &provider,
            &model,
            &grant_updated,
            &root_updated,
        );
    let current = (opening_current || conversation_current)
        && directory == "active"
        && model_status == "active"
        && !provider.is_empty()
        && !model.is_empty();
    Ok(json!({
        "runId": run_id,
        "provider": if provider.is_empty() { "missing" } else { provider.as_str() },
        "model": if model.is_empty() { "missing" } else { model.as_str() },
        "rootId": root_id,
        "rootUpdatedAt": if root_updated.is_empty() { "missing" } else { root_updated.as_str() },
        "grantUpdatedAt": if grant_updated.is_empty() { "missing" } else { grant_updated.as_str() },
        "directoryStatus": directory,
        "modelGrantStatus": model_status,
        "current": current,
    }))
}

fn context_facts(
    core: &Core,
    workspace_id: &WorkspaceId,
) -> Result<(String, String, String), ShellError> {
    let overview = core.workspace_overview(workspace_id)?;
    let sources = core.list_source_refs(workspace_id)?;
    let available: Vec<_> = sources
        .iter()
        .filter(|item| item.content_available)
        .collect();
    let unavailable = sources.len().saturating_sub(available.len());
    let mut material = String::new();
    for source in &available {
        material.push_str(source.id.as_str());
        material.push('\t');
        material.push_str(&source.relative_path);
        material.push('\t');
        material.push_str(&source.content_sha256);
        material.push('\n');
    }
    let source_version = if available.is_empty() {
        "sv-none".to_string()
    } else {
        format!("sv-{:016x}", fnv(material.as_bytes()))
    };
    let revision = format!(
        "cp-{:016x}",
        fnv(format!(
            "{source_version}:{}:{}",
            overview.directory_status,
            available.len()
        )
        .as_bytes())
    );
    let text = format!(
        "current-facts directory={} readable={} scanned={} availableSources={} unavailableSources={} memoryEngine=absent modelInference=false",
        overview.directory_status,
        overview.readable,
        overview.structure_scanned,
        available.len(),
        unavailable
    );
    Ok((revision, source_version, text))
}

fn current_source_ids(core: &Core, workspace_id: &WorkspaceId) -> Result<Vec<String>, ShellError> {
    let sources = core.list_source_refs(workspace_id)?;
    Ok(sources
        .into_iter()
        .filter(|item| item.content_available)
        .take(64)
        .map(|item| item.id.as_str().to_string())
        .collect())
}

fn run_probe(
    proc: &mut SpawnedSidecar,
    cmd_rx: &Receiver<Command>,
    frame_rx: &Receiver<Frame>,
    note_rx: &Receiver<IngressNote>,
    seen: &mut HashSet<String>,
) -> Result<ProtocolProbe, ShellError> {
    let id = RequestId::new().as_str().to_string();
    let bad = Frame {
        v: 1,
        kind: FrameKind::Request,
        id: id.clone(),
        reply_to: None,
        workspace_id: Some("ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string()),
        run_id: Some("run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string()),
        method: "run.start".to_string(),
        deadline_unix_ms: Some(now_ms().saturating_add(5_000)),
        payload: json!({
            "provider": "hark-synth",
            "model": "scripted-local",
            "purpose": "conversation",
            "authorization": {
                "runId": "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "provider": "hark-synth",
                "model": "scripted-local",
                "rootId": "root_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "rootUpdatedAt": "v",
                "grantUpdatedAt": "v",
                "directoryStatus": "active",
                "modelGrantStatus": "active",
                "current": true
            },
            "contextSnapshot": {"contextPackRevision": "rev", "sourceVersion": "src", "empty": true},
            "userText": "not-a-stored-user-turn",
            "sessionRef": Value::Null,
            "handoffId": Value::Null
        }),
        error: None,
    };
    write_frame(proc, &bad)?;
    write_frame(proc, &bad)?;
    let foreign = Frame {
        v: 1,
        kind: FrameKind::Event,
        id: hark_core::EventId::new().as_str().to_string(),
        reply_to: Some(id.clone()),
        workspace_id: Some("ws_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()),
        run_id: Some("run_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()),
        method: "stream.done".to_string(),
        deadline_unix_ms: None,
        payload: json!({"text": "late", "finish": "stop"}),
        error: None,
    };
    write_frame(proc, &foreign)?;
    let unknown = Frame {
        v: 1,
        kind: FrameKind::Response,
        id: "req_cccccccccccccccccccccccccccccccc".to_string(),
        reply_to: Some("req_cccccccccccccccccccccccccccccccc".to_string()),
        workspace_id: Some("ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string()),
        run_id: Some("run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string()),
        method: "tool.result".to_string(),
        deadline_unix_ms: None,
        payload: json!({}),
        error: None,
    };
    write_frame(proc, &unknown)?;
    seen.insert(id.clone());
    let start = Instant::now();
    let mut duplicate = false;
    let mut cross = false;
    let mut unknown_rejected = false;
    while start.elapsed() < Duration::from_secs(8) {
        match poll_bridge(cmd_rx, frame_rx, note_rx) {
            Wake::Frame(frame) => {
                let code = frame
                    .error
                    .as_ref()
                    .map(|item| item.code.as_str())
                    .unwrap_or("");
                if frame.reply_to.as_deref() == Some(id.as_str()) && code == "correlation_rejected"
                {
                    duplicate = true;
                }
                if frame.reply_to.as_deref() == Some(id.as_str())
                    && (code == "run_mismatch" || code == "workspace_mismatch")
                {
                    cross = true;
                }
                if frame.reply_to.as_deref() == Some("req_cccccccccccccccccccccccccccccccc")
                    && code == "correlation_rejected"
                {
                    unknown_rejected = true;
                }
                if duplicate && cross && unknown_rejected {
                    break;
                }
            }
            Wake::Command(Command::Stop { reply }) => {
                let _ = reply.send(proc.stop());
                return Err(ShellError::new("cancelled", "stopped during probe"));
            }
            Wake::Command(_) | Wake::Idle | Wake::Note(IngressNote::Protocol(_)) => {}
            Wake::Note(_) | Wake::Closed => break,
        }
    }
    Ok(ProtocolProbe {
        duplicate_rejected: duplicate,
        cross_run_rejected: cross,
        unknown_reply_rejected: unknown_rejected,
        scripted_invocations: 0,
    })
}

fn reply_ready(proc: &mut SpawnedSidecar, frame: &Frame) -> Result<(), ShellError> {
    write_response(proc, frame, "", "", json!({"accepted": true}))
}

fn send_cancel(proc: &mut SpawnedSidecar, run: &Active) -> Result<(), ShellError> {
    let frame = Frame {
        v: 1,
        kind: FrameKind::Request,
        id: RequestId::new().as_str().to_string(),
        reply_to: None,
        workspace_id: Some(run.workspace_id.clone()),
        run_id: Some(run.run_id.clone()),
        method: "run.cancel".to_string(),
        deadline_unix_ms: Some(now_ms().saturating_add(5_000)),
        payload: json!({"targetRequestId": run.request_id}),
        error: None,
    };
    write_frame(proc, &frame)
}

fn send_error(
    proc: &mut SpawnedSidecar,
    frame: &Frame,
    workspace: &str,
    run: &str,
    code: &str,
    detail: &str,
) -> Result<(), ShellError> {
    let err = Frame {
        v: 1,
        kind: FrameKind::Error,
        id: ErrorId::new().as_str().to_string(),
        reply_to: Some(frame.id.clone()),
        workspace_id: if workspace.is_empty() {
            None
        } else {
            Some(workspace.to_string())
        },
        run_id: if run.is_empty() {
            None
        } else {
            Some(run.to_string())
        },
        method: "error".to_string(),
        deadline_unix_ms: None,
        payload: json!({}),
        error: Some(hark_core::IpcErrorBody {
            code: code.to_string(),
            message: detail.chars().take(180).collect(),
            retryable: code == "timeout",
        }),
    };
    write_frame(proc, &err)
}

fn write_response(
    proc: &mut SpawnedSidecar,
    request: &Frame,
    workspace: &str,
    run: &str,
    payload: Value,
) -> Result<(), ShellError> {
    let frame = response_frame(request, workspace, run, payload);
    write_frame(proc, &frame)
}

fn response_frame(request: &Frame, workspace: &str, run: &str, payload: Value) -> Frame {
    Frame {
        v: 1,
        kind: FrameKind::Response,
        id: request.id.clone(),
        reply_to: Some(request.id.clone()),
        workspace_id: if workspace.is_empty() {
            request.workspace_id.clone()
        } else {
            Some(workspace.to_string())
        },
        run_id: if run.is_empty() {
            request.run_id.clone()
        } else {
            Some(run.to_string())
        },
        method: if request.method == "tool.request" {
            "tool.result".to_string()
        } else {
            request.method.clone()
        },
        deadline_unix_ms: None,
        payload,
        error: None,
    }
}

fn write_frame(proc: &mut SpawnedSidecar, frame: &Frame) -> Result<(), ShellError> {
    let bytes = encode_frame(frame).map_err(|err| ShellError::new(err.code_str(), err.detail))?;
    proc.write_frame(&bytes)
}

fn bind_reported_session(
    core: &Core,
    binding: &SessionBinding,
    policy: &str,
) -> Result<SessionBinding, hark_core::CoreError> {
    if policy == "new-session-compaction-fallback" {
        match core.replace_opening_session_for_compaction(binding) {
            Ok(stored) => return Ok(stored),
            Err(err)
                if err
                    .detail
                    .contains("requires the current run session binding") => {}
            Err(err) => return Err(err),
        }
    }
    core.bind_opening_session(binding)
}

fn session_ref_ok(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("pi:") else {
        return false;
    };
    rest.len() == 36 && rest.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn fnv(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn force_kill(pgid: u32) {
    #[cfg(unix)]
    if pgid != 0 {
        unsafe {
            libc::kill(-(pgid as i32), libc::SIGKILL);
        }
    }
}

pub fn process_kill_pid(pid: u32) {
    #[cfg(unix)]
    if pid != 0 {
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
    }
}

#[cfg(test)]
mod ingress_tests {
    use super::*;
    use std::process::Stdio;

    fn flood_frame() -> Frame {
        Frame {
            v: 1,
            kind: FrameKind::Event,
            id: "evt_0123456789abcdef0123456789abcdef".to_string(),
            reply_to: None,
            workspace_id: None,
            run_id: None,
            method: "stream.delta".to_string(),
            deadline_unix_ms: None,
            payload: json!({"text": "x"}),
            error: None,
        }
    }

    struct KillOnDrop(Option<std::process::Child>);
    impl Drop for KillOnDrop {
        fn drop(&mut self) {
            if let Some(child) = self.0.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    #[test]
    fn stdout_reader_caps_a_real_child_and_does_not_block() {
        let node = PathBuf::from("/usr/local/bin/node");
        assert!(node.is_file(), "dev node binary missing");
        let bytes = encode_frame(&flood_frame()).unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let frame_path = tmp.path().join("frame.ndjson");
        fs::write(&frame_path, &bytes).unwrap();
        let mut child = std::process::Command::new(&node)
            .arg("-e")
            .arg("const fs=require('fs'); const line=fs.readFileSync(process.argv[1]); for (let i=0;i<200;i++) process.stdout.write(line);")
            .arg(&frame_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut guard = KillOnDrop(Some(child));
        let (frames, frame_rx, notes, note_rx) = open_frame_ingress();
        let reader = thread::spawn(move || read_stdout(stdout, frames, notes));
        let note = note_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("reader blocked or did not signal overflow");
        assert!(matches!(note, IngressNote::Overflow), "{note:?}");
        let start = Instant::now();
        let mut exited = false;
        while start.elapsed() < Duration::from_secs(5) {
            if guard.0.as_mut().unwrap().try_wait().unwrap().is_some() {
                exited = true;
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            exited,
            "flood child stayed blocked after ingress closed the pipe"
        );
        let mut queued = 0;
        while frame_rx.try_recv().is_ok() {
            queued += 1;
        }
        assert_eq!(queued, FRAME_INGRESS_CAP, "ingress accepted {queued}");
        reader.join().expect("reader thread");
        assert!(start.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn full_frame_ingress_does_not_block_a_cancel_command() {
        let (frames, _frame_rx, _notes, _note_rx) = open_frame_ingress();
        let sample = flood_frame();
        for _ in 0..FRAME_INGRESS_CAP {
            frames.try_send(sample.clone()).unwrap();
        }
        assert!(frames.try_send(sample).is_err());
        let (cmd_tx, cmd_rx) = mpsc::channel();
        let started = Instant::now();
        cmd_tx
            .send(super::Command::Cancel {
                workspace_id: "ws".to_string(),
            })
            .unwrap();
        let cmd = cmd_rx.recv_timeout(Duration::from_millis(200)).unwrap();
        assert!(matches!(cmd, super::Command::Cancel { .. }));
        assert!(started.elapsed() < Duration::from_millis(200));
    }
}
