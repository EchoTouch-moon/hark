import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { installCredentialPathDeny, isClosedCredentialPath } from "../src/credentials/path-deny.ts";
import { COMPACTION_SUMMARY_PREFIX } from "../src/context-pack.ts";
import { runStartPayloadSchema, type ProviderConfig } from "../src/dto.ts";
import { encodeFrame, mintId, NdjsonParser, type Frame } from "../src/ipc.ts";
import { createGuardedFetch, sseText, sseToolCall } from "../src/provider.ts";
import { HostRuntime, loadProviderConfig } from "../src/runtime.ts";
import type { OutboundRequestSnapshot } from "../src/outbound-request.ts";

const KEY = "synthetic-key-do-not-log";

function hex(n: number): string {
  return n.toString(16).padStart(32, "0");
}

function provider(enabled = true, allowRemote = true): ProviderConfig {
  return {
    enabled,
    providerId: "hark-byok",
    modelId: "local-model",
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: KEY,
    wire: "openai-completions",
    allowRemote,
  };
}

interface AuthState {
  current: boolean;
  grantUpdatedAt: string;
  revision: string;
  sourceVersion: string;
  overviewText: string;
}

interface Harness {
  host: HostRuntime;
  frames: Frame[];
  input: PassThrough;
  logs: string[];
  fetches: Array<{ url: string; body: string; auth: string }>;
  auth: AuthState;
  close: () => Promise<void>;
}

