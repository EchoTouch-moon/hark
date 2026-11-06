//! Core ↔ Host stdio for the first opening run. Not an HTTP server, not a Pi CLI,
//! and not a general execution framework.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use hark_core::{
    encode_frame, AgentOpeningReceipt, Core, ErrorId, Frame, FrameKind, NdjsonParser, RequestId,
    RootStatus, RunId, ServiceKind, ServiceStatus, SessionBinding, SourceId, WorkspaceId,
};
use serde::Serialize;
use serde_json::{json, Value};

use crate::error::ShellError;
use crate::process::{SpawnedSidecar, StopReport};
use crate::seam::SidecarStatus;

const MAX_READS_DEFAULT: u32 = 8;
const MAX_READ_BYTES: u64 = 256 * 1024;
const HOST_TEXT_CAP: usize = 65_536;
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

enum Inbox {
    Frame(Frame),
    Eof,
    Protocol(#[allow(dead_code)] String),
    Cmd(Command),
}

enum Command {
    Opening {
        workspace_id: String,
        reply: Sender<Result<OpeningBridgeResult, ShellError>>,
    },
    Cancel {
        workspace_id: String,
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
    workspace_id: String,
    conversation_id: String,
    run_id: String,
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
    cmd_tx: Mutex<Option<Sender<Inbox>>>,
    worker: Mutex<Option<JoinHandle<()>>>,
    status: Mutex<SidecarStatus>,
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
            status: Mutex::new(disconnected("sidecar_not_configured")),
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
            let (tx, rx) = mpsc::channel();
            let tx_reader = tx.clone();
            thread::spawn(move || read_stdout(stdout, tx_reader));
            let core = Arc::clone(&self.core);
            let hooks = Arc::clone(&self.hooks);
            let status = Arc::new(Mutex::new(SidecarStatus {
                connected: true,
                transport: "stdio",
                windows_job_object: "not_applicable_unix_process_group",
                reason: "Node sidecar started. Model transport is the explicit scripted slot, not StepFun.",
            }));
            let status_for_worker = Arc::clone(&status);
            let pgid = Arc::clone(&self.pgid);
            let pid = Arc::clone(&self.pid);
            let stderr_out = Arc::clone(&self.stderr);
            let handle = thread::spawn(move || {
                worker(
                    proc,
                    core,
                    rx,
                    hooks,
                    slot.scripted,
                    status_for_worker,
                    stderr_out,
                    pgid,
                    pid,
                );
            });
            *self
                .cmd_tx
                .lock()
                .map_err(|_| ShellError::new("lock_poisoned", "cmd"))? = Some(tx.clone());
            *self
                .worker
                .lock()
                .map_err(|_| ShellError::new("lock_poisoned", "worker"))? = Some(handle);
            let (ready_tx, ready_rx) = mpsc::channel();
            tx.send(Inbox::Cmd(Command::WaitReady { reply: ready_tx }))
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
            let published = status
                .lock()
                .map(|slot| slot.clone())
                .unwrap_or_else(|_| disconnected("lock_poisoned"));
            *self
                .status
                .lock()
                .map_err(|_| ShellError::new("lock_poisoned", "status"))? = published.clone();
            Ok(published)
        }
    }

