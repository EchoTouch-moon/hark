//! Frontend read/user-action DTOs. Agent proposal methods are not exposed here.
use hark_core::OpinionFeedbackAction;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpinionRequest {
    pub workspace_id: String,
    pub opinion_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpinionFeedbackRequest {
    pub request_id: String,
    pub workspace_id: String,
    pub opinion_id: String,
    pub expected_revision: i64,
    pub action: OpinionFeedbackAction,
    pub user_comment: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevertMemoryRequest {
    pub workspace_id: String,
    pub operation_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageEvidenceRequest {
    pub workspace_id: String,
    pub message_id: String,
}