function startHarness(options: {
  dir: string;
  config?: ProviderConfig | null;
  responses?: Array<"text" | "tool" | "hold">;
  scripted?: boolean;
  hookShouldThrow?: () => boolean;
  failPack?: () => boolean;
  reviewedDispatch?: (snapshot: OutboundRequestSnapshot, run: { workspaceId: string; runId: string }, signal: AbortSignal) => Promise<Response>;
  auth?: Partial<{ current: boolean; grantUpdatedAt: string; revision: string; sourceVersion: string; overviewText: string }>;
}): Harness {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: Frame[] = [];
  const logs: string[] = [];
  const fetches: Harness["fetches"] = [];
  const parser = new NdjsonParser();
  const auth: AuthState = {
    current: true,
    grantUpdatedAt: "grant-v1",
    revision: "rev-a",
    sourceVersion: "src-a",
    overviewText: "overview-a",
    ...options.auth,
  };
  let script = 0;
  const host = new HostRuntime({
    appDataDir: options.dir,
    input,
    output,
    providerConfig: options.config === undefined ? provider() : options.config,
    ...(options.scripted
      ? {
          scriptedTransport: {
            responses: (options.responses ?? ["text"]).map((kind) => {
              if (kind === "hold") return { kind: "hold" as const, untilAbort: true as const };
              if (kind === "tool") {
                return { kind: "tool_call" as const, name: "workspace.read_file" as const, arguments: { relativePath: "README.md" } };
              }
              return { kind: "text" as const, text: "synthetic-scripted-reply" };
            }),
          },
        }
      : {}),
    fetchImpl: async (url, init) => {
      const headers = new Headers(init?.headers);
      fetches.push({ url: String(url), body: String(init?.body ?? ""), auth: headers.get("authorization") ?? "" });
      const kind = options.responses?.[script] ?? "text";
      script += 1;
      const body = kind === "tool" ? sseToolCall("workspace.read_file", { relativePath: "README.md" }) : sseText(`synthetic-reply-${script}`);
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
    ...(options.reviewedDispatch ? { reviewedDispatch: options.reviewedDispatch } : {}),
    ...(options.hookShouldThrow ? { hookShouldThrow: options.hookShouldThrow } : {}),
    ...(options.failPack ? { failPack: options.failPack } : {}),
    log: (line) => logs.push(line),
  });
  output.on("data", (chunk: Buffer) => {
    let parsed: Frame[] = [];
    try {
      parsed = parser.push(chunk);
    } catch (error) {
      frames.push({
        v: 1,
        kind: "error",
        id: mintId("err"),
        replyTo: null,
        workspaceId: null,
        runId: null,
        method: "error",
        deadlineUnixMs: null,
        payload: {},
        error: { code: error instanceof Error && "code" in error ? String((error as { code: string }).code) : "invalid_frame", message: "parser", retryable: false },
      });
      return;
    }
    for (const frame of parsed) {
      frames.push(frame);
      if (frame.method === "host.ready" && frame.kind === "request") {
        input.write(encodeFrame({ ...frame, kind: "response", replyTo: frame.id, payload: { synthetic: true } }));
      }
      if (frame.method === "tool.request" && frame.kind === "request") {
        const tool = frame.payload.tool;
        const payload = tool === "workspace.read_file"
          ? { relativePath: "README.md", text: "SYNTHETIC_FILE", synthetic: true }
          : {
              authorization: {
                runId: frame.runId,
                provider: "hark-byok",
                model: "local-model",
                rootId: `root_${hex(3)}`,
                rootUpdatedAt: "root-v1",
                grantUpdatedAt: auth.grantUpdatedAt,
                directoryStatus: "active",
                modelGrantStatus: "active",
                current: auth.current,
              },
              sourceVersion: auth.sourceVersion,
              contextPackRevision: auth.revision,
              overviewText: auth.overviewText,
              synthetic: true,
            };
        input.write(encodeFrame({
          ...frame,
          kind: "response",
          replyTo: frame.id,
          method: "tool.result",
          payload,
        }));
      }
    }
  });
  void host.start();
  return {
    host,
    frames,
    input,
    logs,
    fetches,
    auth,
    close: async () => {
      input.end();
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}

function runStart(seq: number, extra: Record<string, unknown> = {}): Frame {
  const now = Date.now();
  const payload: Record<string, unknown> = {
    provider: "hark-byok",
    model: "local-model",
    purpose: "conversation",
    authorization: {
      runId: `run_${hex(200 + seq)}`,
      provider: "hark-byok",
      model: "local-model",
      rootId: `root_${hex(3)}`,
      rootUpdatedAt: "root-v1",
      grantUpdatedAt: "grant-v1",
      directoryStatus: "active",
      modelGrantStatus: "active",
      current: true,
    },
    contextSnapshot: {
      contextPackRevision: "rev-a",
      sourceVersion: "src-a",
      empty: true,
    },
    userText: `user-turn-${seq}`,
    userMessageId: `msg_${hex(300 + seq)}`,
    sessionRef: null,
    handoffId: null,
    syntheticCore: true,
    ...extra,
  };
  if (payload.purpose === "opening") {
    delete payload.userMessageId;
  }
  return {
    v: 1,
    kind: "request",
    id: `req_${hex(100 + seq)}`,
    replyTo: null,
    workspaceId: `ws_${hex(1)}`,
    runId: `run_${hex(200 + seq)}`,
    method: "run.start",
    deadlineUnixMs: now + 60_000,
    error: null,
    payload,
  };
}

async function waitFor(frames: Frame[], predicate: (frame: Frame) => boolean): Promise<Frame> {
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    const found = frames.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`timed out waiting for frame; saw ${frames.map((frame) => `${frame.method}:${frame.kind}:${frame.error?.code ?? frame.payload.contextPolicy ?? ""}`).join(",")}`);
}

test("opening run.start omits userMessageId and conversation still requires one", () => {
  const authorization = {
    runId: `run_${hex(1)}`,
    provider: "hark-byok",
    model: "local-model",
    rootId: `root_${hex(2)}`,
    rootUpdatedAt: "root-v1",
    grantUpdatedAt: "grant-v1",
    directoryStatus: "active",
    modelGrantStatus: "active",
    current: true,
  };
  const base = {
    provider: "hark-byok",
    model: "local-model",
    authorization,
    contextSnapshot: { contextPackRevision: "rev", sourceVersion: "src", empty: true },
    userText: "internal first read",
    sessionRef: null,
    handoffId: null,
  };
  assert.equal(runStartPayloadSchema.safeParse({ ...base, purpose: "opening" }).success, true);
  assert.equal(
    runStartPayloadSchema.safeParse({ ...base, purpose: "opening", userMessageId: `msg_${hex(3)}` }).success,
    false,
  );
  assert.equal(runStartPayloadSchema.safeParse({ ...base, purpose: "conversation" }).success, false);
  assert.equal(
    runStartPayloadSchema.safeParse({ ...base, purpose: "conversation", userMessageId: `msg_${hex(3)}` }).success,
    true,
  );
});

test("credential path deny does not wrap ordinary files", () => {
  assert.equal(isClosedCredentialPath("/tmp/application_default_credentials.json"), true);
  assert.equal(isClosedCredentialPath("/Users/v/personal-vault/note.md"), true);
  installCredentialPathDeny();
  const dir = mkdtempSync(path.join(tmpdir(), "hark-cred-"));
  const file = path.join(dir, "note.txt");
  writeFileSync(file, "ok");
  assert.equal(readFileSync(file, "utf8"), "ok");
  rmSync(dir, { recursive: true, force: true });
});

test("closed provider slot does not send and does not accept a model-filled grant", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hark-host-"));
  const harness = startHarness({ dir, config: provider(false, false) });
  harness.input.write(encodeFrame(runStart(1)));
  const error = await waitFor(harness.frames, (frame) => frame.kind === "error" && frame.method === "error");
  assert.equal(error.error?.code, "model_not_authorized");
  assert.equal(harness.fetches.length, 0);
  assert.equal(harness.logs.join("\n").includes(KEY), false);
  await harness.close();
  rmSync(dir, { recursive: true, force: true });
});

test("each SDK request reaches the review dispatch, including a new request after a file read", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hark-host-review-"));
  const snapshots: OutboundRequestSnapshot[] = [];
  const harness = startHarness({ dir, reviewedDispatch: async (snapshot, run, signal) => {
    assert.equal(run.workspaceId, `ws_${hex(1)}`);
    assert.equal(run.runId, `run_${hex(211)}`);
    assert.equal(signal.aborted, false);
    snapshots.push(snapshot);
    if (snapshots.length === 1) {
      return new Response(sseToolCall("workspace.read_file", { relativePath: "README.md" }), { headers: { "content-type": "text/event-stream" } });
    }
    throw new Error("second request requires approval");
  } });
  try {
    harness.input.write(encodeFrame(runStart(11)));
    const error = await waitFor(harness.frames, (frame) => frame.kind === "error" && frame.runId === `run_${hex(211)}`);
    assert.equal(error.error?.code, "model_not_authorized");
    assert.equal(snapshots.length, 2);
    assert.notEqual(snapshots[0]?.bodySha256, snapshots[1]?.bodySha256);
    assert.equal(snapshots[0]?.body.includes("SYNTHETIC_FILE"), false);
    assert.equal(snapshots[1]?.body.includes("SYNTHETIC_FILE"), true);
    assert.equal(JSON.stringify(snapshots).includes(KEY), false);
    assert.equal(harness.fetches.length, 0);
    assert.equal(harness.frames.some((frame) => frame.method === "stream.done"), false);
  } finally {
    await harness.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stream, reverse tool, cancel, and mismatched grant stay local", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hark-host-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("global fetch escaped");
  }) as typeof fetch;
  try {
    const harness = startHarness({ dir, responses: ["tool", "text"] });
    harness.input.write(encodeFrame(runStart(1, { purpose: "opening" })));
    const done = await waitFor(harness.frames, (frame) => frame.method === "stream.done");
    const methods = harness.frames.map((frame) => frame.method);
    assert.equal(methods.includes("tool.request"), true);
    assert.ok(methods.indexOf("tool.request") < methods.indexOf("stream.done"));
    assert.equal(done.payload.committedByHost, false);
    assert.equal(done.payload.coreCommitRequired, true);
    const body = harness.host.payloads.join("\n");
    assert.equal(body.includes("workspace.read_file"), true);
    assert.equal(body.includes("workspace.overview"), true);
    assert.equal(body.includes("\"read\""), false);
    assert.equal(body.includes("workspaceId"), false);
    assert.equal(body.includes(KEY), false);
    assert.equal(harness.fetches.every((item) => item.url === "http://127.0.0.1:9/v1/chat/completions"), true);
    assert.equal(harness.fetches.some((item) => item.auth === `Bearer ${KEY}`), true);
    const stdout = JSON.stringify(harness.frames);
    assert.equal(stdout.includes(KEY), false);
    await harness.close();
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("authorization mismatch and hook failure do not send an old pack", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hark-host-"));
  const mismatch = startHarness({ dir, auth: { current: false } });
  mismatch.input.write(encodeFrame(runStart(2)));
  const refused = await waitFor(mismatch.frames, (frame) => frame.kind === "error");
  assert.equal(refused.error?.code, "model_not_authorized");
  assert.equal(mismatch.fetches.length, 0);
  await mismatch.close();

  const failed = startHarness({ dir, failPack: () => true });
  failed.input.write(encodeFrame(runStart(3)));
  await waitFor(failed.frames, (frame) => frame.kind === "error");
  assert.equal(failed.fetches.length, 0);
  await failed.close();

  let throwHook = false;
  const hooked = startHarness({
    dir,
    hookShouldThrow: () => throwHook,
    auth: { revision: "rev-b", sourceVersion: "src-b", overviewText: "CURRENT-B" },
  });
  hooked.input.write(encodeFrame(runStart(4)));
  await waitFor(hooked.frames, (frame) => frame.method === "stream.done");
  throwHook = true;
  hooked.input.write(encodeFrame(runStart(5, { sessionRef: hooked.frames.find((frame) => frame.method === "run.start" && frame.kind === "response")?.payload.sessionRef })));
  await waitFor(hooked.frames, (frame) => frame.method === "stream.done" && frame.runId === `run_${hex(205)}`);
  const last = hooked.host.payloads.at(-1) ?? "";
  assert.equal(last.includes("revision: rev-b"), true);
  assert.equal(last.includes("CURRENT-B"), true);
  assert.equal(last.includes("revision: rev-a"), false);
  await hooked.close();
  rmSync(dir, { recursive: true, force: true });
});

test("ten turns, snapshot change, compaction fallback, resume, and handoff dedup", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hark-host-ctx-"));
  const harness = startHarness({ dir });
  harness.input.write(encodeFrame(runStart(1)));
  const first = await waitFor(harness.frames, (frame) => frame.kind === "response" && frame.method === "run.start");
  const sessionRef = first.payload.sessionRef;
  assert.equal(typeof sessionRef, "string");
  for (let seq = 2; seq <= 10; seq += 1) {
    harness.input.write(encodeFrame(runStart(seq, { sessionRef })));
    await waitFor(harness.frames, (frame) => frame.method === "stream.done" && frame.runId === `run_${hex(200 + seq)}`);
  }
  const sessionDir = path.join(dir, "sessions", `ws_${hex(1)}`);
  const jsonl = readdirSync(sessionDir).find((name) => name.endsWith(".jsonl"));
  assert.ok(jsonl);
  const before = readFileSync(path.join(sessionDir, jsonl), "utf8");
  assert.equal(before.split("user-turn-").length - 1, 10);
  assert.equal(before.includes("rev-a"), false);
  assert.equal(harness.host.payloads.every((body) => body.includes("revision: rev-a")), true);

  harness.auth.revision = "rev-b";
  harness.auth.sourceVersion = "src-b";
  harness.auth.overviewText = "CURRENT-B";
  harness.input.write(encodeFrame(runStart(11, {
    sessionRef,
    contextSnapshot: { contextPackRevision: "rev-b", sourceVersion: "src-b", empty: true },
  })));
  await waitFor(harness.frames, (frame) => frame.method === "stream.done" && frame.runId === `run_${hex(211)}`);
  assert.equal(harness.host.payloads.at(-1)?.includes("revision: rev-b"), true);

  await harness.close();
  const restored = startHarness({ dir });
  restored.input.write(encodeFrame(runStart(12, { sessionRef, userText: "user-turn-restored" })));
  await waitFor(restored.frames, (frame) => frame.method === "stream.done" && frame.runId === `run_${hex(212)}`);
  const originalEntries = readFileSync(path.join(sessionDir, jsonl), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } });
  const textOf = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : "")).join("");
    }
    return "";
  };
  const userTexts = originalEntries.filter((entry) => entry.type === "message" && entry.message?.role === "user").map((entry) => textOf(entry.message?.content));
  assert.equal(userTexts.filter((text) => text === "user-turn-1").length, 1);
  assert.equal(userTexts.filter((text) => text === "user-turn-restored").length, 1);
  assert.equal(JSON.stringify(userTexts).includes("rev-b"), false);

  const manager = SessionManager.open(path.join(sessionDir, jsonl), sessionDir);
  const kept = manager.getBranch().find((entry) => entry.type === "message");
  manager.appendCompaction("OLD_OPINION_STALE", kept && "id" in kept ? kept.id : null, 10);
  const recent = Array.from({ length: 8 }, (_, index) => ({
    messageId: `msg_${hex(800 + index)}`,
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    text: `handoff-${index}`,
    createdAtUnixMs: 1_700_000_000_000 + index,
  }));
  restored.auth.revision = "rev-c";
  restored.auth.sourceVersion = "src-c";
  restored.auth.overviewText = "CURRENT-C";
  restored.input.write(encodeFrame(runStart(13, {
    sessionRef,
    handoffId: "handoff-1",
    recentMessages: recent,
    contextSnapshot: { contextPackRevision: "rev-c", sourceVersion: "src-c", empty: true },
  })));
  const fallback = await waitFor(restored.frames, (frame) => frame.kind === "response" && frame.payload.contextPolicy === "new-session-compaction-fallback");
  await waitFor(restored.frames, (frame) => frame.method === "stream.done" && frame.runId === `run_${hex(213)}`);
  const payload = restored.host.payloads.at(-1) ?? "";
  assert.equal(payload.includes("OLD_OPINION_STALE"), false);
  assert.equal(payload.includes("revision: rev-c"), true);
  assert.equal(payload.includes("CURRENT-C"), true);
  assert.equal(payload.includes("handoff-0"), true);
  assert.equal(payload.includes("handoff-7"), true);
  const files = readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"));
  const newest = files.map((name) => ({ name, text: readFileSync(path.join(sessionDir, name), "utf8") })).find((item) => item.text.includes("handoff-0"));
  assert.ok(newest);
  assert.equal(newest.text.split("handoff-0").length - 1, 1);
  assert.equal(COMPACTION_SUMMARY_PREFIX.includes("compacted into the following summary"), true);

  const again = SessionManager.open(path.join(sessionDir, newest.name), sessionDir);
  const keptAgain = again.getBranch().find((entry) => entry.type === "message");
  again.appendCompaction("SECOND_STALE", keptAgain && "id" in keptAgain ? keptAgain.id : null, 4);
  restored.input.write(encodeFrame(runStart(14, {
    sessionRef: fallback.payload.sessionRef,
    handoffId: "handoff-1",
    recentMessages: recent,
    contextSnapshot: { contextPackRevision: "rev-c", sourceVersion: "src-c", empty: true },
  })));
  await waitFor(restored.frames, (frame) => frame.method === "stream.done" && frame.runId === `run_${hex(214)}`);
  const deduped = readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl")).map((name) => readFileSync(path.join(sessionDir, name), "utf8"));
  assert.equal(deduped.filter((text) => text.includes("handoff-0")).length, 2);
  assert.equal(deduped.every((text) => text.split("handoff-0").length - 1 <= 1), true);
  assert.equal(deduped.some((text) => text.includes("SECOND_STALE") && text.includes("handoff-0") && text.split("handoff-0").length > 2), false);
  await restored.close();
  rmSync(dir, { recursive: true, force: true });
});

