import assert from "node:assert/strict";
import { test } from "node:test";
import { CorrelationGate, encodeFrame, IpcError, IPC_LIMITS, mintId, NdjsonParser, SideQueues, type Frame } from "../src/ipc.ts";

function frame(partial: Partial<Frame> & Pick<Frame, "kind" | "method">): Frame {
  const id = partial.id ?? (partial.kind === "event" ? mintId("evt") : partial.kind === "error" ? mintId("err") : mintId("req"));
  return {
    v: 1,
    kind: partial.kind,
    id,
    replyTo: partial.replyTo ?? null,
    workspaceId: partial.workspaceId ?? null,
    runId: partial.runId ?? null,
    method: partial.method,
    deadlineUnixMs: partial.deadlineUnixMs ?? null,
    payload: partial.payload ?? {},
    error: partial.error ?? null,
  };
}

test("queues keep stream overflow off the control path", () => {
  const queues = new SideQueues();
  for (let i = 0; i < IPC_LIMITS.maxStreamQueue; i += 1) {
    queues.tryPush(frame({ kind: "event", method: "stream.delta", id: mintId("evt") }));
  }
  assert.throws(() => queues.tryPush(frame({ kind: "event", method: "stream.delta" })), (error: unknown) => {
    return error instanceof IpcError && error.code === "queue_overflow";
  });
  queues.tryPush(frame({ kind: "request", method: "tool.request" }));
  assert.equal(queues.controlLen, 1);
  assert.equal(queues.pop()?.method, "tool.request");
});

test("correlation rejects cross-workspace, cross-run, duplicate, and late success", () => {
  const gate = new CorrelationGate();
  const now = 1_000;
  const request = frame({
    kind: "request",
    method: "run.start",
    id: "req_0123456789abcdef0123456789abcdef",
    workspaceId: "ws_0123456789abcdef0123456789abcdef",
    runId: "run_0123456789abcdef0123456789abcdef",
    deadlineUnixMs: now + 1000,
  });
  gate.registerRequest(request, now);
  assert.throws(() => gate.registerRequest(request, now), /duplicate/);
  const mismatch = frame({
    kind: "event",
    method: "stream.delta",
    replyTo: request.id,
    workspaceId: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runId: request.runId,
  });
  assert.throws(() => gate.accept(mismatch, now), (error: unknown) => error instanceof IpcError && error.code === "workspace_mismatch");
  const runMismatch = frame({
    kind: "event",
    method: "stream.delta",
    replyTo: request.id,
    workspaceId: request.workspaceId,
    runId: "run_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  assert.throws(() => gate.accept(runMismatch, now), (error: unknown) => error instanceof IpcError && error.code === "run_mismatch");
  gate.cancel(request.id);
  const late = frame({
    kind: "response",
    method: "run.start",
    id: request.id,
    replyTo: request.id,
    workspaceId: request.workspaceId,
    runId: request.runId,
  });
  assert.throws(() => gate.accept(late, now), (error: unknown) => error instanceof IpcError && error.code === "cancelled");
  assert.throws(() => gate.accept(late, now + 5000), (error: unknown) => error instanceof IpcError && error.code === "timeout");
});

test("parser rejects oversized and invalid frames without treating them as success", () => {
  const parser = new NdjsonParser();
  assert.throws(() => parser.push(Buffer.alloc(IPC_LIMITS.maxFrameBytes + 1)), (error: unknown) => {
    return error instanceof IpcError && error.code === "frame_too_large";
  });
  assert.equal(parser.closed, true);
  const fresh = new NdjsonParser();
  assert.throws(() => fresh.push(Buffer.from("{bad}\n")), (error: unknown) => error instanceof IpcError && error.code === "invalid_frame");
  const ok = frame({ kind: "request", method: "host.ready" });
  const encoded = encodeFrame(ok);
  const again = new NdjsonParser();
  assert.equal(again.push(encoded)[0]?.method, "host.ready");
});
