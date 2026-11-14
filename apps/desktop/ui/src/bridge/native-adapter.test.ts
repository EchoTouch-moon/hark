import test from "node:test";
import assert from "node:assert/strict";
import type { HarkBridge, HarkUIError, OpinionView } from "./HarkBridge.ts";
import {
  buildConfirmArgs,
  createTauriHarkBridge,
  encodePreviewId,
  mapConversationEvent,
  mapScanToPreview,
  parseInvokeError,
  selectBridge,
  toUiError,
  type AuthorizedRoot,
  type ConversationEventDto,
  type InitialScan,
  type InvokeFn,
  type NativeWorkspace,
  type PickTicket,
  type ShellSnapshotDto,
  type SourceRefDto,
} from "./native-adapter.ts";

import { projectMemoryReceipts, type StoredMemoryReceipt } from "./receipt-projection.ts";

const ROOT = "root_0123456789abcdef0123456789abcdef";
const SCAN = "scan_0123456789abcdef0123456789abcdef";
const CAND = "cand_0123456789abcdef0123456789abcdef";
const WS = "ws_0123456789abcdef0123456789abcdef";
const CONV = "conv_0123456789abcdef0123456789abcdef";
const SRC = "src_0123456789abcdef0123456789abcdef";
const MSG = "msg_0123456789abcdef0123456789abcdef";
const REVIEW = "review_0123456789abcdef0123456789abcdef";
const REVIEW_RUN = "run_0123456789abcdef0123456789abcdef";

test("outbound review retrieves the Native snapshot and decides by identity only", async () => {
  const ref = { workspaceId: WS, runId: REVIEW_RUN, reviewId: REVIEW };
  const snapshot = { ...ref, recipient: "https://example.invalid/messages", model: "synthetic", limits: [{ label: "最大输出", value: "200" }], sources: [{ sourceId: SRC, path: "README.md", version: "synthetic-v1", byteLen: 3, truncated: false }], body: "{ \"synthetic\": true }" };
  const { invoke, calls } = recorder({ get_outbound_review: () => snapshot, decide_outbound_review: () => null });
  const bridge = createTauriHarkBridge(invoke);
  assert.deepEqual(await bridge.getOutboundReview!(ref), snapshot);
  await bridge.decideOutboundReview!(ref, "approve");
  assert.deepEqual(calls.map((call) => call.args), [{ request: ref }, { request: { ...ref, decision: "approve" } }]);
});

test("outbound review refuses mismatched identities and unexpected fields", async () => {
  const ref = { workspaceId: WS, runId: REVIEW_RUN, reviewId: REVIEW };
  const snapshot = { ...ref, recipient: "https://example.invalid/messages", model: "synthetic", limits: [], sources: [], body: "{}" };
  const wrong = recorder({ get_outbound_review: () => ({ ...snapshot, workspaceId: "ws_00000000000000000000000000000000" }) });
  await assert.rejects(createTauriHarkBridge(wrong.invoke).getOutboundReview!(ref));
  const extra = recorder({ get_outbound_review: () => ({ ...snapshot, headers: { authorization: "synthetic-secret" } }) });
  await assert.rejects(createTauriHarkBridge(extra.invoke).getOutboundReview!(ref));
  const bad = recorder({});
  await assert.rejects(createTauriHarkBridge(bad.invoke).getOutboundReview!({ ...ref, reviewId: "bad" }));
  assert.equal(bad.calls.length, 0);
});

function storedReceipt(): StoredMemoryReceipt {
  return { operationId: "op-saved", workspaceId: WS, recorded: true, reverted: false,
    stillCurrent: true, currentStatus: "active", decisionTitle: "技术选择", decisionSummary: "先试 Bun，Node 保底",
    committedAt: "2026-11-06T00:00:01Z", revision: 1, sourceMessageId: MSG };
}

test("persisted memory receipts survive conversation reload without inventing user text", async () => {
  const raw = { id: MSG, workspaceId: WS, conversationId: CONV, kind: "user_message", body: "先试 Bun，Node 保底", sourceIds: [], presentation: "normal", createdAt: "2026-11-06T00:00:00Z" };
  const { invoke, calls } = recorder({
    list_workspaces: () => [workspace()], list_conversation: () => [raw], list_source_refs: () => [],
    onboarding: () => ({ modelAnalyzed: false }), list_memory_receipts: () => [storedReceipt()],
  });
  const page = await createTauriHarkBridge(invoke).getConversation(CONV);
  assert.deepEqual(page.messages.map((item) => item.kind), ["text", "memory_receipt"]);
  assert.equal(page.messages[0].content, raw.body);
  assert.equal(page.messages[1].memoryReceipt?.operationId, "op-saved");
  assert.ok(calls.some((call) => call.cmd === "list_memory_receipts"));
});

test("receipt projection never marks an uncommitted or missing-time result saved", () => {
  assert.deepEqual(projectMemoryReceipts([], [
    { ...storedReceipt(), recorded: false }, { ...storedReceipt(), committedAt: null },
    { ...storedReceipt(), workspaceId: "other" },
  ], WS, CONV), []);
  const reverted = projectMemoryReceipts([], [{ ...storedReceipt(), reverted: true, stillCurrent: false }], WS, CONV);
  assert.equal(reverted[0].memoryReceipt?.reverted, true);
});

