import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFrame, IpcError, IPC_LIMITS, mintId, NdjsonParser, SideQueues, type Frame } from "../src/ipc.ts";

const KEY = "synthetic-key-do-not-log";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function hex(n: number): string {
  return n.toString(16).padStart(32, "0");
}

function checkQueues(): void {
  const queues = new SideQueues();
  for (let i = 0; i < IPC_LIMITS.maxStreamQueue; i += 1) {
    queues.tryPush({
      v: 1,
      kind: "event",
      id: mintId("evt"),
      replyTo: null,
      workspaceId: null,
      runId: null,
      method: "stream.delta",
      deadlineUnixMs: null,
      payload: { text: "x" },
      error: null,
    });
  }
  assert.throws(() => queues.tryPush({
    v: 1,
    kind: "event",
    id: mintId("evt"),
    replyTo: null,
    workspaceId: null,
    runId: null,
    method: "stream.done",
    deadlineUnixMs: null,
    payload: {},
    error: null,
  }), (error: unknown) => error instanceof IpcError && error.code === "queue_overflow");
  queues.tryPush({
    v: 1,
    kind: "request",
    id: mintId("req"),
    replyTo: null,
    workspaceId: null,
    runId: null,
    method: "tool.request",
    deadlineUnixMs: null,
    payload: {},
    error: null,
  });
  assert.equal(queues.pop()?.method, "tool.request");
}

function frame(partial: Partial<Frame> & Pick<Frame, "kind" | "id" | "method">): Frame {
  return {
    v: 1,
    kind: partial.kind,
    id: partial.id,
    replyTo: partial.replyTo ?? null,
    workspaceId: partial.workspaceId ?? null,
    runId: partial.runId ?? null,
    method: partial.method,
    deadlineUnixMs: partial.deadlineUnixMs ?? null,
    payload: partial.payload ?? {},
    error: partial.error ?? null,
  };
}