function runStartFor(seq: number, workspace: number, extra: Record<string, unknown> = {}): Frame {
  const frame = runStart(seq, extra);
  frame.workspaceId = `ws_${hex(workspace)}`;
  return frame;
}

test("a second workspace run is busy and cannot replace the active gate", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hark-host-busy-"));
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: Frame[] = [];
  const parser = new NdjsonParser();
  const host = new HostRuntime({
    appDataDir: dir,
    input,
    output,
    providerConfig: provider(),
    scriptedTransport: {
      responses: [
        { kind: "hold", untilAbort: true },
        { kind: "text", text: "synthetic-b-reply" },
      ],
    },
    log: () => {},
  });
  output.on("data", (chunk: Buffer) => {
    for (const frame of parser.push(chunk)) {
      frames.push(frame);
      if (frame.method === "host.ready" && frame.kind === "request") {
        input.write(encodeFrame({ ...frame, kind: "response", replyTo: frame.id, payload: { synthetic: true } }));
      }
      if (frame.method === "tool.request" && frame.kind === "request") {
        const canary = frame.runId === `run_${hex(201)}` ? "CANARY-A" : "CANARY-B";
        const rootUpdatedAt = frame.runId === `run_${hex(201)}` ? "root-v1" : "root-b";
        input.write(encodeFrame({
          ...frame,
          kind: "response",
          replyTo: frame.id,
          method: "tool.result",
          payload: frame.payload.tool === "workspace.read_file"
            ? { relativePath: "README.md", text: "SYNTHETIC_FILE", synthetic: true }
            : {
                authorization: {
                  runId: frame.runId,
                  provider: "hark-byok",
                  model: "local-model",
                  rootId: `root_${hex(3)}`,
                  rootUpdatedAt,
                  grantUpdatedAt: "grant-v1",
                  directoryStatus: "active",
                  modelGrantStatus: "active",
                  current: true,
                },
                sourceVersion: canary === "CANARY-A" ? "src-a" : "src-b",
                contextPackRevision: canary === "CANARY-A" ? "rev-a" : "rev-b",
                overviewText: canary,
                synthetic: true,
              },
        }));
      }
    }
  });
  void host.start();
  const runA = runStartFor(1, 1, {
    contextSnapshot: { contextPackRevision: "rev-a", sourceVersion: "src-a", empty: false, identity: "CANARY-A", overview: "CANARY-A" },
  });
  const runB = runStartFor(2, 2, {
    contextSnapshot: { contextPackRevision: "rev-b", sourceVersion: "src-b", empty: false, identity: "CANARY-B", overview: "CANARY-B" },
    authorization: {
      runId: `run_${hex(202)}`,
      provider: "hark-byok",
      model: "local-model",
      rootId: `root_${hex(3)}`,
      rootUpdatedAt: "root-b",
      grantUpdatedAt: "grant-v1",
      directoryStatus: "active",
      modelGrantStatus: "active",
      current: true,
    },
  });
  input.write(Buffer.concat([encodeFrame(runA), encodeFrame(runB)]));
  const busy = await waitFor(frames, (frame) => frame.kind === "error" && frame.replyTo === runB.id);
  assert.equal(busy.error?.code, "correlation_rejected");
  assert.equal(busy.error?.message.includes("busy"), true);
  assert.equal(frames.some((frame) => frame.method === "tool.request" && frame.workspaceId === runB.workspaceId), false);
  const accepted = await waitFor(frames, (frame) => frame.kind === "response" && frame.method === "run.start" && frame.runId === runA.runId);
  assert.equal(accepted.payload.accepted, true);
  await waitFor(frames, (frame) => frame.method === "tool.request" && frame.runId === runA.runId);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(host.payloads.some((body) => body.includes("CANARY-B")), false);
  input.write(encodeFrame({
    v: 1,
    kind: "request",
    id: `req_${hex(90)}`,
    replyTo: null,
    workspaceId: runA.workspaceId,
    runId: runA.runId,
    method: "run.cancel",
    deadlineUnixMs: Date.now() + 20_000,
    payload: { targetRequestId: runA.id },
    error: null,
  }));
  await waitFor(frames, (frame) => frame.kind === "error" && frame.replyTo === runA.id);
  const retry = runStartFor(4, 2, {
    contextSnapshot: { contextPackRevision: "rev-b", sourceVersion: "src-b", empty: false, identity: "CANARY-B", overview: "CANARY-B" },
    authorization: {
      runId: `run_${hex(204)}`,
      provider: "hark-byok",
      model: "local-model",
      rootId: `root_${hex(3)}`,
      rootUpdatedAt: "root-b",
      grantUpdatedAt: "grant-v1",
      directoryStatus: "active",
      modelGrantStatus: "active",
      current: true,
    },
  });
  input.write(encodeFrame(retry));
  await waitFor(frames, (frame) => frame.method === "stream.done" && frame.runId === retry.runId);
  const last = host.payloads.at(-1) ?? "";
  assert.equal(last.includes("CANARY-B"), true);
  assert.equal(last.includes("CANARY-A"), false);
  input.end();
  rmSync(dir, { recursive: true, force: true });
});

