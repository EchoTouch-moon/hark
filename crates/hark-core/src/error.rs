use serde::{Deserialize, Serialize};

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    LockPoisoned,
    Sqlite,
    SchemaTooNew,
    MigrationFailed,
    Io,
    AccessDenied,
    NotFound,
    NotADirectory,
    InvalidPath,
    PathEscape,
    SymlinkRejected,
    HardlinkRejected,
    AliasRejected,
    AliasCheckFailed,
    CrossDeviceRejected,
    SpecialFileRejected,
    SensitivePath,
    ArtifactPath,
    ReaderUnsupportedPlatform,
    RootAlreadyAuthorized,
    OverlapRefused,
    RootPaused,
    RootRevoked,
    GrantIdentityMismatch,
    BudgetRejected,
    Cancelled,
    ScanNotConfirmable,
    ScanAlreadyConfirmed,
    CandidateNotInScan,
    WorkspaceNotFound,
    CrossWorkspaceRef,
    SourceRefNotFound,
    ModelNotAuthorized,
    ModelReceiptRejected,
    ProviderMismatch,
    OnboardingAlreadyPresented,
    OnboardingNotFound,
    SecretMaterialRejected,
    FrameTooLarge,
    InvalidFrame,
    QueueOverflow,
    Timeout,
    WorkspaceMismatch,
    RunMismatch,
    CorrelationRejected,
    UnsupportedMethod,
    InvalidMessage,
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LockPoisoned => "lock_poisoned",
            Self::Sqlite => "sqlite",
            Self::SchemaTooNew => "schema_too_new",
            Self::MigrationFailed => "migration_failed",
            Self::Io => "io",
            Self::AccessDenied => "access_denied",
            Self::NotFound => "not_found",
            Self::NotADirectory => "not_a_directory",
            Self::InvalidPath => "invalid_path",
            Self::PathEscape => "path_escape",
            Self::SymlinkRejected => "symlink_rejected",
            Self::HardlinkRejected => "hardlink_rejected",
            Self::AliasRejected => "alias_rejected",
            Self::AliasCheckFailed => "alias_check_failed",
            Self::CrossDeviceRejected => "cross_device_rejected",
            Self::SpecialFileRejected => "special_file_rejected",
            Self::SensitivePath => "sensitive_path",
            Self::ArtifactPath => "artifact_path",
            Self::ReaderUnsupportedPlatform => "reader_unsupported_platform",
            Self::RootAlreadyAuthorized => "root_already_authorized",
            Self::OverlapRefused => "overlap_refused",
            Self::RootPaused => "root_paused",
            Self::RootRevoked => "root_revoked",
            Self::GrantIdentityMismatch => "grant_identity_mismatch",
            Self::BudgetRejected => "budget_rejected",
            Self::Cancelled => "cancelled",
            Self::ScanNotConfirmable => "scan_not_confirmable",
            Self::ScanAlreadyConfirmed => "scan_already_confirmed",
            Self::CandidateNotInScan => "candidate_not_in_scan",
            Self::WorkspaceNotFound => "workspace_not_found",
            Self::CrossWorkspaceRef => "cross_workspace_ref",
            Self::SourceRefNotFound => "source_ref_not_found",
            Self::ModelNotAuthorized => "model_not_authorized",
            Self::ModelReceiptRejected => "model_receipt_rejected",
            Self::ProviderMismatch => "provider_mismatch",
            Self::OnboardingAlreadyPresented => "onboarding_already_presented",
            Self::OnboardingNotFound => "onboarding_not_found",
            Self::SecretMaterialRejected => "secret_material_rejected",
            Self::FrameTooLarge => "frame_too_large",
            Self::InvalidFrame => "invalid_frame",
            Self::QueueOverflow => "queue_overflow",
            Self::Timeout => "timeout",
            Self::WorkspaceMismatch => "workspace_mismatch",
            Self::RunMismatch => "run_mismatch",
            Self::CorrelationRejected => "correlation_rejected",
            Self::UnsupportedMethod => "unsupported_method",
            Self::InvalidMessage => "invalid_message",
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("{code}: {detail}")]
pub struct CoreError {
    pub code: ErrorCode,
    pub detail: String,
}

impl CoreError {
    pub fn new(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }

    pub fn code_str(&self) -> &'static str {
        self.code.as_str()
    }
}

impl From<rusqlite::Error> for CoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self::new(ErrorCode::Sqlite, value.to_string())
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(value: serde_json::Error) -> Self {
        Self::new(ErrorCode::InvalidFrame, value.to_string())
    }
}