async function probe(): Promise<void> {
  checkQueues();
  const dir = mkdtempSync(path.join(tmpdir(), "hark-stdio-probe-"));
  const providerPath = path.join(dir, "provider.json");
  const scriptPath = path.join(dir, "script.json");
  writeFileSync(providerPath, JSON.stringify({
    enabled: true,
    providerId: "hark-byok",
    modelId: "local-model",
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: KEY,
    wire: "openai-completions",
    allowRemote: false,
    stepFunCompatible: false,
  }));
  writeFileSync(scriptPath, JSON.stringify({
    responses: [
      { kind: "tool_call", name: "workspace.read_file", arguments: { relativePath: "README.md" } },
      { kind: "text", text: "synthetic-stdio-reply" },
      { kind: "hold", untilAbort: true },
    ],
  }));
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    path.join(root, "src/sidecar.ts"),
    "--app-data",
    dir,
    "--provider-config",
    providerPath,
    "--scripted-transport",
    scriptPath,
  ], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.on("error", () => {
    // The child may already have exited after a fail-closed frame.
  });
  child.stdout.on("error", () => {
    // Shutdown may destroy a blocked pipe. That is not a probe failure by itself.
  });
  child.on("error", (error) => {
    stderr += error.message;
  });
  const parser = new NdjsonParser();
  const frames: Frame[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    const parsed = parser.push(chunk);
    for (const item of parsed) {
      frames.push(item);
      if (item.method === "host.ready" && item.kind === "request") {
        child.stdin.write(encodeFrame({ ...item, kind: "response", replyTo: item.id, payload: { synthetic: true } }));
      }
      if (item.method === "tool.request" && item.kind === "request") {
        const tool = item.payload.tool;
        const payload = tool === "workspace.read_file"
          ? { relativePath: "README.md", text: "SYNTHETIC_FILE", synthetic: true }
          : {
              authorization: {
                runId: item.runId,
                provider: "hark-byok",
                model: "local-model",
                rootId: `root_${hex(3)}`,
                rootUpdatedAt: "root-v1",
                grantUpdatedAt: "grant-v1",
                directoryStatus: "active",
                modelGrantStatus: "active",
                current: true,
              },
              contextPackRevision: "rev-probe",
              sourceVersion: "src-probe",
              overviewText: "synthetic overview",
              synthetic: true,
            };
        child.stdin.write(encodeFrame({ ...item, kind: "response", replyTo: item.id, method: "tool.result", payload }));
      }
    }
  });
  const ready = await waitFor(frames, (item) => item.method === "host.ready");
  assert.equal(ready.workspaceId, null);
  const start = frame({
    kind: "request",
    id: `req_${hex(9)}`,
    method: "run.start",
    workspaceId: `ws_${hex(1)}`,
    runId: `run_${hex(2)}`,
    deadlineUnixMs: Date.now() + 30_000,
    payload: {
      provider: "hark-byok",
      model: "local-model",
      purpose: "conversation",
      authorization: {
        runId: `run_${hex(2)}`,
        provider: "hark-byok",
        model: "local-model",
        rootId: `root_${hex(3)}`,
        rootUpdatedAt: "root-v1",
        grantUpdatedAt: "grant-v1",
        directoryStatus: "active",
        modelGrantStatus: "active",
        current: true,
      },
      contextSnapshot: { contextPackRevision: "rev-probe", sourceVersion: "src-probe", empty: true },
      userText: "probe-user",
      userMessageId: `msg_${hex(4)}`,
      sessionRef: null,
      handoffId: null,
      syntheticCore: true,
    },
  });
  child.stdin.write(encodeFrame(start));
  const done = await waitFor(frames, (item) => item.method === "stream.done");
  assert.equal(done.payload.committedByHost, false);
  assert.equal(frames.some((item) => item.method === "tool.request" && item.payload.tool === "workspace.read_file"), true);
  assert.equal(frames.some((item) => item.method === "stream.delta"), true);
  const stdoutText = JSON.stringify(frames);
  assert.equal(stdoutText.includes(KEY), false);
  assert.equal(stderr.includes(KEY), false);

  const cancelStart = frame({
    kind: "request",
    id: `req_${hex(10)}`,
    method: "run.start",
    workspaceId: `ws_${hex(8)}`,
    runId: `run_${hex(11)}`,
    deadlineUnixMs: Date.now() + 20_000,
    payload: {
      ...start.payload,
      authorization: { ...(start.payload.authorization as object), runId: `run_${hex(11)}` },
      userText: "cancel-me",
      userMessageId: `msg_${hex(12)}`,
    },
  });
  child.stdin.write(encodeFrame(cancelStart));
  await waitFor(frames, (item) => item.method === "tool.request" && item.runId === cancelStart.runId);
  child.stdin.write(encodeFrame(frame({
    kind: "request",
    id: `req_${hex(13)}`,
    method: "run.cancel",
    workspaceId: cancelStart.workspaceId,
    runId: cancelStart.runId,
    payload: { targetRequestId: cancelStart.id },
  })));
  child.stdin.write(encodeFrame(frame({
    kind: "response",
    id: `req_${hex(14)}`,
    method: "tool.result",
    replyTo: `req_${hex(14)}`,
    workspaceId: `ws_${hex(99)}`,
    runId: cancelStart.runId,
    payload: { late: true },
  })));
  const cancelled = await waitFor(frames, (item) => item.kind === "error" && item.replyTo === cancelStart.id);
  assert.equal(cancelled.error?.code === "cancelled" || cancelled.error?.code === "timeout" || cancelled.error?.code === "model_not_authorized", true);
  assert.equal(frames.some((item) => item.method === "stream.done" && item.runId === cancelStart.runId && item.payload.finish === "stop"), false);

  child.stdin.write(Buffer.from("{not-a-frame}\n"));
  const invalid = await waitFor(frames, (item) => item.error?.code === "invalid_frame" || item.error?.code === "frame_too_large");
  assert.ok(invalid);
  child.stdin.write(Buffer.concat([Buffer.alloc(IPC_LIMITS.maxFrameBytes + 8, 0x61), Buffer.from("\n")]));
  child.stdin.end();
  const exit = await new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
  if (exit !== 0) {
    console.error(JSON.stringify({ exit, stderr: stderr.slice(0, 2000), methods: frames.map((item) => item.method) }));
  }
  assert.equal(stderr.includes(KEY), false);
  assert.equal(exit, 0);
  rmSync(dir, { recursive: true, force: true });
  await probeActiveClose("stdin-end");
  await probeActiveClose("stdout-blocked");
}

function spawnHost(dir: string, scriptPath: string, providerPath: string) {
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    path.join(root, "src/sidecar.ts"),
    "--app-data",
    dir,
    "--provider-config",
    providerPath,
    "--scripted-transport",
    scriptPath,
  ], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => {});
  child.stdout.on("error", () => {});
  child.stderr.on("error", () => {});
  return child;
}