function opinionView(): OpinionView {
  return {
    id: "opinion-native", workspaceId: WS, title: "项目建议", revision: 2,
    summary: "先试 Bun，Node 保底", rationale: "推断，不是验证事实",
    evidenceRefs: [MSG], counterArguments: [], uncertainties: ["尚未验证"],
    status: "pending_revision", lastUpdatedAt: "2026-11-06T00:00:00Z",
    history: [{ revision: 1, status: "active", note: "初始建议", updatedAt: "2026-11-06T00:00:00Z" }],
  };
}

test("opinion queries and feedback use Native records and preserve pending revision", async () => {
  const view = opinionView();
  const { invoke, calls } = recorder({
    list_workspace_opinions: () => [view], get_opinion: () => view,
    submit_opinion_feedback: () => view,
  });
  const bridge = createTauriHarkBridge(invoke);
  assert.deepEqual(await bridge.listWorkspaceOpinions(WS), [view]);
  assert.equal((await bridge.getOpinion(view.id)).status, "pending_revision");
  const feedback = { requestId: "req-feedback", workspaceId: WS, opinionId: view.id, expectedRevision: 1, action: "revise" as const, userComment: "请重新比较" };
  assert.equal((await bridge.submitOpinionFeedback(feedback)).summary, view.summary);
  assert.deepEqual(calls[1].args, { request: { workspaceId: WS, opinionId: view.id } });
  assert.deepEqual(calls[2].args, { request: feedback });
});

test("history search keeps historical and LIKE labels and reads actual message evidence", async () => {
  const { invoke, calls } = recorder({
    search_workspace_memory: () => ({
      workspaceId: WS, matchMode: "like_fallback", usedOrFallback: true,
      items: [{ id: "history", workspaceId: WS, kind: "identity", title: "项目身份",
        snippet: "先试 Bun", recordedAt: "2026-11-06T00:00:00Z", statusLabel: "历史修订，不是当前决定",
        sourceRefId: MSG, termMatch: "like_fallback" }],
    }),
    get_message_evidence: () => ({ id: MSG, workspaceId: WS, conversationId: CONV,
      kind: "user_message", body: "先试 Bun，Node 保底", sourceIds: [],
      presentation: "normal", createdAt: "2026-11-06T00:00:00Z" }),
  });
  const bridge = createTauriHarkBridge(invoke);
  const page = await bridge.searchWorkspaceMemory({ workspaceId: WS, query: "先试" });
  assert.equal(page.items[0].kind, "identity");
  assert.match(page.items[0].statusLabel, /历史修订/);
  assert.match(page.items[0].statusLabel, /LIKE/);
  assert.match(page.items[0].statusLabel, /OR召回/);
  const evidence = await bridge.getEvidence(MSG);
  assert.equal(evidence.excerpt, "先试 Bun，Node 保底");
  assert.equal(evidence.kind, "conversation");
  assert.deepEqual(calls[1].args, { request: { workspaceId: WS, messageId: MSG } });
});

test("undo requires a real Core reverted receipt", async () => {
  const { invoke, calls } = recorder({ revert_memory_operation: () => ({
    operationId: "save", workspaceId: WS, reverted: true, revision: 2,
    committedAt: "2026-11-06T00:00:00Z", decisionTitle: "原决定", decisionSummary: "追加撤销修订",
  }) });
  const bridge = createTauriHarkBridge(invoke);
  assert.equal((await bridge.revertMemoryOperation(WS, "save")).reverted, true);
  assert.deepEqual(calls[0].args, { request: { workspaceId: WS, operationId: "save" } });
  const bad = recorder({ revert_memory_operation: () => ({ recorded: false, reverted: false }) });
  await assert.rejects(() => createTauriHarkBridge(bad.invoke).revertMemoryOperation(WS, "missing"));
});

function workspace(): NativeWorkspace {
  return {
    id: WS,
    rootId: ROOT,
    agentId: "agt_0123456789abcdef0123456789abcdef",
    conversationId: CONV,
    relativePath: "",
    dev: "1",
    ino: "2",
    displayName: "炉心样本",
    status: "active",
    createdAt: "2026-11-06T00:00:00Z",
  };
}

function snapshot(): ShellSnapshotDto {
  return {
    roots: [root()],
    workspaces: [workspace()],
    readerCapability: "unix_openat_nofollow_finder_alias",
    remoteModelTransport: "closed_no_approved_key",
    sidecar: {
      connected: false,
      transport: "not_started",
      windowsJobObject: "unverified_no_sidecar",
      reason: "未配置",
    },
    notes: ["本地发现卡不是模型分析。"],
  };
}

function root(): AuthorizedRoot {
  return {
    id: ROOT,
    path: "/tmp/hark-sample",
    dev: "1",
    ino: "2",
    status: "active",
    createdAt: "2026-11-06T00:00:00Z",
    updatedAt: "2026-11-06T00:00:00Z",
  };
}