    pub fn opening(&self, workspace_id: &str) -> Result<OpeningBridgeResult, ShellError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(Inbox::Cmd(Command::Opening {
            workspace_id: workspace_id.to_string(),
            reply: reply_tx,
        }))?;
        reply_rx
            .recv_timeout(Duration::from_secs(120))
            .map_err(|_| ShellError::new("timeout", "opening bridge timed out"))?
    }

    pub fn cancel(&self, workspace_id: &str) -> Result<(), ShellError> {
        self.send(Inbox::Cmd(Command::Cancel {
            workspace_id: workspace_id.to_string(),
        }))
    }

    pub fn close_stdin(&self) -> Result<(), ShellError> {
        self.send(Inbox::Cmd(Command::CloseStdin))
    }

    pub fn kill_child(&self) -> Result<(), ShellError> {
        self.send(Inbox::Cmd(Command::KillChild))
    }

    pub fn probe_protocol(&self) -> Result<ProtocolProbe, ShellError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.send(Inbox::Cmd(Command::Probe { reply: reply_tx }))?;
        reply_rx
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| ShellError::new("timeout", "protocol probe timed out"))?
    }

    pub fn stop(&self) -> Result<StopReport, ShellError> {
        force_kill(self.pgid.load(Ordering::SeqCst));
        let tx = self
            .cmd_tx
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "cmd"))?
            .take();
        if let Some(tx) = tx {
            let (reply_tx, reply_rx) = mpsc::channel();
            let _ = tx.send(Inbox::Cmd(Command::Stop { reply: reply_tx }));
            if let Ok(report) = reply_rx.recv_timeout(Duration::from_secs(5)) {
                *self
                    .last_stop
                    .lock()
                    .map_err(|_| ShellError::new("lock_poisoned", "stop"))? = Some(report);
            }
        }
        if let Some(handle) = self
            .worker
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "worker"))?
            .take()
        {
            let _ = handle.join();
        }
        force_kill(self.pgid.load(Ordering::SeqCst));
        self.pid.store(0, Ordering::SeqCst);
        self.pgid.store(0, Ordering::SeqCst);
        *self
            .status
            .lock()
            .map_err(|_| ShellError::new("lock_poisoned", "status"))? = disconnected("stopped");
        Ok(self
            .last_stop
            .lock()
            .ok()
            .and_then(|slot| slot.clone())
            .unwrap_or(StopReport {
                pid: 0,
                pgid: 0,
                group_alive: false,
                exited: true,
                forced_kill: false,
            }))
    }

    fn send(&self, msg: Inbox) -> Result<(), ShellError> {
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

fn read_stdout(mut stdout: std::process::ChildStdout, tx: Sender<Inbox>) {
    let mut parser = NdjsonParser::new();
    let mut buf = [0_u8; 8192];
    loop {
        match std::io::Read::read(&mut stdout, &mut buf) {
            Ok(0) => {
                let _ = tx.send(Inbox::Eof);
                break;
            }
            Err(_) => {
                let _ = tx.send(Inbox::Protocol("stdout read failed".to_string()));
                let _ = tx.send(Inbox::Eof);
                break;
            }
            Ok(n) => match parser.push(&buf[..n]) {
                Ok(frames) => {
                    for frame in frames {
                        if tx.send(Inbox::Frame(frame)).is_err() {
                            return;
                        }
                    }
                }
                Err(err) => {
                    let _ = tx.send(Inbox::Protocol(err.detail));
                }
            },
        }
    }
}

fn worker(
    mut proc: SpawnedSidecar,
    core: Arc<Core>,
    rx: Receiver<Inbox>,
    hooks: Arc<Hooks>,
    scripted: bool,
    status: Arc<Mutex<SidecarStatus>>,
    stderr_out: Arc<Mutex<String>>,
    pgid: Arc<AtomicU32>,
    pid: Arc<AtomicU32>,
) {
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
        let msg = rx.recv_timeout(Duration::from_millis(40));
        match msg {
            Ok(Inbox::Frame(frame)) => {
                if frame.method == "host.ready" && frame.kind == FrameKind::Request {
                    ready = true;
                    let _ = reply_ready(&mut proc, &frame);
                    for waiter in ready_waiters.drain(..) {
                        let _ = waiter.send(Ok(()));
                    }
                    if let Some(Command::Opening {
                        workspace_id,
                        reply,
                    }) = pending.take()
                    {
                        let pid = proc.pid;
                        active = begin_opening(
                            &mut proc,
                            &core,
                            &hooks,
                            &mut seen,
                            workspace_id,
                            reply,
                            pid,
                            transport,
                        );
                    }
                    continue;
                }
                if let Some(run) = active.as_mut() {
                    if handle_frame(&mut proc, &core, &hooks, run, &frame, &mut seen).is_some() {
                        active = None;
                    }
                }
            }
            Ok(Inbox::Eof) | Ok(Inbox::Protocol(_)) => {
                fail_active(
                    &mut active,
                    ShellError::new("sidecar_eof", "sidecar stdout closed before a core commit"),
                );
                let report = proc.stop();
                pgid.store(0, Ordering::SeqCst);
                pid.store(0, Ordering::SeqCst);
                publish_stopped(&status, &report);
                break;
            }
            Ok(Inbox::Cmd(command)) => match command {
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
                        active = begin_opening(
                            &mut proc,
                            &core,
                            &hooks,
                            &mut seen,
                            workspace_id,
                            reply,
                            pid,
                            transport,
                        );
                    }
                }
                Command::Cancel { workspace_id } => {
                    if let Some(run) = active.as_mut() {
                        if run.workspace_id == workspace_id {
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
                        run_probe(&mut proc, &rx, &mut seen)
                    };
                    let _ = reply.send(result);
                }
                Command::Stop { reply } => {
                    fail_active(
                        &mut active,
                        ShellError::new("cancelled", "sidecar stop before core commit"),
                    );
                    let report = proc.stop();
                    pgid.store(0, Ordering::SeqCst);
                    pid.store(0, Ordering::SeqCst);
                    publish_stopped(&status, &report);
                    let _ = reply.send(report);
                    break;
                }
            },
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(Command::Opening {
                    workspace_id,
                    reply,
                }) = pending.take()
                {
                    if started.elapsed() > Duration::from_secs(15) {
                        let _ = reply.send(Err(ShellError::new("timeout", "host.ready timed out")));
                        let _ = workspace_id;
                    } else {
                        pending = Some(Command::Opening {
                            workspace_id,
                            reply,
                        });
                    }
                }
                if let Some(run) = active.as_mut() {
                    if !run.finished && now_ms() > run.deadline {
                        run.timed_out = true;
                        run.cancelled = true;
                        let _ = send_cancel(&mut proc, run);
                        finish_active(
                            &mut active,
                            Err(ShellError::new("timeout", "opening deadline exceeded")),
                        );
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                fail_active(
                    &mut active,
                    ShellError::new("sidecar_closed", "bridge channel closed"),
                );
                let report = proc.stop();
                publish_stopped(&status, &report);
                break;
            }
        }
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
    let auth = current_authorization(core, &workspace_id, &active.run_id)?;
    if auth.get("current").and_then(|item| item.as_bool()) != Some(true) {
        return Err(ShellError::new(
            "model_not_authorized",
            "refusing to start from a non-current authorization",
        ));
    }
    let (revision, source_version, overview) = context_facts(core, &workspace_id)?;
    let mut payload = json!({
        "provider": active.provider,
        "model": active.model,
        "purpose": "opening",
        "authorization": auth,
        "contextSnapshot": {
            "contextPackRevision": revision,
            "sourceVersion": source_version,
            "empty": true,
            "identity": "memory-engine-absent",
            "overview": overview,
        },
        "userText": OPENING_INTERNAL_INSTRUCTION,
        "sessionRef": active.session_ref,
        "handoffId": Value::Null,
        "syntheticCore": false,
    });
    // Opening omits userMessageId. Do not invent a msg_ id.
    payload.as_object_mut().unwrap().remove("userMessageId");
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
) -> Option<Result<OpeningBridgeResult, ShellError>> {
    if run.finished {
        return None;
    }
    if now_ms() > run.deadline {
        run.timed_out = true;
        return Some(finish_run(
            run,
            Err(ShellError::new("timeout", "late frame after deadline")),
        ));
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
        return None;
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
        return None;
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
            return None;
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
            return None;
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
        return None;
    }
    if frame.reply_to.as_deref() != Some(run.request_id.as_str()) && frame.kind != FrameKind::Error
    {
        let _ = send_error(
            proc,
            frame,
            &run.workspace_id,
            &run.run_id,
            "correlation_rejected",
            "reply does not match the opening request",
        );
        return None;
    }
    if run.cancelled || run.timed_out {
        return Some(finish_run(
            run,
            Err(ShellError::new("cancelled", "late success frame ignored")),
        ));
    }
    if frame.kind == FrameKind::Error {
        let code = frame
            .error
            .as_ref()
            .map(|item| item.code.as_str())
            .unwrap_or("invalid_frame");
        return Some(finish_run(
            run,
            Err(ShellError::new(code, "host rejected the opening run")),
        ));
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
            return Some(finish_run(
                run,
                Err(ShellError::new(
                    "correlation_rejected",
                    "host acceptance is not a core commit",
                )),
            ));
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
        if let Err(err) = core.bind_opening_session(&binding) {
            return Some(finish_run(run, Err(err.into())));
        }
        run.session_ref = Some(session_ref.to_string());
        return None;
    }
    if frame.method == "stream.delta" {
        if let Some(text) = frame.payload.get("text").and_then(|item| item.as_str()) {
            run.candidate.push_str(text);
        }
        return None;
    }
    if frame.method == "stream.done" {
        return Some(commit_done(core, run, frame));
    }
    None
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
    let auth = current_authorization(core, &workspace_id, &run.run_id)?;
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
    let auth = current_authorization(core, &workspace_id, &run.run_id)?;
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

fn current_authorization(
    core: &Core,
    workspace_id: &WorkspaceId,
    run_id: &str,
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
    let current = checkpoint.active_run_id.as_ref().map(|item| item.as_str()) == Some(run_id)
        && checkpoint.state == "analyzing"
        && checkpoint.auth_provider.as_deref() == Some(provider.as_str())
        && checkpoint.auth_model.as_deref() == Some(model.as_str())
        && checkpoint.auth_grant_updated_at.as_deref() == Some(grant_updated.as_str())
        && checkpoint.auth_root_updated_at.as_deref() == Some(root_updated.as_str())
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
    rx: &Receiver<Inbox>,
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
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Inbox::Frame(frame)) => {
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
            Ok(Inbox::Cmd(Command::Stop { reply })) => {
                let _ = reply.send(proc.stop());
                return Err(ShellError::new("cancelled", "stopped during probe"));
            }
            Ok(_) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
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
