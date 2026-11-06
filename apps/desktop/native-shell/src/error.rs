use serde::Serialize;
use thiserror::Error;

use hark_core::CoreError;

#[derive(Debug, Clone, Error, Serialize)]
#[error("{code}: {detail}")]
#[serde(rename_all = "camelCase")]
pub struct ShellError {
    pub code: String,
    pub detail: String,
}

impl ShellError {
    pub fn new(code: impl Into<String>, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        let detail = detail.chars().take(240).collect::<String>();
        Self {
            code: code.into(),
            detail,
        }
    }
}

impl From<CoreError> for ShellError {
    fn from(value: CoreError) -> Self {
        Self::new(value.code_str(), value.detail)
    }
}