test("a changed revision without a new body does not send the old canary", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hark-host-pack-"));
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: Frame[] = [];
  const parser = new NdjsonParser();
  let fetches = 0;
  const host = new HostRuntime({
    appDataDir: dir,
    input,
    output,
    providerConfig: provider(),
    fetchImpl: async () => {
      fetches += 1;
      return new Response(sseText("synthetic-should-not-send"), { status: 200, headers: { "content-type": "text/event-stream" } });
    },
    log: () => {},
  });
  output.on("data", (chunk: Buffer) => {
    for (const frame of parser.push(chunk)) {
      frames.push(frame);
      if (frame.method === "host.ready" && frame.kind === "request") {
        input.write(encodeFrame({ ...frame, kind: "response", replyTo: frame.id, payload: { synthetic: true } }));
      }
      if (frame.method === "tool.request" && frame.kind === "request") {
        input.write(encodeFrame({
          ...frame,
          kind: "response",
          replyTo: frame.id,
          method: "tool.result",
          payload: {
            authorization: {
              runId: frame.runId,
              provider: "hark-byok",
              model: "local-model",
              rootId: `root_${hex(3)}`,
              rootUpdatedAt: "root-v1",
              grantUpdatedAt: "grant-v1",
              directoryStatus: "active",
              modelGrantStatus: "active",
              current: true,
            },
            sourceVersion: "src-new",
            contextPackRevision: "rev-new",
            overviewText: null,
            synthetic: true,
          },
        }));
      }
    }
  });
  void host.start();
  input.write(encodeFrame(runStart(1, {
    contextSnapshot: {
      contextPackRevision: "rev-old",
      sourceVersion: "src-old",
      empty: false,
      identity: "CANARY-OLD-IDENTITY",
      overview: "CANARY-OLD-OVERVIEW",
    },
  })));
  const refused = await waitFor(frames, (frame) => frame.kind === "error" && frame.runId === `run_${hex(201)}`);
  assert.equal(refused.error?.code, "model_not_authorized");
  assert.equal(fetches, 0);
  assert.equal(host.payloads.join("\n").includes("CANARY-OLD"), false);
  assert.equal(host.payloads.join("\n").includes("rev-old"), false);
  input.end();
  rmSync(dir, { recursive: true, force: true });
});

