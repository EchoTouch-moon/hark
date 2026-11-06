use serde::Serialize;

/// Future Host integration point. This shell does not spawn a process,
/// does not speak stdio, and does not invent a session-ref store.
///
/// The integration writer is expected to:
/// 1. call Core `mark_analyzing` itself (not the frontend),
/// 2. build the frozen `run.start` envelope from that Core-issued run,
/// 3. supervise one stdio sidecar whose stdout is protocol-only.
///
/// Windows Job Object cleanup is unverified because no sidecar exists here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub connected: bool,
    pub transport: &'static str,
    pub windows_job_object: &'static str,
    pub reason: &'static str,
}

pub fn sidecar_status() -> SidecarStatus {
    SidecarStatus {
        connected: false,
        transport: "not_started",
        windows_job_object: "unverified_no_sidecar",
        reason: "本壳没有 Sidecar。Host stdio 在另一 worktree，由后续 integration writer 接通。未伪造 Pi 进程。",
    }
}

/// Not constructed by the running shell. Kept so the next writer has one
/// typed place to pass a Core-issued run, never a frontend-authored success.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssuedOpeningRun {
    pub workspace_id: String,
    pub run_id: String,
}

pub trait OpeningHost {
    fn start_opening(&self, run: &IssuedOpeningRun) -> Result<(), &'static str>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct NotConnectedHost;

impl OpeningHost for NotConnectedHost {
    fn start_opening(&self, _run: &IssuedOpeningRun) -> Result<(), &'static str> {
        Err("sidecar_not_connected")
    }
}
