import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContext, type Tool } from "@earendil-works/pi-ai";
import {
  STEPFUN_BASE_URL,
  STEPFUN_MODEL_ID,
  STEPFUN_PROVIDER_ID,
  providerConfigFromFile,
  takeSessionProviderKey,
} from "../src/dto.ts";
import { createExplicitProvider, createGuardedFetch, endpointOf, type ProviderGate } from "../src/provider.ts";

const SYNTH = "hark-session-test-key";

function gate(): ProviderGate {
  return {
    cancelled: false,
    timedOut: false,
    closed: false,
    backpressured: false,
    failPack: false,
    hookThrew: false,
    recheck: async () => ({ revision: "rev", sourceVersion: "src", empty: true, stale: false }),
    notePayload: () => {},
  };
}

function tools(): Tool[] {
  return [
    {
      name: "workspace.read_file",
      description: "Read one relative file.",
      parameters: { type: "object", properties: { relativePath: { type: "string" } }, required: ["relativePath"] },
    },
    {
      name: "workspace.overview",
      description: "Request the workspace overview.",
      parameters: { type: "object", properties: {} },
    },
  ];
}

function sse(events: Array<[string, unknown]>): string {
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

function start(model = STEPFUN_MODEL_ID) {
  return ["message_start", {
    type: "message_start",
    message: {
      id: "msg_local",
      type: "message",
      role: "assistant",
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 1 },
    },
  }] as [string, unknown];
}

function stop(reason: string): Array<[string, unknown]> {
  return [
    ["message_delta", { type: "message_delta", delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 2 } }],
    ["message_stop", { type: "message_stop" }],
  ];
}

function textSse(): string {
  return sse([
    start(),
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ...stop("end_turn"),
  ]);
}

function toolSse(): string {
  return sse([
    start(),
    ["content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_local", name: "workspace_read_file", input: {} },
    }],
    ["content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: "{\"relativePath\":\"README.md\"}" },
    }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ...stop("tool_use"),
  ]);
}

test("session key is taken out of env and anthropic metadata cannot store it", () => {
  const env: NodeJS.ProcessEnv = { HARK_SESSION_PROVIDER_KEY: SYNTH, KEEP: "yes" };
  const taken = takeSessionProviderKey(env);
  assert.equal(taken, SYNTH);
  assert.equal(env.HARK_SESSION_PROVIDER_KEY, undefined);
  assert.equal(env.KEEP, "yes");
  assert.throws(() => providerConfigFromFile({
    enabled: true,
    providerId: STEPFUN_PROVIDER_ID,
    modelId: STEPFUN_MODEL_ID,
    baseUrl: STEPFUN_BASE_URL,
    wire: "anthropic-messages",
    allowRemote: true,
    apiKey: SYNTH,
    keyStorage: "process-memory",
    authenticated: false,
  }, SYNTH));
  const config = providerConfigFromFile({
    enabled: true,
    providerId: STEPFUN_PROVIDER_ID,
    modelId: STEPFUN_MODEL_ID,
    baseUrl: STEPFUN_BASE_URL,
    wire: "anthropic-messages",
    allowRemote: true,
    keyStorage: "process-memory",
    authenticated: false,
  }, SYNTH);
  assert.equal(config.apiKey, SYNTH);
  assert.equal(endpointOf(config), `${STEPFUN_BASE_URL}/v1/messages?beta=true`);
});

test("review dispatch sees final body but never credentials and has no implicit network fallback", async () => {
  const config = providerConfigFromFile({
    enabled: true, providerId: STEPFUN_PROVIDER_ID, modelId: STEPFUN_MODEL_ID,
    baseUrl: STEPFUN_BASE_URL, wire: "anthropic-messages", allowRemote: true, authenticated: false,
  }, SYNTH);
  const body = JSON.stringify({ model: STEPFUN_MODEL_ID, messages: [{ role: "user", content: "synthetic" }] });
  let captured = "";
  const guarded = createGuardedFetch({ config, secrets: [SYNTH], reviewedDispatch: async (snapshot) => {
    captured = JSON.stringify(snapshot);
    throw new Error("review denied");
  } });
  await assert.rejects(guarded(endpointOf(config), { method: "POST", body, headers: { "x-api-key": SYNTH } }), /review denied/);
  assert.equal(JSON.parse(captured).body, body);
  assert.equal(captured.includes(SYNTH), false);
  await assert.rejects(guarded(endpointOf(config), { method: "POST", body: JSON.stringify({ model: "wrong" }) }), /model mismatch/);
  await assert.rejects(guarded(endpointOf(config), { method: "POST", body: JSON.stringify({ model: STEPFUN_MODEL_ID, message: SYNTH }) }), /contains provider credential/);
});

