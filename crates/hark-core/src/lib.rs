//! In-process Hark R1 core.
//!
//! Tauri should call [`Core`] directly. This crate does not open an HTTP server
//! or spawn the Pi sidecar. IPC v1 types are a frozen codec for a later host.

mod conversation;
mod db;
mod error;
mod grant;
mod ids;
mod ipc;
mod limits;
mod messages;
mod policy;
#[cfg(unix)]
mod reader;
#[cfg(not(unix))]
#[path = "reader_unsupported.rs"]
mod reader;
mod scan;
mod workspace;

pub use conversation::{
    ConversationCommit, ConversationRun, ConversationRunStart, ConversationTurn,
    StartedConversationRun,
};
pub use error::{CoreError, ErrorCode};
pub use grant::{AuthorizedRoot, RootStatus};
pub use ids::*;
pub use ipc::{
    check_deadline, encode_frame, error_frame, ipc_limits, parse_frame, CorrelationGate, Frame,
    FrameKind, IpcErrorBody, IpcLimits, NdjsonParser, SideQueues,
};
pub use limits::{
    ABSOLUTE_MAX_DEPTH, ABSOLUTE_MAX_ENTRIES, ABSOLUTE_MAX_FILE_BYTES, ABSOLUTE_MAX_TOTAL_BYTES,
    DEFAULT_MAX_DEPTH, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_TOTAL_BYTES,
    DEFAULT_TIMEOUT_MS, MAX_CONTROL_QUEUE, MAX_FRAME_BYTES, MAX_STREAM_QUEUE, MAX_TIMEOUT_MS,
    SCHEMA_VERSION,
};
pub use messages::{
    AgentOpeningReceipt, ConversationEvent, FileRead, FirstMessage, OnboardingCheckpoint,
    SelectiveReadReport, SessionBinding, SourceRef, WorkspaceOverview,
};
pub use reader::{
    reader_open_attempts, reader_read_syscalls, reader_readdir_steps, reset_reader_work_counters,
    set_reader_admitted_syscall_hook, set_reader_after_grant_before_syscall_hook,
    set_reader_after_workspace_verify_hook, set_reader_before_open_hook,
};
pub use scan::{CandidateRole, IgnoredEntry, InitialScan, ScanBudget, ScanCandidate, ScanStatus};
pub use workspace::{
    ConfirmImport, ConfirmResult, ImportMode, ServiceGrant, ServiceGrantUpdate, ServiceKind,
    ServiceStatus, Workspace,
};

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

pub struct Core {
    conn: Mutex<Connection>,
}

impl Core {
    pub fn open(path: &Path) -> error::Result<Self> {
        db::open_path(path)
    }

    pub fn open_in_memory() -> error::Result<Self> {
        db::open_memory()
    }

    pub fn schema_version(&self) -> error::Result<i64> {
        db::schema_version(self)
    }

    pub fn schema_tables(&self) -> error::Result<Vec<String>> {
        db::table_names(self)
    }

    pub fn reader_capability(&self) -> &'static str {
        reader::reader_capability()
    }
}

#[derive(Clone, Debug)]
pub struct CancelFlag {
    inner: Arc<AtomicBool>,
    armed: Arc<AtomicBool>,
    remaining: Arc<std::sync::atomic::AtomicU32>,
}

impl Default for CancelFlag {
    fn default() -> Self {
        Self::new()
    }
}

impl CancelFlag {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(AtomicBool::new(false)),
            armed: Arc::new(AtomicBool::new(false)),
            remaining: Arc::new(std::sync::atomic::AtomicU32::new(0)),
        }
    }

    pub fn cancel(&self) {
        self.inner.store(true, Ordering::SeqCst);
    }

    /// Deterministic cancel after `steps` scan/read checkpoints. `steps == 0` cancels immediately.
    pub fn arm_after_steps(&self, steps: u32) {
        self.remaining.store(steps, Ordering::SeqCst);
        self.armed.store(true, Ordering::SeqCst);
        if steps == 0 {
            self.cancel();
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.load(Ordering::SeqCst)
    }

    pub(crate) fn tick(&self) {
        if !self.armed.load(Ordering::SeqCst) || self.is_cancelled() {
            return;
        }
        let left = self.remaining.load(Ordering::SeqCst);
        if left <= 1 {
            self.cancel();
        } else {
            self.remaining.fetch_sub(1, Ordering::SeqCst);
        }
    }
}
