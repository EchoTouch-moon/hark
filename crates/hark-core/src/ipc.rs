//! Stdio frame codec and correlation gate.
//! This is not a sidecar process supervisor and does not open a socket or HTTP port.

use std::collections::{HashMap, VecDeque};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{CoreError, ErrorCode, Result};
use crate::limits::{
    DEFAULT_TIMEOUT_MS, MAX_CONTROL_QUEUE, MAX_FRAME_BYTES, MAX_STREAM_QUEUE, MAX_TIMEOUT_MS,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameKind {
    Request,
    Response,
    Event,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcErrorBody {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub v: u32,
    pub kind: FrameKind,
    pub id: String,
    pub reply_to: Option<String>,
    pub workspace_id: Option<String>,
    pub run_id: Option<String>,
    pub method: String,
    pub deadline_unix_ms: Option<u64>,
    pub payload: Value,
    pub error: Option<IpcErrorBody>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcLimits {
    pub version: u32,
    pub max_frame_bytes: usize,
    pub max_stream_queue: usize,
    pub max_control_queue: usize,
    pub default_timeout_ms: u64,
    pub max_timeout_ms: u64,
}

pub fn ipc_limits() -> IpcLimits {
    IpcLimits {
        version: 1,
        max_frame_bytes: MAX_FRAME_BYTES,
        max_stream_queue: MAX_STREAM_QUEUE,
        max_control_queue: MAX_CONTROL_QUEUE,
        default_timeout_ms: DEFAULT_TIMEOUT_MS,
        max_timeout_ms: MAX_TIMEOUT_MS,
    }
}

pub fn parse_frame(bytes: &[u8]) -> Result<Frame> {
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(CoreError::new(
            ErrorCode::FrameTooLarge,
            bytes.len().to_string(),
        ));
    }
    if bytes.contains(&b'\n') || bytes.contains(&b'\r') {
        return Err(CoreError::new(
            ErrorCode::InvalidFrame,
            "frame contains a newline",
        ));
    }
    let frame: Frame = serde_json::from_slice(bytes)?;
    validate_frame(&frame)?;
    Ok(frame)
}

pub fn encode_frame(frame: &Frame) -> Result<Vec<u8>> {
    validate_frame(frame)?;
    let mut bytes = serde_json::to_vec(frame)?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(CoreError::new(
            ErrorCode::FrameTooLarge,
            bytes.len().to_string(),
        ));
    }
    bytes.push(b'\n');
    Ok(bytes)
}

fn validate_frame(frame: &Frame) -> Result<()> {
    if frame.v != 1 {
        return Err(CoreError::new(
            ErrorCode::InvalidFrame,
            "unsupported ipc version",
        ));
    }
    if frame.method.is_empty() || frame.method.len() > 128 {
        return Err(CoreError::new(ErrorCode::InvalidFrame, "method missing"));
    }
    if !frame.payload.is_object() && !frame.payload.is_null() {
        return Err(CoreError::new(
            ErrorCode::InvalidFrame,
            "payload must be an object or null",
        ));
    }
    match frame.kind {
        FrameKind::Request => {
            require_prefixed(&frame.id, "req")?;
            if frame.error.is_some() {
                return Err(CoreError::new(
                    ErrorCode::InvalidFrame,
                    "request cannot carry error",
                ));
            }
        }
        FrameKind::Response => {
            require_prefixed(&frame.id, "req")?;
            let reply = frame.reply_to.as_deref().unwrap_or("");
            if reply != frame.id {
                return Err(CoreError::new(
                    ErrorCode::InvalidFrame,
                    "response id must echo the request",
                ));
            }
        }
        FrameKind::Event => {
            require_prefixed(&frame.id, "evt")?;
        }
        FrameKind::Error => {
            require_prefixed(&frame.id, "err")?;
            if frame.error.is_none() {
                return Err(CoreError::new(
                    ErrorCode::InvalidFrame,
                    "error frame requires error body",
                ));
            }
        }
    }
    if let Some(deadline) = frame.deadline_unix_ms {
        if deadline > u64::MAX / 2 {
            return Err(CoreError::new(
                ErrorCode::InvalidFrame,
                "deadline out of range",
            ));
        }
    }
    Ok(())
}

fn require_prefixed(id: &str, prefix: &str) -> Result<()> {
    let Some((got, hex)) = id.split_once('_') else {
        return Err(CoreError::new(ErrorCode::InvalidFrame, "id missing prefix"));
    };
    if got != prefix || hex.len() != 32 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(CoreError::new(
            ErrorCode::InvalidFrame,
            "id prefix or hex length",
        ));
    }
    Ok(())
}

#[derive(Debug, Default)]
pub struct NdjsonParser {
    buf: Vec<u8>,
    failed: bool,
}

impl NdjsonParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, input: &[u8]) -> Result<Vec<Frame>> {
        if self.failed {
            return Err(CoreError::new(
                ErrorCode::InvalidFrame,
                "parser needs resync",
            ));
        }
        self.buf.extend_from_slice(input);
        let mut out = Vec::new();
        loop {
            if let Some(pos) = self.buf.iter().position(|b| *b == b'\n') {
                let mut line = self.buf.drain(..=pos).collect::<Vec<_>>();
                line.pop();
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                if line.is_empty() {
                    continue;
                }
                match parse_frame(&line) {
                    Ok(frame) => out.push(frame),
                    Err(err) => {
                        self.failed = true;
                        return Err(err);
                    }
                }
            } else if self.buf.len() > MAX_FRAME_BYTES {
                self.buf.clear();
                self.failed = true;
                return Err(CoreError::new(
                    ErrorCode::FrameTooLarge,
                    "line exceeded max frame before newline",
                ));
            } else {
                break;
            }
        }
        Ok(out)
    }
}