function scan(): InitialScan {
  return {
    id: SCAN,
    rootId: ROOT,
    status: "completed",
    coverage: "complete",
    limitsHit: [],
    ignored: [{ relativePath: "target", reason: "artifact" }],
    candidates: [
      {
        id: CAND,
        relativePath: "",
        role: "single_root",
        evidence: ["Cargo.toml"],
        suggested: true,
      },
    ],
    defaultSingleProject: true,
    filesSeen: 4,
    dirsSeen: 2,
    createdAt: "2026-11-06T00:00:01Z",
    finishedAt: "2026-11-06T00:00:02Z",
  };
}

function ticket(): PickTicket {
  return {
    pickToken: "pick_token_only",
    displayName: "hark-sample",
    expiresAtUnixMs: 1,
    directoryRead: "local_readonly",
    remoteModel: "closed",
  };
}

function source(): SourceRefDto {
  return {
    id: SRC,
    workspaceId: WS,
    relativePath: "README.md",
    contentSha256: "abc",
    byteLen: 12,
    truncated: true,
    binary: false,
    excerpt: "hello excerpt",
    observedAt: "2026-11-06T00:01:00Z",
    contentAvailable: true,
  };
}

function recorder(handlers: Record<string, (args?: Record<string, unknown>) => unknown>): {
  invoke: InvokeFn;
  calls: Array<{ cmd: string; args?: Record<string, unknown> }>;
} {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const invoke: InvokeFn = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ cmd, args });
    const handler = handlers[cmd];
    if (!handler) {
      throw { code: "unexpected_command", detail: cmd };
    }
    return handler(args) as T;
  };
  return { invoke, calls };
}

function poisonPreview(): HarkBridge {
  return new Proxy({} as HarkBridge, {
    get() {
      return () => {
        throw new Error("dev preview must not be called");
      };
    },
  });
}

test("strict host failure does not fall back to dev preview", async () => {
  const { invoke, calls } = recorder({
    shell_snapshot: () => {
      throw { code: "sqlite", detail: "disk" };
    },
  });
  const bridge = selectBridge({
    mode: "strict_tauri_ipc",
    hostAvailable: true,
    invoke,
    devPreview: poisonPreview(),
    unavailable: poisonPreview(),
  });
  await assert.rejects(() => bridge.getAppSnapshot(), (err: unknown) => {
    const ui = err as HarkUIError;
    assert.equal(ui.details?.nativeCode, "sqlite");
    assert.equal(ui.message.includes("disk"), true);
    return true;
  });
  assert.deepEqual(calls.map((call) => call.cmd), ["shell_snapshot"]);
});

test("strict without a host does not invoke and does not use preview", async () => {
  let invoked = false;
  const bridge = selectBridge({
    mode: "strict_tauri_ipc",
    hostAvailable: false,
    invoke: async <T,>(): Promise<T> => {
      invoked = true;
      return undefined as T;
    },
    devPreview: poisonPreview(),
    unavailable: {
      async getAppSnapshot() {
        throw { code: "SIDECAR_UNAVAILABLE", message: "no host", retryable: true };
      },
    } as unknown as HarkBridge,
  });
  await assert.rejects(() => bridge.getAppSnapshot());
  assert.equal(invoked, false);
});

test("dev preview is only selected explicitly", () => {
  const preview = { tag: "preview" } as unknown as HarkBridge;
  const selected = selectBridge({
    mode: "dev_preview_synthetic",
    hostAvailable: true,
    invoke: async <T,>(): Promise<T> => undefined as T,
    devPreview: preview,
    unavailable: poisonPreview(),
  });
  assert.equal(selected, preview);
});

test("picker flow sends token only and never a path", async () => {
  const { invoke, calls } = recorder({
    pick_directory: () => ticket(),
    authorize_picked: () => root(),
    scan_root: () => scan(),
  });
  const bridge = createTauriHarkBridge(invoke);
  const preview = await bridge.pickAndScan?.();
  assert.equal(preview?.previewId, encodePreviewId(ROOT, SCAN));
  assert.equal(calls[0]?.cmd, "pick_directory");
  assert.equal(JSON.stringify(calls[1]?.args), JSON.stringify({ request: { pickToken: "pick_token_only" } }));
  assert.equal(JSON.stringify(calls[2]?.args), JSON.stringify({ rootId: ROOT }));
  assert.equal(JSON.stringify(calls).includes("/tmp/hark-sample"), false);
  assert.equal(preview?.scanStatus, "ready");
  assert.equal(preview?.candidates[0]?.selectable, true);
});

