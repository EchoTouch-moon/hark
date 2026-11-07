import test from "node:test";
import assert from "node:assert/strict";
import { cognitionOperationId, createMemoryTools } from "../src/memory-tools.ts";

test("cognition operation identity is stable for the actual run and SDK tool call", () => {
  const first = cognitionOperationId("run-one", "sdk-call-one");
  assert.equal(first, cognitionOperationId("run-one", "sdk-call-one"));
  assert.notEqual(first, cognitionOperationId("run-two", "sdk-call-one"));
  assert.notEqual(first, cognitionOperationId("run-one", "sdk-call-two"));
  assert.match(first, /^op_[0-9a-f]{32}$/);
});

test("memory tool definitions never expose authority or receipt fields", () => {
  let calls = 0;
  const tools = createMemoryTools({ workspaceId: "ws", runId: "run", purpose: "conversation", closed: () => false }, async () => {
    calls += 1;
    throw new Error("definition must not call Core or a model");
  });
  assert.deepEqual(tools.map((tool) => tool.name), ["memory_propose_change", "opinion_propose_change", "memory_recall"]);
  for (const tool of tools) {
    assert.equal(tool.parameters.additionalProperties, false);
    for (const key of ["workspaceId", "runId", "operationId", "currentUserMessageId", "caller", "recorded", "success"]) {
      assert.equal(key in tool.parameters.properties, false);
    }
  }
  assert.equal(calls, 0);
});