#[derive(Debug)]
pub struct SideQueues {
    control: VecDeque<Frame>,
    stream: VecDeque<Frame>,
}

impl SideQueues {
    pub fn new() -> Self {
        Self {
            control: VecDeque::new(),
            stream: VecDeque::new(),
        }
    }

    pub fn try_push(&mut self, frame: Frame) -> Result<()> {
        let stream = matches!(frame.method.as_str(), "stream.delta" | "stream.done");
        let queue = if stream {
            &mut self.stream
        } else {
            &mut self.control
        };
        let cap = if stream {
            MAX_STREAM_QUEUE
        } else {
            MAX_CONTROL_QUEUE
        };
        if queue.len() >= cap {
            return Err(CoreError::new(
                ErrorCode::QueueOverflow,
                if stream { "stream" } else { "control" },
            ));
        }
        queue.push_back(frame);
        Ok(())
    }

    pub fn pop_control(&mut self) -> Option<Frame> {
        self.control.pop_front()
    }

    pub fn pop_stream(&mut self) -> Option<Frame> {
        self.stream.pop_front()
    }

    pub fn control_len(&self) -> usize {
        self.control.len()
    }

    pub fn stream_len(&self) -> usize {
        self.stream.len()
    }
}

impl Default for SideQueues {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
struct Outstanding {
    workspace_id: Option<String>,
    run_id: Option<String>,
    cancelled: bool,
}

#[derive(Debug, Default)]
pub struct CorrelationGate {
    outstanding: HashMap<String, Outstanding>,
}

impl CorrelationGate {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_request(&mut self, frame: &Frame) -> Result<()> {
        if frame.kind != FrameKind::Request {
            return Err(CoreError::new(
                ErrorCode::InvalidFrame,
                "only requests are registered",
            ));
        }
        if self.outstanding.contains_key(&frame.id) {
            return Err(CoreError::new(
                ErrorCode::CorrelationRejected,
                "duplicate request id",
            ));
        }
        self.outstanding.insert(
            frame.id.clone(),
            Outstanding {
                workspace_id: frame.workspace_id.clone(),
                run_id: frame.run_id.clone(),
                cancelled: false,
            },
        );
        Ok(())
    }

    pub fn cancel(&mut self, request_id: &str) -> Result<()> {
        let slot = self
            .outstanding
            .get_mut(request_id)
            .ok_or_else(|| CoreError::new(ErrorCode::CorrelationRejected, "unknown request"))?;
        slot.cancelled = true;
        Ok(())
    }

    pub fn accept(&self, frame: &Frame, now_unix_ms: u64) -> Result<()> {
        if let Some(deadline) = frame.deadline_unix_ms {
            if now_unix_ms > deadline {
                return Err(CoreError::new(
                    ErrorCode::Timeout,
                    "frame deadline exceeded",
                ));
            }
        }
        let key = frame.reply_to.clone().unwrap_or_else(|| frame.id.clone());
        if frame.kind == FrameKind::Request && frame.reply_to.is_none() {
            return Ok(());
        }
        let slot = self.outstanding.get(&key).ok_or_else(|| {
            CoreError::new(
                ErrorCode::CorrelationRejected,
                "reply does not match an outstanding request",
            )
        })?;
        if slot.cancelled {
            return Err(CoreError::new(
                ErrorCode::Cancelled,
                "request was cancelled",
            ));
        }
        if let (Some(expected), Some(got)) = (&slot.workspace_id, &frame.workspace_id) {
            if expected != got {
                return Err(CoreError::new(
                    ErrorCode::WorkspaceMismatch,
                    "cross-workspace reply rejected",
                ));
            }
        }
        if let (Some(expected), Some(got)) = (&slot.run_id, &frame.run_id) {
            if expected != got {
                return Err(CoreError::new(
                    ErrorCode::RunMismatch,
                    "cross-run reply rejected",
                ));
            }
        }
        if frame.workspace_id.is_none()
            && slot.workspace_id.is_some()
            && frame.kind != FrameKind::Request
        {
            return Err(CoreError::new(
                ErrorCode::WorkspaceMismatch,
                "reply dropped workspace binding",
            ));
        }
        Ok(())
    }
}

pub fn error_frame(reply_to: &str, code: ErrorCode, message: &str) -> Frame {
    Frame {
        v: 1,
        kind: FrameKind::Error,
        id: format!("err_{}", "0123456789abcdef0123456789abcdef"),
        reply_to: Some(reply_to.to_string()),
        workspace_id: None,
        run_id: None,
        method: "error".to_string(),
        deadline_unix_ms: None,
        payload: json!({}),
        error: Some(IpcErrorBody {
            code: code.as_str().to_string(),
            message: message.to_string(),
            retryable: matches!(code, ErrorCode::Timeout | ErrorCode::QueueOverflow),
        }),
    }
}

pub fn check_deadline(deadline_unix_ms: u64, now_unix_ms: u64) -> Result<()> {
    if now_unix_ms > deadline_unix_ms {
        Err(CoreError::new(ErrorCode::Timeout, "deadline exceeded"))
    } else {
        Ok(())
    }
}
