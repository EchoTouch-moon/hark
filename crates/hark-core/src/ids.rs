use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{CoreError, ErrorCode, Result};

macro_rules! id_type {
    ($name:ident, $prefix:literal) => {
        #[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn new() -> Self {
                let raw = Uuid::new_v4().simple().to_string();
                Self(format!("{}_{}", $prefix, raw))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }

            pub fn parse(value: &str) -> Result<Self> {
                validate_id(value, $prefix)?;
                Ok(Self(value.to_string()))
            }

            pub fn from_trusted(value: String) -> Self {
                Self(value)
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

id_type!(RootId, "root");
id_type!(ScanId, "scan");
id_type!(CandidateId, "cand");
id_type!(WorkspaceId, "ws");
id_type!(AgentId, "agt");
id_type!(ConversationId, "conv");
id_type!(MessageId, "msg");
id_type!(SourceId, "src");
id_type!(GrantId, "grant");
id_type!(OnboardingId, "onb");
id_type!(RequestId, "req");
id_type!(EventId, "evt");
id_type!(ErrorId, "err");
id_type!(RunId, "run");
id_type!(ToolCallId, "tool");
id_type!(OperationId, "op");

fn validate_id(value: &str, prefix: &str) -> Result<()> {
    let Some((got, hex)) = value.split_once('_') else {
        return Err(CoreError::new(ErrorCode::InvalidFrame, "id missing prefix"));
    };
    if got != prefix || hex.len() != 32 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(CoreError::new(
            ErrorCode::InvalidFrame,
            format!("id must be {prefix}_ plus 32 hex chars"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_have_stable_prefix() {
        let id = WorkspaceId::new();
        assert!(id.as_str().starts_with("ws_"));
        assert_eq!(id.as_str().len(), 3 + 32);
        WorkspaceId::parse(id.as_str()).unwrap();
        assert!(WorkspaceId::parse("ws_not-hex").is_err());
    }
}
