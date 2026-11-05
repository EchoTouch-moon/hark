use std::fs;
use std::path::PathBuf;

use hark_core::{
    encode_frame, ipc_limits, parse_frame, CorrelationGate, Frame, FrameKind, SideQueues,
};

fn contracts_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../contracts")
}

fn load_json(name: &str) -> serde_json::Value {
    let text = fs::read_to_string(contracts_dir().join(name)).unwrap();
    serde_json::from_str(&text).unwrap()
}

#[test]
fn limits_file_matches_library() {
    let file = load_json("ipc-v1.limits.json");
    let limits = ipc_limits();
    assert_eq!(file["version"], limits.version);
    assert_eq!(file["maxFrameBytes"], limits.max_frame_bytes);
    assert_eq!(file["maxStreamQueue"], limits.max_stream_queue);
    assert_eq!(file["maxControlQueue"], limits.max_control_queue);
    assert_eq!(file["defaultTimeoutMs"], limits.default_timeout_ms);
    assert_eq!(file["maxTimeoutMs"], limits.max_timeout_ms);
}

#[test]
fn schema_accepts_examples_and_rejects_incomplete_frame() {
    let schema = load_json("ipc-v1.schema.json");
    for name in [
        "examples/valid-request.json",
        "examples/valid-event.json",
        "examples/valid-error.json",
    ] {
        let instance = load_json(name);
        jsonschema::validate(&schema, &instance).unwrap_or_else(|err| panic!("{name} {err}"));
        let bytes = serde_json::to_vec(&instance).unwrap();
        let frame = parse_frame(&bytes).unwrap();
        let encoded = encode_frame(&frame).unwrap();
        assert!(encoded.ends_with(b"\n"));
    }
    let invalid = load_json("examples/invalid-missing-binding.json");
    assert!(jsonschema::validate(&schema, &invalid).is_err());
}

#[test]
fn frame_limit_queue_and_cross_workspace_reply() {
    let too_big = vec![b'a'; hark_core::MAX_FRAME_BYTES + 1];
    assert_eq!(
        parse_frame(&too_big).unwrap_err().code,
        hark_core::ErrorCode::FrameTooLarge
    );

    let mut queues = SideQueues::new();
    for i in 0..hark_core::MAX_STREAM_QUEUE {
        queues.try_push(sample_event(&format!("{i:032x}"))).unwrap();
    }
    assert!(queues
        .try_push(sample_event("ffffffffffffffffffffffffffffffff"))
        .is_err());
    queues.try_push(sample_request()).unwrap();
    assert_eq!(queues.control_len(), 1);

    let request = sample_request();
    let mut gate = CorrelationGate::new();
    gate.register_request(&request).unwrap();
    let mut crossed = sample_event("abcdefabcdefabcdefabcdefabcdefab");
    crossed.reply_to = Some(request.id.clone());
    crossed.workspace_id = Some("ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string());
    crossed.run_id = request.run_id.clone();
    let err = gate.accept(&crossed, 0).unwrap_err();
    assert_eq!(err.code, hark_core::ErrorCode::WorkspaceMismatch);

    let mut late = sample_request();
    late.deadline_unix_ms = Some(10);
    assert_eq!(
        hark_core::check_deadline(10, 11).unwrap_err().code,
        hark_core::ErrorCode::Timeout
    );
    let _ = FrameKind::Request;
}

fn sample_request() -> Frame {
    parse_frame(&serde_json::to_vec(&load_json("examples/valid-request.json")).unwrap()).unwrap()
}

fn sample_event(hex: &str) -> Frame {
    let mut frame =
        parse_frame(&serde_json::to_vec(&load_json("examples/valid-event.json")).unwrap()).unwrap();
    frame.id = format!("evt_{hex}");
    frame
}