async function probeActiveClose(mode: "stdin-end" | "stdout-blocked"): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), `hark-stdio-${mode}-`));
  const providerPath = path.join(dir, "provider.json");
  const scriptPath = path.join(dir, "script.json");
  writeFileSync(providerPath, JSON.stringify({
    enabled: true,
    providerId: "hark-byok",
    modelId: "local-model",
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: KEY,
    wire: "openai-completions",
    allowRemote: false,
    stepFunCompatible: false,
  }));
  writeFileSync(scriptPath, JSON.stringify({
    responses: [
      { kind: "hold", untilAbort: true },
      { kind: "text", text: "should-not-send-after-close" },
    ],
  }));
  const child = spawnHost(dir, scriptPath, providerPath);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const parser = new NdjsonParser();
  const frames: Frame[] = [];
  let paused = false;
  child.stdout.on("data", (chunk: Buffer) => {
    if (paused) return;
    const parsed = parser.push(chunk);
    for (const item of parsed) {
      frames.push(item);
      if (item.method === "host.ready" && item.kind === "request") {
        child.stdin.write(encodeFrame({ ...item, kind: "response", replyTo: item.id, payload: { synthetic: true } }));
      }
      if (item.method === "tool.request" && item.kind === "request") {
        child.stdin.write(encodeFrame({
          ...item,
          kind: "response",
          replyTo: item.id,
          method: "tool.result",
          payload: {
            authorization: {
              runId: item.runId,
              provider: "hark-byok",
              model: "local-model",
              rootId: `root_${hex(3)}`,
              rootUpdatedAt: "root-v1",
              grantUpdatedAt: "grant-v1",
              directoryStatus: "active",
              modelGrantStatus: "active",
              current: true,
            },
            contextPackRevision: "rev-probe",
            sourceVersion: "src-probe",
            overviewText: "synthetic overview",
            synthetic: true,
          },
        }));
      }
    }
  });
  const runId = `run_${hex(70)}`;
  const requestId = `req_${hex(71)}`;
  await waitFor(frames, (item) => item.method === "host.ready");
  child.stdin.write(encodeFrame(frame({
    kind: "request",
    id: requestId,
    method: "run.start",
    workspaceId: `ws_${hex(72)}`,
    runId,
    deadlineUnixMs: Date.now() + 20_000,
    payload: {
      provider: "hark-byok",
      model: "local-model",
      purpose: "conversation",
      authorization: {
        runId,
        provider: "hark-byok",
        model: "local-model",
        rootId: `root_${hex(3)}`,
        rootUpdatedAt: "root-v1",
        grantUpdatedAt: "grant-v1",
        directoryStatus: "active",
        modelGrantStatus: "active",
        current: true,
      },
      contextSnapshot: { contextPackRevision: "rev-probe", sourceVersion: "src-probe", empty: true },
      userText: "hold-active-run",
      userMessageId: `msg_${hex(73)}`,
      sessionRef: null,
      handoffId: null,
      syntheticCore: true,
    },
  })));
  await waitFor(frames, (item) => item.method === "tool.request" && item.runId === runId);
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (mode === "stdout-blocked") {
    paused = true;
    child.stdout.pause();
  }
  child.stdin.end();
  const exit = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 3_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  if (exit === null) {
    child.kill("SIGKILL");
    throw new Error(`${mode} left an active run alive`);
  }
  assert.equal(frames.some((item) => item.method === "stream.done" && item.runId === runId && item.payload.finish === "stop"), false);
  assert.equal(stderr.includes(KEY), false);
  assert.equal(exit, 0);
  rmSync(dir, { recursive: true, force: true });
}

function waitFor(frames: Frame[], predicate: (frame: Frame) => boolean): Promise<Frame> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const found = frames.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - start > 25_000) {
        clearInterval(timer);
        reject(new Error(`probe timeout; methods=${frames.map((item) => item.method).join(",")}`));
      }
    }, 20);
  });
}

probe().then(() => {
  console.log(JSON.stringify({ stdioProbe: "passed", queueBoundary: "unit-same-codec", activeClose: "stdin-end-and-paused-stdout", stepFun: "unverified", coreBridge: "not-connected" }));
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "probe failed");
  process.exit(1);
});