test("path preview does not invoke", async () => {
  const { invoke, calls } = recorder({});
  const bridge = createTauriHarkBridge(invoke);
  await assert.rejects(() => bridge.previewRoot("/Users/private/project"), (err: unknown) => {
    assert.equal((err as HarkUIError).details?.nativeCode, "path_read_closed");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("confirm body is root scan and selection only", () => {
  const args = buildConfirmArgs({
    requestId: "req-should-not-pass",
    previewId: encodePreviewId(ROOT, SCAN),
    selectedCandidateIds: [CAND],
    importMode: "multiple",
    enableModelInitialRead: true,
    enableWebSearch: true,
    customExcludedPaths: ["secret"],
    nativeSelection: "selected",
  });
  assert.deepEqual(args, {
    request: {
      rootId: ROOT,
      scanId: SCAN,
      selection: { kind: "selected", candidateIds: [CAND] },
    },
  });
  const single = buildConfirmArgs({
    requestId: "nope",
    previewId: encodePreviewId(ROOT, SCAN),
    selectedCandidateIds: [CAND],
    importMode: "single",
    enableModelInitialRead: true,
    enableWebSearch: false,
    nativeSelection: "single",
  });
  assert.deepEqual(single.request.selection, { kind: "single" });
});

test("confirm without nativeSelection is refused before invoke", async () => {
  const { invoke, calls } = recorder({});
  const bridge = createTauriHarkBridge(invoke);
  await assert.rejects(() =>
    bridge.confirmImport({
      requestId: "x",
      previewId: encodePreviewId(ROOT, SCAN),
      selectedCandidateIds: [CAND],
      importMode: "single",
      enableModelInitialRead: true,
      enableWebSearch: false,
    }),
  );
  assert.equal(calls.length, 0);
});

test("read failure does not commit a card or fall back", async () => {
  const { invoke, calls } = recorder({
    selective_key_read: () => {
      throw { code: "root_paused", detail: "目录已暂停" };
    },
    commit_local_scan_card: () => {
      throw new Error("must not commit");
    },
  });
  const bridge = createTauriHarkBridge(invoke);
  const recognize = bridge.continueLocalRecognition;
  if (!recognize) {
    throw new Error("continueLocalRecognition missing");
  }
  await assert.rejects(() => recognize(WS));
  assert.deepEqual(calls.map((call) => call.cmd), ["selective_key_read"]);
});

test("local scan card is not disguised as model understanding", () => {
  const event: ConversationEventDto = {
    id: MSG,
    workspaceId: WS,
    conversationId: CONV,
    kind: "local_scan_card",
    body: "本地只读初扫（尚未进行模型推理）。",
    presentation: "expanded",
    sourceIds: [SRC],
    createdAt: "2026-11-06T00:02:00Z",
  };
  const message = mapConversationEvent(event, [source()], false);
  assert.equal(message.kind, "local_scan_card");
  assert.equal(message.openingData, undefined);
  assert.equal(message.localScanData?.modelAuthRequired, true);
  assert.equal(message.localScanData?.detectedLanguages[0], "未做模型识别");
  assert.equal(message.localScanData?.keyManifests[0], "README.md");
  assert.equal(message.content.includes("尚未进行模型推理"), true);
});

test("source ref detail uses the returned excerpt and does not imply a path read", async () => {
  const hidden: SourceRefDto = { ...source(), contentAvailable: false, excerpt: "hidden" };
  const { invoke, calls } = recorder({
    list_source_refs: () => [hidden],
    get_source_ref: () => hidden,
  });
  const bridge = createTauriHarkBridge(invoke);
  await bridge.listWorkspaceEvidence(WS);
  const detail = await bridge.getEvidence(SRC);
  assert.equal(detail.excerpt, "");
  assert.equal(detail.availability, "restricted");
  assert.equal(calls.some((call) => call.cmd === "read_workspace_file"), false);
  assert.deepEqual(calls[1]?.args, { request: { workspaceId: WS, sourceId: SRC } });
});

const RUN = "run_0123456789abcdef0123456789abcdef";

function turnInput(prompt = "你好") {
  return {
    requestId: "req-turn-1",
    workspaceId: WS,
    conversationId: CONV,
    userPrompt: prompt,
  };
}

function acceptedMessage() {
  return {
    id: MSG,
    workspaceId: WS,
    conversationId: CONV,
    kind: "user_message",
    body: "你好",
    presentation: "normal",
    sourceIds: [],
    createdAt: "2026-11-06T00:03:00Z",
  };
}

test("startAgentTurn rejects empty input before invoke and does not invent completion", async () => {
  const { invoke, calls } = recorder({});
  const bridge = createTauriHarkBridge(invoke, {
    turnChannel: (onEvent) => ({ kind: "channel", onEvent }),
  });
  const events: string[] = [];
  await assert.rejects(() => bridge.startAgentTurn(turnInput("  "), (event) => events.push(event.type)));
  await assert.rejects(() =>
    bridge.startAgentTurn({ ...turnInput(), workspaceId: "not-an-id" }, (event) => events.push(event.type)),
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(events, []);
});

test("startAgentTurn creates the channel before invoke and does not mark an unverified run done", async () => {
  let handler: ((event: import("./HarkBridge.ts").RunStreamEvent) => void) | null = null;
  let channelSeen = false;
  const { invoke, calls } = recorder({
    start_agent_turn: () => {
      channelSeen = handler !== null;
      handler?.({
        schemaVersion: "hark.ui.v1",
        workspaceId: WS,
        conversationId: CONV,
        runId: RUN,
        seq: 1,
        type: "run_started",
        payload: {},
      });
      return { runId: RUN, acceptedUserMessage: acceptedMessage() };
    },
    get_agent_turn: () => ({
      runId: RUN,
      workspaceId: WS,
      conversationId: CONV,
      state: "running",
    }),
    cancel_agent_turn: () => ({
      runId: RUN,
      workspaceId: WS,
      conversationId: CONV,
      state: "cancelled",
    }),
  });
  const bridge = createTauriHarkBridge(invoke, {
    turnChannel: (onEvent) => {
      handler = onEvent;
      return { kind: "test-channel" };
    },
  });
  const events: string[] = [];
  const started = await bridge.startAgentTurn(turnInput(), (event) => events.push(event.type));
  assert.equal(channelSeen, true);
  assert.equal(calls[0]?.cmd, "start_agent_turn");
  assert.equal((calls[0]?.args?.onEvent as { kind?: string } | undefined)?.kind, "test-channel");
  assert.deepEqual(calls[0]?.args?.request, {
    requestId: "req-turn-1",
    workspaceId: WS,
    conversationId: CONV,
    userPrompt: "你好",
  });
  assert.equal(started.runId, RUN);
  assert.equal(started.acceptedUserMessage.role, "user");
  assert.equal(started.acceptedUserMessage.content, "你好");
  assert.deepEqual(events, ["run_started"]);
  assert.equal(events.includes("run_completed"), false);
  const status = await bridge.getRunStatus(RUN);
  assert.equal(status.state, "running");
  assert.deepEqual(calls[1]?.args, { request: { workspaceId: WS, runId: RUN } });
  const cancelled = await bridge.cancelAgentTurn(RUN);
  assert.equal(cancelled.state, "cancelled");
  await assert.rejects(() => bridge.getRunStatus("run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
  assert.equal(calls.some((call) => call.cmd === "get_agent_turn" && (call.args?.request as { runId?: string })?.runId === "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("startAgentTurn maps an unconfigured sidecar without emitting completion", async () => {
  const { invoke, calls } = recorder({
    start_agent_turn: () => {
      throw { code: "model_not_configured", detail: "sidecar is not connected" };
    },
  });
  const bridge = createTauriHarkBridge(invoke, {
    turnChannel: (onEvent) => {
      void onEvent;
      return { kind: "test-channel" };
    },
  });
  const events: string[] = [];
  await assert.rejects(
    () => bridge.startAgentTurn(turnInput(), (event) => events.push(event.type)),
    (err: unknown) => {
      assert.equal((err as HarkUIError).code, "MODEL_NOT_CONFIGURED");
      return true;
    },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(events, []);
});

test("unverified completion preserves accepted run identity for reconciliation", async () => {
  let handler: ((event: import("./HarkBridge.ts").RunStreamEvent) => void) | undefined;
  const { invoke } = recorder({
    start_agent_turn: () => {
      handler?.({ schemaVersion: "hark.ui.v1", workspaceId: WS, conversationId: CONV, runId: RUN,
        seq: 1, type: "run_completed", payload: { persistenceVerified: false } });
      return { runId: RUN, acceptedUserMessage: acceptedMessage() };
    },
  });
  const bridge = createTauriHarkBridge(invoke, { turnChannel: (onEvent) => { handler = onEvent; return {}; } });
  const events: import("./HarkBridge.ts").RunStreamEvent[] = [];
  const started = await bridge.startAgentTurn(turnInput(), (event) => events.push(event));
  assert.equal(started.runId, RUN);
  assert.equal(events[0]?.payload.persistenceVerified, false);
});

test("request recovery registers only the matching workspace and conversation", async () => {
  const { invoke, calls } = recorder({
    get_agent_turn_by_request: () => ({ runId: RUN, workspaceId: WS, conversationId: CONV, state: "running" }),
    get_agent_turn: () => ({ runId: RUN, workspaceId: WS, conversationId: CONV, state: "running" }),
  });
  const bridge = createTauriHarkBridge(invoke);
  assert.equal((await bridge.getRunStatusByRequest!(WS, CONV, "req-turn-1"))?.runId, RUN);
  assert.deepEqual(calls[0]?.args, { request: { workspaceId: WS, conversationId: CONV, requestId: "req-turn-1" } });
  assert.equal((await bridge.getRunStatus(RUN)).state, "running");
  const mismatched = recorder({ get_agent_turn_by_request: () => ({ runId: RUN, workspaceId: "other", conversationId: CONV, state: "running" }) });
  await assert.rejects(() => createTauriHarkBridge(mismatched.invoke).getRunStatusByRequest!(WS, CONV, "req-turn-1"));
});

test("native channel converts the closed transport failure into an actionable connection error", async () => {
  let handler: ((event: import("./HarkBridge.ts").RunStreamEvent) => void) | undefined;
  const { invoke } = recorder({ start_agent_turn: () => ({ runId: RUN, acceptedUserMessage: acceptedMessage() }) });
  const bridge = createTauriHarkBridge(invoke, { turnChannel: (onEvent) => { handler = onEvent; return {}; } });
  const events: import("./HarkBridge.ts").RunStreamEvent[] = [];
  await bridge.startAgentTurn(turnInput(), (event) => events.push(event));
  handler?.({ schemaVersion: "hark.ui.v1", workspaceId: WS, conversationId: CONV, runId: RUN, seq: 2,
    type: "run_failed", payload: { error: { code: "model_not_authorized", message: "network guard refused: no explicit fetch was injected", retryable: false } as unknown as HarkUIError } });
  assert.equal(events[0]?.payload.error?.code, "CONNECTION_LOST");
  assert.match(events[0]?.payload.error?.message ?? "", /连接/);
  assert.equal(events[0]?.payload.error?.message.includes("network guard"), false);
});

test("snapshot load uses shell_snapshot, list_workspaces, and list_attention_items and does not mark the model configured", async () => {
  const { invoke, calls } = recorder({
    shell_snapshot: () => snapshot(),
    list_workspaces: () => [workspace()],
    list_attention_items: () => [
      {
        id: "att-1",
        workspaceId: WS,
        reason: "3 recent changes need your review",
        sourceRef: "recent:0",
        createdAt: 1700000005,
        dismissed: false,
      },
      {
        id: "att-old",
        workspaceId: WS,
        reason: "already dismissed",
        sourceRef: "recent:1",
        createdAt: 1700000001,
        dismissed: true,
      },
    ],
  });
  const bridge = createTauriHarkBridge(invoke);
  const app = await bridge.getAppSnapshot();
  assert.deepEqual(
    calls.map((call) => call.cmd),
    ["shell_snapshot", "list_workspaces", "list_attention_items"],
  );
  assert.equal(app.runtime.stepFunConfigured, false);
  assert.equal(app.runtime.piSidecarStatus, "unavailable");
  assert.equal(app.currentWorkspaceId, WS);
  assert.equal(app.workspaces[0]?.observerState, "unavailable");
  assert.equal(app.attentionItems.length, 1);
  assert.equal(app.attentionItems[0]?.id, "att-1");
  assert.equal(app.attentionItems[0]?.workspaceName, "炉心样本");
  assert.equal(app.attentionItems[0]?.conversationId, CONV);
});

test("configured session key remains visible when the sidecar is disconnected", async () => {
  const { invoke } = recorder({
    shell_snapshot: () => ({ ...snapshot(), remoteModelTransport: "stepfun_session_memory" }),
    list_workspaces: () => [],
  });
  const app = await createTauriHarkBridge(invoke).getAppSnapshot();
  assert.equal(app.runtime.stepFunConfigured, true);
  assert.equal(app.runtime.piSidecarStatus, "unavailable");
});

test("a configured key and connected host do not imply outbound model transport is available", async () => {
  const { invoke } = recorder({
    shell_snapshot: () => ({ ...snapshot(), remoteModelTransport: "stepfun_session_memory", modelTransportAvailable: false,
      sidecar: { ...snapshot().sidecar, connected: true } }),
    list_workspaces: () => [],
  });
  const app = await createTauriHarkBridge(invoke).getAppSnapshot();
  assert.equal(app.runtime.stepFunConfigured, true);
  assert.equal(app.runtime.piSidecarStatus, "ready");
  assert.equal(app.runtime.modelTransportAvailable, false);
});

test("unknown model transport is not treated as a configured key", async () => {
  const { invoke } = recorder({
    shell_snapshot: () => ({ ...snapshot(), remoteModelTransport: "unknown" }),
    list_workspaces: () => [],
  });
  const app = await createTauriHarkBridge(invoke).getAppSnapshot();
  assert.equal(app.runtime.stepFunConfigured, false);
});

test("unfinished child workspace and excludedPaths surfaces do not invoke", async () => {
  const { invoke, calls } = recorder({});
  const bridge = createTauriHarkBridge(invoke);
  await assert.rejects(() =>
    bridge.createChildWorkspace({
      requestId: "x",
      parentWorkspaceId: WS,
      relativeSubPath: "crates",
      suggestedName: "child",
      excludeFromParent: true,
      retainParentHistoryRef: true,
    }),
  );
  await assert.rejects(() =>
    bridge.setWorkspacePermissions({
      requestId: "x",
      workspaceId: WS,
      expectedRevision: 1,
      excludedPaths: ["tmp/"],
    }),
  );
  assert.equal(calls.length, 0);
});

test("model grant uses the existing set_model_grant command and does not send a key", async () => {
  const { invoke, calls } = recorder({
    set_model_grant: () => ({
      id: "grn_0123456789abcdef0123456789abcdef",
      workspaceId: WS,
      service: "model",
      status: "enabled",
      provider: "stepfun",
      model: "step-3.7-flash",
      updatedAt: "2026-11-06T00:00:00Z",
    }),
    service_grants: () => [
      {
        id: "grn_0123456789abcdef0123456789abcdef",
        workspaceId: WS,
        service: "model",
        status: "enabled",
        provider: "stepfun",
        model: "step-3.7-flash",
        updatedAt: "2026-11-06T00:00:00Z",
      },
    ],
  });
  const bridge = createTauriHarkBridge(invoke);
  const saved = await bridge.setWorkspacePermissions({
    requestId: "x",
    workspaceId: WS,
    expectedRevision: 1,
    modelPermission: "enabled",
  });
  assert.equal(saved.modelPermission, "enabled");
  assert.equal(calls[0]?.cmd, "set_model_grant");
  assert.equal(JSON.stringify(calls[0]?.args).includes("apiKey"), false);
  assert.equal(JSON.stringify(calls[0]?.args).includes("node"), false);
});

test("hide and quit call the real commands", async () => {
  const { invoke, calls } = recorder({
    hide_window: () => undefined,
    quit_app: () => undefined,
  });
  const bridge = createTauriHarkBridge(invoke);
  const hideWindow = bridge.hideWindow;
  const quitApp = bridge.quitApp;
  if (!hideWindow || !quitApp) {
    throw new Error("hideWindow or quitApp missing");
  }
  await hideWindow();
  await quitApp();
  assert.deepEqual(calls.map((call) => call.cmd), ["hide_window", "quit_app"]);
});

test("invoke error object and string shapes do not become success", () => {
  assert.deepEqual(parseInvokeError({ code: "pick_expired", detail: "过期" }), {
    code: "pick_expired",
    detail: "过期",
  });
  assert.equal(parseInvokeError('{"code":"pick_not_found","detail":"无"}').code, "pick_not_found");
  const ui = toUiError({ code: "read_already_running", detail: "已在读取" });
  assert.equal(ui.code, "RUN_ALREADY_ACTIVE");
  assert.equal(ui.retryable, true);
  assert.equal("persistenceVerified" in ui, false);
});

test("scan mapping keeps ignored paths as display only", () => {
  const preview = mapScanToPreview(ticket(), root(), scan());
  assert.equal(preview.recommendedMode, "single");
  assert.deepEqual(preview.defaultExcludedPaths, ["target"]);
  assert.match(preview.readOnlyBoundaryNote, /只会读取/);
  assert.doesNotMatch(preview.readOnlyBoundaryNote, /pickToken|模型传输标记/);
});

test("credential storage capability and recovery errors are visible in runtime state", async () => {
  const { invoke } = recorder({
    shell_snapshot: () => ({ ...snapshot(), credentialPersistenceAvailable: true, credentialError: "无法读取系统保存的模型配置，请检查系统凭据访问权限。" }),
    list_workspaces: () => [],
  });
  const app = await createTauriHarkBridge(invoke).getAppSnapshot();
  assert.equal(app.runtime.credentialPersistenceAvailable, true);
  assert.match(app.runtime.credentialError ?? "", /无法读取/);
  assert.equal(app.runtime.stepFunConfigured, false);
});

test("getNarrativeState and getWorkspace map real Soul narrative state and observer status", async () => {
  const { invoke, calls } = recorder({
    get_workspace: () => workspace(),
    workspace_overview: () => ({
      workspace: workspace(),
      root: root(),
      sourcesCount: 1,
      opinionsCount: 0,
      messagesCount: 0,
      pendingMemoryCount: 0,
    }),
    service_grants: () => [
      {
        id: "grn_1",
        workspaceId: WS,
        service: "model",
        status: "enabled",
        provider: "stepfun",
        model: "step-3.7-flash",
        updatedAt: "2026-11-06T00:00:00Z",
      },
      {
        id: "grn_2",
        workspaceId: WS,
        service: "background_model",
        status: "paused",
        provider: null,
        model: null,
        updatedAt: "2026-11-06T00:00:00Z",
      },
    ],
    onboarding: () => ({ modelAnalyzed: false }),
    list_source_refs: () => [],
    list_roots: () => [root()],
    get_narrative_state: () => ({
      workspaceId: WS,
      flame: "bright",
      availability: "known",
      stageLabel: "active iteration",
      narrativeReason: "2 recent commits and active edits",
      basisRefs: ["git:abc", "file:src/main.rs"],
      observedAt: 1700000100,
      stale: false,
    }),
  });
  const bridge = createTauriHarkBridge(invoke);
  const narrative = await bridge.getNarrativeState(WS);
  assert.equal(narrative.flame, "bright");
  assert.equal(narrative.availability, "known");
  assert.equal(narrative.stageLabel, "active iteration");
  assert.deepEqual(narrative.basisRefs, ["git:abc", "file:src/main.rs"]);
  assert.equal(narrative.observedAt, 1700000100);
  assert.equal(narrative.stale, false);

  const detail = await bridge.getWorkspace(WS);
  assert.equal(detail.narrative.flame, "bright");
  assert.equal(detail.narrative.availability, "known");
  assert.equal(detail.summary.observerState, "paused");
  assert.equal(detail.summary.lastObservedAt, 1700000100);
  assert.ok(calls.some((c) => c.cmd === "get_narrative_state"));
});

test("getAppSnapshot isolates list_attention_items errors per workspace", async () => {
  const ws2 = "ws_22222222222222222222222222222222";
  const { invoke } = recorder({
    shell_snapshot: () => snapshot(),
    list_workspaces: () => [
      workspace(),
      { ...workspace(), id: ws2, displayName: "beta", conversationId: "conv_22222222222222222222222222222222" },
    ],
    list_attention_items: (args) => {
      if ((args as { workspaceId?: string }).workspaceId === WS) {
        throw new Error("boom");
      }
      return [
        {
          id: "att-beta",
          workspaceId: ws2,
          reason: "Pending changes in beta",
          sourceRef: "git:head",
          createdAt: 1700000200,
          dismissed: false,
        },
      ];
    },
  });
  const app = await createTauriHarkBridge(invoke).getAppSnapshot();
  assert.equal(app.attentionItems.length, 1);
  assert.equal(app.attentionItems[0]?.id, "att-beta");
  assert.equal(app.attentionItems[0]?.workspaceName, "beta");
  assert.equal(app.attentionItems[0]?.conversationId, "conv_22222222222222222222222222222222");
});

test("observer, attention, search grant, and search config commands invoke exact native contracts", async () => {
  const { invoke, calls } = recorder({
    dismiss_attention_item: () => undefined,
    observe_workspace: () => ({ workspaceId: WS, changedCount: 2 }),
    set_observer_paused: () => ({ paused: true }),
    get_workspace: () => workspace(),
    list_roots: () => [root()],
    set_search_grant: () => ({
      id: "grn_search",
      workspaceId: WS,
      service: "search",
      status: "enabled",
      provider: null,
      model: null,
      updatedAt: "2026-11-06T00:00:00Z",
    }),
    service_grants: () => [
      {
        id: "grn_search",
        workspaceId: WS,
        service: "search",
        status: "enabled",
        provider: null,
        model: null,
        updatedAt: "2026-11-06T00:00:00Z",
      },
      {
        id: "grn_bg",
        workspaceId: WS,
        service: "background_model",
        status: "paused",
        provider: null,
        model: null,
        updatedAt: "2026-11-06T00:00:00Z",
      },
    ],
    list_workspaces: () => [workspace()],
    get_search_config: () => ({
      activeProvider: "tavily",
      providers: {
        tavily: { apiKey: "tvly-***", endpoint: "https://api.tavily.com" },
      },
    }),
    save_search_config: () => ({
      activeProvider: "serper",
      providers: {
        serper: { apiKey: "srp-***" },
      },
    }),
  });
  const bridge = createTauriHarkBridge(invoke);

  await bridge.dismissAttentionItem?.(WS, "att-1");
  await bridge.observeWorkspace?.(WS);
  const pausedSummary = await bridge.updateWorkspaceState(WS, "paused");
  assert.equal(pausedSummary.observerState, "paused");

  const perms = await bridge.setWorkspacePermissions({
    requestId: "req-1",
    workspaceId: WS,
    expectedRevision: 1,
    searchPermission: "enabled",
    observerState: "paused",
  });
  assert.equal(perms.searchPermission, "enabled");
  assert.equal(perms.observerState, "paused");

  const loadedCfg = await bridge.getSearchConfig?.();
  assert.equal(loadedCfg?.activeProvider, "tavily");
  assert.equal(loadedCfg?.providers?.tavily?.apiKey, "tvly-***");
  assert.equal(loadedCfg?.providers?.tavily?.endpoint, "https://api.tavily.com");

  await bridge.saveSearchConfig?.({
    activeProvider: "serper",
    providers: { serper: { apiKey: "secret-key" } },
  });

  await bridge.saveSearchConfig?.({
    activeProvider: "zhipu_mcp",
    providers: {
      zhipu_mcp: {
        apiKey: "zp-coding-secret",
        endpoint: "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
      },
    },
  });

  const dismissCall = calls.find((c) => c.cmd === "dismiss_attention_item");
  const observeCall = calls.find((c) => c.cmd === "observe_workspace");
  const pausedCalls = calls.filter((c) => c.cmd === "set_observer_paused");
  const searchGrantCall = calls.find((c) => c.cmd === "set_search_grant");
  const saveSearchCalls = calls.filter((c) => c.cmd === "save_search_config");
  assert.deepEqual(dismissCall?.args, { workspaceId: WS, attentionId: "att-1" });
  assert.deepEqual(observeCall?.args, { workspaceId: WS });
  assert.equal(pausedCalls.length, 2);
  assert.deepEqual(pausedCalls[0]?.args, { workspaceId: WS, paused: true });
  assert.deepEqual(pausedCalls[1]?.args, { workspaceId: WS, paused: true });
  assert.deepEqual(searchGrantCall?.args, { workspaceId: WS, enabled: true });
  assert.equal(saveSearchCalls.length, 2);
  assert.deepEqual(saveSearchCalls[0]?.args, {
    config: { activeProvider: "serper", providers: { serper: { apiKey: "secret-key" } } },
  });
  assert.deepEqual(saveSearchCalls[1]?.args, {
    config: {
      activeProvider: "zhipu_mcp",
      providers: {
        zhipu_mcp: {
          apiKey: "zp-coding-secret",
          endpoint: "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
        },
      },
    },
  });
});

test("startConfiguredOpening invokes start_configured_opening and subscribeAppEvents delegates to listener", async () => {
  const { invoke, calls } = recorder({
    start_configured_opening: () => undefined,
  });
  let received: unknown = null;
  let unsubscribed = false;
  const bridge = createTauriHarkBridge(invoke, {
    listenAppEvents: async (listener) => {
      listener({ type: "attention_triggered", workspaceId: WS, timestamp: "2026-11-13T02:00:00Z" });
      return () => {
        unsubscribed = true;
      };
    },
  });

  await bridge.startConfiguredOpening?.(WS);
  assert.deepEqual(calls[0], { cmd: "start_configured_opening", args: { request: { workspaceId: WS } } });

  const unsub = await bridge.subscribeAppEvents((event) => {
    received = event;
  });
  assert.deepEqual(received, { type: "attention_triggered", workspaceId: WS, timestamp: "2026-11-13T02:00:00Z" });
  unsub();
  assert.equal(unsubscribed, true);
});