test("actual SDK serialization is captured at the review dispatch boundary", async () => {
  const config = providerConfigFromFile({
    enabled: true, providerId: STEPFUN_PROVIDER_ID, modelId: STEPFUN_MODEL_ID,
    baseUrl: STEPFUN_BASE_URL, wire: "anthropic-messages", allowRemote: true, authenticated: false,
  }, SYNTH);
  const snapshots: string[] = [];
  const provider = createExplicitProvider({ config, secrets: [SYNTH], reviewedDispatch: async (snapshot) => {
    snapshots.push(JSON.stringify(snapshot));
    return new Response(textSse(), { status: 200, headers: { "content-type": "text/event-stream" } });
  } }, gate());
  const model = provider.getModels()[0];
  assert.ok(model);
  const result = await provider.streamSimple(model, normalizeContext({
    systemPrompt: "synthetic system instruction",
    messages: [{ role: "user", content: "synthetic question", timestamp: 1 }],
    tools: tools(),
  }), { apiKey: SYNTH }).result();
  assert.equal(result.stopReason, "stop");
  assert.equal(snapshots.length, 1);
  assert.match(snapshots[0] ?? "", /synthetic question/);
  assert.equal((snapshots[0] ?? "").includes(SYNTH), false);
  const wire = JSON.parse(JSON.parse(snapshots[0] ?? "{}").body);
  assert.equal(wire.model, STEPFUN_MODEL_ID);
  assert.equal(wire.stream, true);
  assert.ok(Number.isInteger(wire.max_tokens) && wire.max_tokens > 0 && wire.max_tokens <= 4096);
});

test("anthropic SDK text and tool paths use the intercepted plan endpoint", async () => {
  const urls: string[] = [];
  const bodies: string[] = [];
  let calls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls += 1;
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(url);
    bodies.push(typeof init?.body === "string" ? init.body : "");
    const body = calls === 1 ? textSse() : toolSse();
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const config = providerConfigFromFile({
    enabled: true,
    providerId: STEPFUN_PROVIDER_ID,
    modelId: STEPFUN_MODEL_ID,
    baseUrl: STEPFUN_BASE_URL,
    wire: "anthropic-messages",
    allowRemote: true,
    authenticated: false,
  }, SYNTH);
  const provider = createExplicitProvider({ config, fetchImpl, secrets: [SYNTH] }, gate());
  assert.equal(calls, 0);
  const model = provider.getModels()[0];
  assert.ok(model);
  const context = normalizeContext({
    systemPrompt: "You can call workspace.read_file and workspace.overview.",
    messages: [{ role: "user", content: "ping", timestamp: 1 }],
    tools: tools(),
  });
  const text = await provider.streamSimple(model, context, { apiKey: SYNTH }).result();
  assert.equal(text.stopReason, "stop");
  assert.equal(text.content.find((block) => block.type === "text" && block.text === "OK")?.type, "text");
  const tool = await provider.streamSimple(model, context, { apiKey: SYNTH }).result();
  const call = tool.content.find((block) => block.type === "toolCall");
  assert.equal(call?.type, "toolCall");
  if (call?.type === "toolCall") {
    assert.equal(call.name, "workspace.read_file");
    assert.equal(call.arguments.relativePath, "README.md");
  }
  assert.equal(calls, 2);
  assert.deepEqual(urls, [`${STEPFUN_BASE_URL}/v1/messages?beta=true`, `${STEPFUN_BASE_URL}/v1/messages?beta=true`]);
  for (const body of bodies) {
    assert.equal(body.includes("workspace_read_file"), true);
    assert.equal(body.includes("workspace_overview"), true);
    assert.equal(body.includes("workspace.read_file"), false);
    assert.equal(body.includes(SYNTH), false);
  }
});
