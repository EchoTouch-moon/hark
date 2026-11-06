//! In-process native shell over `hark_core::Core`.
//!
//! Tauri commands in `apps/desktop/src-tauri` are thin wrappers. Integration
//! tests call this crate directly and do not open a WebView.

mod bridge;
mod error;
mod lifecycle;
mod process;
mod seam;
mod service;

pub use bridge::{
    AgentTurnAccepted, AgentTurnRef, AgentTurnRequest, AgentTurnStatus, DevSidecarConfig,
    OpeningBridgeResult, ProtocolProbe, RunStreamEvent, TurnProgress, OPENING_INTERNAL_INSTRUCTION,
};
pub use error::ShellError;
pub use hark_core::{
    AuthorizedRoot, ConfirmResult, ConversationEvent, FirstMessage, InitialScan,
    OnboardingCheckpoint, SelectiveReadReport, ServiceGrant, SessionBinding, SourceRef, Workspace,
    WorkspaceOverview,
};
pub use lifecycle::{decide_window_close, WindowCloseDecision};
pub use process::StopReport;
pub use seam::{sidecar_status, IssuedOpeningRun, NotConnectedHost, OpeningHost, SidecarStatus};
pub use service::{
    business_db_path, AuthorizeRequest, ConfirmRequest, IdRequest, ModelGrantRequest, NativeShell,
    OpeningRequest, PickTicket, Selection, ShellSnapshot, SourceRefRequest, StepFunKeyRequest,
    StepFunSessionStatus, UserMessageRequest, WorkspaceRef, CONTROLLED_PICK_ENTRY, FRONTEND_COMMANDS,
    PICK_TTL_MS,
};
