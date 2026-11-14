//! In-process native shell over `hark_core::Core`.
//!
//! Tauri commands in `apps/desktop/src-tauri` are thin wrappers. Integration
//! tests call this crate directly and do not open a WebView.

mod bridge;
mod cognition;
mod credentials;
mod error;
mod lifecycle;
mod memory_agent;
mod process;
mod review_queue;
#[cfg(feature = "reviewed-sender")]
pub mod reviewed_sender;
mod seam;
mod service;

pub use bridge::{
    AgentTurnAccepted, AgentTurnRef, AgentTurnRequest, AgentTurnRequestRef, AgentTurnStatus,
    DevSidecarConfig, OpeningBridgeResult, ProtocolProbe, RunStreamEvent, TurnProgress,
    OPENING_INTERNAL_INSTRUCTION,
};
pub use cognition::{
    MessageEvidenceRequest, OpinionFeedbackRequest, OpinionRequest, RevertMemoryRequest,
};
pub use credentials::CredentialStore;
pub use error::ShellError;
pub use hark_core::{
    AttentionItem, AuthorizedRoot, ConfirmResult, ContextPack, ContextSnapshot, ConversationEvent,
    FirstMessage, FlameStage, InitialScan, MemoryReceipt, MemorySearchInput, MemorySearchPage,
    NarrativeAvailability, NarrativeState, ObservationStatus, ObservedFileChange,
    OnboardingCheckpoint, OpinionView, SelectiveReadReport, ServiceGrant, SessionBinding,
    SourceFreshness, SourceRef, Workspace, WorkspaceObservationReport, WorkspaceOverview,
};
pub use lifecycle::{decide_window_close, WindowCloseDecision};
pub use process::StopReport;
pub use review_queue::{
    PendingReviewQueue, ReviewDecision, ReviewLimit, ReviewQueueError, ReviewRequest,
    ReviewSnapshot, ReviewSource,
};
pub use seam::{sidecar_status, IssuedOpeningRun, NotConnectedHost, OpeningHost, SidecarStatus};
pub use service::{
    business_db_path, AuthorizeRequest, ConfirmRequest, IdRequest, ModelGrantRequest, NativeShell,
    ObserverStatus, OpeningRequest, PickTicket, SearchConfig, SearchConfigResponse,
    SearchProviderCredentials, Selection, ShellSnapshot, SourceRefRequest, StepFunKeyRequest,
    StepFunSessionStatus, UserMessageRequest, WorkspaceRef, CONTROLLED_PICK_ENTRY,
    FRONTEND_COMMANDS, PICK_TTL_MS,
};
