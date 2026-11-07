//! Only the managed run supplies authority; model input contains proposal data.
use crate::ShellError;
use hark_core::{
    Core, MemoryCallContext, MemoryCaller, MemoryChangeProposal, MemorySearchInput, MessageId,
    OpinionChangeProposal, RunId, WorkspaceId,
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecallInput {
    query: String,
    kinds: Option<Vec<String>>,
    cursor: Option<String>,
}

pub(crate) fn call(
    core: &Core,
    workspace_id: &WorkspaceId,
    run_id: &RunId,
    current_user_message_id: Option<&str>,
    purpose: &str,
    tool: &str,
    operation_id: &str,
    input: Value,
) -> Result<Value, ShellError> {
    if tool == "memory_recall" {
        let input: RecallInput = serde_json::from_value(input)
            .map_err(|_| ShellError::new("invalid_frame", "invalid recall input"))?;
        let page = core.search_workspace_memory(&MemorySearchInput {
            workspace_id: workspace_id.clone(),
            query: input.query,
            kinds: input.kinds,
            cursor: input.cursor,
        })?;
        return serde_json::to_value(page)
            .map_err(|_| ShellError::new("invalid_frame", "recall serialization failed"));
    }
    if purpose != "conversation" {
        return Err(ShellError::new(
            "memory_write_unavailable",
            "memory writes require an ordinary conversation run",
        ));
    }
    let user_id = MessageId::parse(current_user_message_id.unwrap_or(""))
        .map_err(|_| ShellError::new("run_mismatch", "current stored user message missing"))?;
    let stored = core.get_conversation_run(workspace_id, run_id)?;
    if stored.user_message_id != user_id {
        return Err(ShellError::new(
            "run_mismatch",
            "user message does not match current run",
        ));
    }
    let ctx = MemoryCallContext {
        workspace_id: workspace_id.clone(),
        operation_id: operation_id.to_string(),
        current_user_message_id: Some(user_id.clone()),
        caller: MemoryCaller::AgentRun {
            run_id: run_id.clone(),
        },
    };
    let result = match tool {
        "memory_propose_change" => {
            let proposal: MemoryChangeProposal = serde_json::from_value(input)
                .map_err(|_| ShellError::new("invalid_frame", "invalid memory proposal"))?;
            serde_json::to_value(core.memory_propose_change(&ctx, &proposal)?)
        }
        "opinion_propose_change" => {
            let mut proposal: OpinionChangeProposal =
                serde_json::from_value(input).map_err(|_| {
                    ShellError::new("invalid_frame", "invalid structured opinion proposal")
                })?;
            if !proposal
                .evidence_refs
                .iter()
                .any(|id| id == user_id.as_str())
            {
                proposal.evidence_refs.push(user_id.to_string());
            }
            serde_json::to_value(core.opinion_propose_change(&ctx, &proposal)?)
        }
        _ => return Err(ShellError::new("invalid_frame", "unknown cognition tool")),
    };
    result.map_err(|_| ShellError::new("invalid_frame", "receipt serialization failed"))
}