test("new sessions get one target handoff; resume and another new session stay distinct", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hark-host-handoff-"));
  const harness = startHarness({ dir });
  const recent = [{
    messageId: `msg_${hex(810)}`,
    role: "user" as const,
    text: "RECENT-FIRST",
    createdAtUnixMs: 1_700_000_000_000,
  }];
  harness.input.write(encodeFrame(runStart(1, { handoffId: "handoff-shared", recentMessages: recent })));
  const created = await waitFor(harness.frames, (frame) => frame.kind === "response" && frame.method === "run.start" && frame.runId === `run_${hex(201)}`);
  await waitFor(harness.frames, (frame) => frame.method === "stream.done" && frame.runId === `run_${hex(201)}`);
  assert.equal(created.payload.handoffApplied, true);
  assert.equal(created.payload.resumed, false);
  const sessionRef = created.payload.sessionRef;
  assert.equal(typeof sessionRef, "string");
  const sessionDir = path.join(dir, "sessions", `ws_${hex(1)}`);
  const textOfFile = (name: string) => readFileSync(path.join(sessionDir, name), "utf8");
  const countRecent = (needle: string) => readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl")).map(textOfFile).reduce((sum, text) => sum + text.split(needle).length - 1, 0);
  assert.equal(countRecent("RECENT-FIRST"), 1);

  harness.input.write(encodeFrame(runStart(2, { sessionRef, handoffId: "handoff-shared", recentMessages: recent })));
  const replay = await waitFor(harness.frames, (frame) => frame.kind === "response" && frame.method === "run.start" && frame.runId === `run_${hex(202)}`);
  await waitFor(harness.frames, (frame) => frame.method === "stream.done" && frame.runId === `run_${hex(202)}`);
  assert.equal(replay.payload.handoffApplied, false);
  assert.equal(replay.payload.resumed, true);
  assert.equal(replay.payload.sessionRef, sessionRef);
  assert.equal(countRecent("RECENT-FIRST"), 1);

  const currentFile = readdirSync(sessionDir).find((name) => name.endsWith(".jsonl") && textOfFile(name).includes("RECENT-FIRST"));
  assert.ok(currentFile);
  const manager = SessionManager.open(path.join(sessionDir, currentFile), sessionDir);
  const kept = manager.getBranch().find((entry) => entry.type === "message");
  manager.appendCompaction("OLD_SUMMARY_NOT_CURRENT", kept && "id" in kept ? kept.id : null, 2);
  const later = [{
    messageId: `msg_${hex(811)}`,
    role: "user" as const,
    text: "RECENT-NEXT-SESSION",
    createdAtUnixMs: 1_700_000_000_100,
  }];
  harness.input.write(encodeFrame(runStart(3, {
    sessionRef,
    handoffId: "handoff-shared",
    recentMessages: later,
  })));
  const next = await waitFor(harness.frames, (frame) => frame.kind === "response" && frame.method === "run.start" && frame.runId === `run_${hex(203)}`);
  await waitFor(harness.frames, (frame) => frame.method === "stream.done" && frame.runId === `run_${hex(203)}`);
  assert.equal(next.payload.handoffApplied, true);
  assert.equal(next.payload.resumed, false);
  assert.notEqual(next.payload.sessionRef, sessionRef);
  assert.equal(countRecent("RECENT-FIRST"), 1);
  assert.equal(countRecent("RECENT-NEXT-SESSION"), 1);
  const files = readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl")).map(textOfFile);
  assert.equal(files.some((text) => text.includes("OLD_SUMMARY_NOT_CURRENT") && text.includes("RECENT-NEXT-SESSION")), false);
  await harness.close();
  rmSync(dir, { recursive: true, force: true });
});

