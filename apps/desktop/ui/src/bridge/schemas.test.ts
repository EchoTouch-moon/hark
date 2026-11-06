import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSafeFlameStage,
  describeFlameVisual,
  createInitialStreamState,
  applyRunStreamEvents,
  getWorkspaceDraft,
  setWorkspaceDraft,
  resolveErrorDescriptor,
} from "./schemas.ts";
import type { NarrativeState, RunStreamEvent } from "./HarkBridge.ts";

test("NarrativeState: unknown availability or unrecognized stage falls back to neutral flame", () => {
  assert.equal(resolveSafeFlameStage(null), "neutral");
  assert.equal(
    resolveSafeFlameStage({
      availability: "unknown",
      flame: "bright",
      stageLabel: "",
      narrativeReason: "",
      basisRefs: [],
      stale: false,
    }),
    "neutral"
  );

  const invalidStage: NarrativeState = {
    availability: "known",
    flame: "super_fire_999" as unknown as NarrativeState["flame"],
    stageLabel: "异常阶段",
    narrativeReason: "未知",
    basisRefs: [],
    stale: false,
  };
  assert.equal(resolveSafeFlameStage(invalidStage), "neutral");

  const validGentle: NarrativeState = {
    availability: "known",
    flame: "gentle",
    stageLabel: "稳定小火",
    narrativeReason: "已核验 Cargo.toml 与 README",
    basisRefs: ["ev-1"],
    stale: false,
  };
  assert.equal(resolveSafeFlameStage(validGentle), "gentle");
  assert.equal(describeFlameVisual(validGentle).stage, "gentle");
});

test("Stream protocol: deduplicates seq, orders out-of-order events, and isolates by workspaceId/runId", () => {
  const initial = createInitialStreamState("ws-hark-core", "run-101");

  const events: RunStreamEvent[] = [
    {
      schemaVersion: "hark.ui.v1",
      workspaceId: "ws-hark-core",
      conversationId: "conv-1",
      runId: "run-101",
      seq: 2,
      type: "text_delta",
      payload: { delta: "第二段内容。" },
    },
    {
      schemaVersion: "hark.ui.v1",
      workspaceId: "ws-hark-core",
      conversationId: "conv-1",
      runId: "run-101",
      seq: 1,
      type: "text_delta",
      payload: { delta: "第一段内容，" },
    },
    // Duplicate seq 1 should be ignored
    {
      schemaVersion: "hark.ui.v1",
      workspaceId: "ws-hark-core",
      conversationId: "conv-1",
      runId: "run-101",
      seq: 1,
      type: "text_delta",
      payload: { delta: "重复注入内容" },
    },
    // Foreign workspace event should be strictly ignored
    {
      schemaVersion: "hark.ui.v1",
      workspaceId: "ws-other-project",
      conversationId: "conv-2",
      runId: "run-101",
      seq: 3,
      type: "text_delta",
      payload: { delta: "跨空间污染文本" },
    },
    {
      schemaVersion: "hark.ui.v1",
      workspaceId: "ws-hark-core",
      conversationId: "conv-1",
      runId: "run-101",
      seq: 4,
      type: "run_completed",
      payload: {
        persistedMessageId: "msg-persisted-99",
        persistenceVerified: true,
      },
    },
  ];

  const finalState = applyRunStreamEvents(initial, events);
  assert.equal(finalState.streamingText, "第一段内容，第二段内容。");
  assert.equal(finalState.status, "completed_verified");
  assert.equal(finalState.persistedMessageId, "msg-persisted-99");
});

test("Stream protocol: marks completed_unverified when run_completed has no persistence confirmation", () => {
  const initial = createInitialStreamState("ws-hark-core", "run-202");
  const events: RunStreamEvent[] = [
    {
      schemaVersion: "hark.ui.v1",
      workspaceId: "ws-hark-core",
      conversationId: "conv-1",
      runId: "run-202",
      seq: 1,
      type: "text_delta",
      payload: { delta: "临时回复草稿" },
    },
    {
      schemaVersion: "hark.ui.v1",
      workspaceId: "ws-hark-core",
      conversationId: "conv-1",
      runId: "run-202",
      seq: 2,
      type: "run_completed",
      payload: {
        persistenceVerified: false,
      },
    },
  ];

  const state = applyRunStreamEvents(initial, events);
  assert.equal(state.status, "completed_unverified");
  assert.equal(state.persistedMessageId, undefined);
});

test("Draft isolation: switching workspaces preserves separate draft strings", () => {
  let store = {};
  store = setWorkspaceDraft(store, "ws-1", "关于 SQLite WAL 模式的草稿");
  store = setWorkspaceDraft(store, "ws-2", "关于 Tauri Tray 菜单的草稿");

  assert.equal(getWorkspaceDraft(store, "ws-1"), "关于 SQLite WAL 模式的草稿");
  assert.equal(getWorkspaceDraft(store, "ws-2"), "关于 Tauri Tray 菜单的草稿");
  assert.equal(getWorkspaceDraft(store, "ws-3"), "");
});

test("Error code descriptor returns deterministic recovery metadata", () => {
  const desc = resolveErrorDescriptor("SIDECAR_UNAVAILABLE");
  assert.equal(desc.retryable, true);
  assert.ok(desc.title.includes("Sidecar"));
});