test("explicit stepfun slot keeps its id and refuses a non-configured target", async () => {
  const slot = {
    enabled: true,
    providerId: "stepfun",
    modelId: "step-synthetic",
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: KEY,
    wire: "openai-completions" as const,
    allowRemote: true,
  };
  const loaded = loadProviderConfig(slot);
  assert.equal(loaded.providerId, "stepfun");
  assert.equal(loaded.modelId, "step-synthetic");
  assert.throws(() => loadProviderConfig({ ...slot, providerId: "faux", modelId: "faux-model" }), /faux/);
  assert.throws(() => loadProviderConfig({ ...slot, enabled: true, providerId: "stepfun", stepFunCompatible: true }), /stepFunCompatible|invalid|Unrecognized|Expected/);
  const closed = loadProviderConfig({ ...slot, enabled: false, allowRemote: false });
  assert.equal(closed.enabled, false);
  assert.equal(closed.providerId, "stepfun");

  let calls = 0;
  const guarded = createGuardedFetch({
    config: loaded,
    secrets: [KEY],
    fetchImpl: async (input, init) => {
      calls += 1;
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      assert.equal(url, "http://127.0.0.1:9/v1/chat/completions");
      assert.equal(init?.redirect, "error");
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:9/elsewhere" } });
    },
  });
  await assert.rejects(() => guarded("http://127.0.0.1:9/elsewhere", { redirect: "follow" }));
  await assert.rejects(() => guarded("https://api.stepfun.com/v1/chat/completions"));
  const redirected = await guarded("http://127.0.0.1:9/v1/chat/completions", { redirect: "follow" });
  assert.equal(redirected.status, 302);
  assert.equal(calls, 1);

  const dir = mkdtempSync(path.join(tmpdir(), "hark-host-stepfun-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("global fetch escaped");
  }) as typeof fetch;
  try {
    const harness = startHarness({
      dir,
      config: { ...slot, apiKey: KEY },
    });
    harness.input.write(encodeFrame(runStart(7, {
      provider: "stepfun",
      model: "step-synthetic",
      authorization: {
        runId: `run_${hex(207)}`,
        provider: "stepfun",
        model: "step-synthetic",
        rootId: `root_${hex(3)}`,
        rootUpdatedAt: "root-v1",
        grantUpdatedAt: "grant-v1",
        directoryStatus: "active",
        modelGrantStatus: "active",
        current: true,
      },
    })));
    // The shared harness answers overview with hark-byok. This negative path must still not dial out.
    const mismatched = await waitFor(harness.frames, (frame) => frame.kind === "error" && frame.runId === `run_${hex(207)}`);
    assert.equal(mismatched.error?.code, "model_not_authorized");
    assert.equal(harness.fetches.length, 0);
    await harness.close();

    const input = new PassThrough();
    const output = new PassThrough();
    const frames: Frame[] = [];
    const parser = new NdjsonParser();
    const host = new HostRuntime({
      appDataDir: dir,
      input,
      output,
      providerConfig: loaded,
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        harness.fetches.push({ url: String(url), body: String(init?.body ?? ""), auth: headers.get("authorization") ?? "" });
        assert.equal(init?.redirect, "error");
        return new Response(sseText("synthetic-stepfun-shape"), { status: 200, headers: { "content-type": "text/event-stream" } });
      },
      log: () => {},
    });
    output.on("data", (chunk: Buffer) => {
      for (const frame of parser.push(chunk)) {
        frames.push(frame);
        if (frame.method === "host.ready" && frame.kind === "request") {
          input.write(encodeFrame({ ...frame, kind: "response", replyTo: frame.id, payload: { synthetic: true } }));
        }
        if (frame.method === "tool.request" && frame.kind === "request") {
          input.write(encodeFrame({
            ...frame,
            kind: "response",
            replyTo: frame.id,
            method: "tool.result",
            payload: {
              authorization: {
                runId: frame.runId,
                provider: "stepfun",
                model: "step-synthetic",
                rootId: `root_${hex(3)}`,
                rootUpdatedAt: "root-v1",
                grantUpdatedAt: "grant-v1",
                directoryStatus: "active",
                modelGrantStatus: "active",
                current: true,
              },
              sourceVersion: "src-a",
              contextPackRevision: "rev-a",
              overviewText: "synthetic-overview",
              synthetic: true,
            },
          }));
        }
      }
    });
    void host.start();
    input.write(encodeFrame(runStart(8, {
      provider: "stepfun",
      model: "step-synthetic",
      authorization: {
        runId: `run_${hex(208)}`,
        provider: "stepfun",
        model: "step-synthetic",
        rootId: `root_${hex(3)}`,
        rootUpdatedAt: "root-v1",
        grantUpdatedAt: "grant-v1",
        directoryStatus: "active",
        modelGrantStatus: "active",
        current: true,
      },
    })));
    await waitFor(frames, (frame) => frame.method === "stream.done" && frame.runId === `run_${hex(208)}`);
    assert.equal(harness.fetches.length, 1);
    const call = harness.fetches[0];
    assert.equal(call?.url, "http://127.0.0.1:9/v1/chat/completions");
    assert.equal(call?.auth, `Bearer ${KEY}`);
    const body = JSON.parse(call?.body ?? "{}") as { model?: string; messages?: unknown[] };
    assert.equal(body.model, "step-synthetic");
    assert.equal(Array.isArray(body.messages), true);
    assert.equal(JSON.stringify(frames).includes(KEY), false);
    assert.equal(host.payloads.some((payload) => payload.includes("\"provider\":\"stepfun\"") || payload.includes("step-synthetic")), true);
    input.end();
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stdin EOF aborts an in-flight run without a stream busy-loop", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hark-host-eof-"));
  const input = new PassThrough();
  const chunks: Buffer[] = [];
  const held: Array<(error?: Error | null) => void> = [];
  let blockNext = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      if (blockNext) {
        held.push(callback);
        return;
      }
      callback();
    },
  });
  const frames: Frame[] = [];
  const parser = new NdjsonParser();
  let scriptCalls = 0;
  const host = new HostRuntime({
    appDataDir: dir,
    input,
    output,
    providerConfig: provider(),
    scriptedTransport: {
      responses: [{ kind: "hold", untilAbort: true }, { kind: "text", text: "should-not-run" }],
    },
    log: () => {},
  });
  const consume = () => {
    for (const chunk of chunks.splice(0)) {
      for (const frame of parser.push(chunk)) {
        frames.push(frame);
        if (frame.method === "host.ready" && frame.kind === "request") {
          input.write(encodeFrame({ ...frame, kind: "response", replyTo: frame.id, payload: { synthetic: true } }));
        }
        if (frame.method === "tool.request" && frame.kind === "request") {
          blockNext = true;
          input.write(encodeFrame({
            ...frame,
            kind: "response",
            replyTo: frame.id,
            method: "tool.result",
            payload: {
              authorization: {
                runId: frame.runId,
                provider: "hark-byok",
                model: "local-model",
                rootId: `root_${hex(3)}`,
                rootUpdatedAt: "root-v1",
                grantUpdatedAt: "grant-v1",
                directoryStatus: "active",
                modelGrantStatus: "active",
                current: true,
              },
              sourceVersion: "src-a",
              contextPackRevision: "rev-a",
              overviewText: "overview-a",
              synthetic: true,
            },
          }));
        }
      }
    }
  };
  output.on("error", () => {});
  void host.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  consume();
  input.write(encodeFrame(runStart(1, { userText: "hold-me" })));
  const started = Date.now();
  while (!frames.some((frame) => frame.method === "tool.request") && Date.now() - started < 10_000) {
    await new Promise((resolve) => setTimeout(resolve, 15));
    consume();
  }
  assert.equal(frames.some((frame) => frame.method === "tool.request"), true);
  scriptCalls = host.fetchCount.n;
  input.end();
  const spun = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(true), 400);
    setImmediate(() => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  assert.equal(spun, false);
  const closed = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      clearInterval(interval);
      resolve(false);
    }, 1_500);
    const look = () => {
      consume();
      if (frames.some((frame) => frame.kind === "error" && frame.replyTo === `req_${hex(101)}`)) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve(true);
      }
    };
    const interval = setInterval(look, 20);
    look();
  });
  assert.equal(closed, true);
  assert.equal(frames.some((frame) => frame.method === "stream.done" && frame.payload.finish === "stop"), false);
  assert.equal(host.fetchCount.n, scriptCalls);
  for (const callback of held) callback();
  rmSync(dir, { recursive: true, force: true });
});
