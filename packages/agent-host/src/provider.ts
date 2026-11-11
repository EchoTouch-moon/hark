import { createAssistantMessageEventStream, createProvider, type AssistantMessage, type AssistantMessageEvent, type Message, type Model, type Provider, type TranscriptContext } from "@earendil-works/pi-ai";
import { streamSimple as anthropicStreamSimple } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as openaiStreamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { applyContextPack, renderContextPack } from "./context-pack.ts";
import { STEPFUN_BASE_URL, STEPFUN_MODEL_ID, STEPFUN_PROVIDER_ID, type ProviderConfig } from "./dto.ts";
import { bodyContainsSecret, captureOutboundRequest, type OutboundRequestSnapshot } from "./outbound-request.ts";

export interface ProviderGate {
  cancelled: boolean;
  timedOut: boolean;
  closed: boolean;
  backpressured: boolean;
  recheck: () => Promise<{ revision: string; sourceVersion: string; empty: boolean; identity?: string; overview?: string; stale: boolean } | null>;
  notePayload: (body: string) => void;
  failPack: boolean;
  hookThrew: boolean;
}

export interface TransportOptions {
  config: ProviderConfig;
  fetchImpl?: typeof fetch;
  /** Trusted native sender must perform review, authorization and actual send. */
  reviewedDispatch?: (snapshot: OutboundRequestSnapshot, signal: AbortSignal | undefined) => Promise<Response>;
  scripted?: (signal: AbortSignal | undefined) => Promise<Response>;
  secrets: readonly string[];
}

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const TO_WIRE: Record<string, string> = {
  "workspace.read_file": "workspace_read_file",
  "workspace.overview": "workspace_overview",
};
const FROM_WIRE: Record<string, string> = {
  workspace_read_file: "workspace.read_file",
  workspace_overview: "workspace.overview",
};

export function assertProviderSlot(config: ProviderConfig): void {
  if (config.providerId === "faux" || config.modelId === "faux") {
    throw new Error("faux is not a product provider and is not a fallback");
  }
  if (config.wire === "openai-completions") return;
  if (config.wire !== "anthropic-messages") {
    throw new Error("wire must be an explicit constructor");
  }
  if (
    config.providerId !== STEPFUN_PROVIDER_ID ||
    config.modelId !== STEPFUN_MODEL_ID ||
    config.baseUrl !== STEPFUN_BASE_URL
  ) {
    throw new Error("anthropic-messages slot is the fixed StepFun plan package");
  }
}

export function endpointOf(config: ProviderConfig): string {
  if (config.wire === "anthropic-messages") {
    // Pi 1.5.0 anthropic beta client posts `/v1/messages?beta=true` onto baseUrl with no extra slash.
    return `${config.baseUrl.replace(/\/+$/, "")}/v1/messages?beta=true`;
  }
  const base = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  return new URL("chat/completions", base).toString();
}

function wireTool(name: string): string {
  return TO_WIRE[name] ?? name;
}

function coreTool(name: string): string {
  return FROM_WIRE[name] ?? name;
}

function mapMessagesForWire(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.role === "system") {
      const content = typeof message.content === "string"
        ? message.content.replaceAll("workspace.read_file", "workspace_read_file").replaceAll("workspace.overview", "workspace_overview")
        : message.content;
      return {
        ...message,
        content,
        ...(message.toolsAdded ? { toolsAdded: message.toolsAdded.map((tool) => ({ ...tool, name: wireTool(tool.name) })) } : {}),
        ...(message.toolsRemoved ? { toolsRemoved: message.toolsRemoved.map((tool) => ({ ...tool, name: wireTool(tool.name) })) } : {}),
      };
    }
    if (message.role === "assistant") {
      return {
        ...message,
        content: message.content.map((block) => (block.type === "toolCall" ? { ...block, name: wireTool(block.name) } : block)),
      };
    }
    if (message.role === "toolResult") {
      return { ...message, toolName: wireTool(message.toolName) };
    }
    return message;
  });
}

function restoreCoreToolNames(message: AssistantMessage | undefined): void {
  if (!message) return;
  for (const block of message.content) {
    if (block.type === "toolCall") block.name = coreTool(block.name);
  }
}

function restoreEvent(event: AssistantMessageEvent): AssistantMessageEvent {
  if ("partial" in event) restoreCoreToolNames(event.partial);
  if (event.type === "toolcall_end") event.toolCall.name = coreTool(event.toolCall.name);
  if (event.type === "done") restoreCoreToolNames(event.message);
  if (event.type === "error") restoreCoreToolNames(event.error);
  return event;
}

export function createGuardedFetch(options: TransportOptions): typeof fetch {
  const allowed = endpointOf(options.config);
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url !== allowed) {
      throw new Error("network guard refused a non-configured endpoint");
    }
    if (options.scripted) {
      const signal = init?.signal ?? undefined;
      return options.scripted(signal);
    }
    if (!options.config.enabled || !options.config.allowRemote) {
      throw new Error("network guard refused: remote provider is closed");
    }
    if (options.reviewedDispatch) {
      const snapshot = captureOutboundRequest(input, init, { endpoint: allowed, model: options.config.modelId });
      if (bodyContainsSecret(snapshot.body, options.secrets)) {
        throw new Error("outbound request contains provider credential");
      }
      return options.reviewedDispatch(snapshot, init?.signal ?? undefined);
    }
    if (!options.fetchImpl) {
      throw new Error("network guard refused: no explicit fetch was injected");
    }
    return options.fetchImpl(input, { ...init, redirect: "error" });
  };
}

function failMessage(current: Model<"openai-completions"> | Model<"anthropic-messages">, message: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    api: current.api,
    provider: current.provider,
    model: current.id,
    stopReason: "error",
    errorMessage: message,
    timestamp: Date.now(),
    usage: ZERO_USAGE,
  };
}

async function preparedMessages(options: TransportOptions, gate: ProviderGate, context: TranscriptContext, streamOptions?: { apiKey?: string }): Promise<Message[]> {
  if (gate.closed || gate.cancelled) throw new Error("run cancelled before provider send");
  if (gate.backpressured) throw new Error("stdout backpressure refused the provider send");
  if (gate.timedOut) throw new Error("run timed out before provider send");
  if (streamOptions?.apiKey !== options.config.apiKey) {
    throw new Error("provider key was not the explicit injection");
  }
  const fresh = await gate.recheck();
  if (!fresh) throw new Error("authorization recheck refused the provider send");
  if (gate.failPack) throw new Error("context pack failed closed");
  const pack = renderContextPack(
    {
      contextPackRevision: fresh.revision,
      sourceVersion: fresh.sourceVersion,
      empty: fresh.empty,
      ...(fresh.identity ? { identity: fresh.identity } : {}),
      ...(fresh.overview ? { overview: fresh.overview } : {}),
    },
    fresh.stale || gate.hookThrew,
  );
  const messages = applyContextPack(context.messages as Message[], pack);
  return options.config.wire === "anthropic-messages" ? mapMessagesForWire(messages) : messages;
}

export function createExplicitProvider(options: TransportOptions, gate: ProviderGate): Provider {
  assertProviderSlot(options.config);
  const fetchImpl = createGuardedFetch(options);
  const wire = options.config.wire;
  const model = {
    id: options.config.modelId,
    name: options.config.modelId,
    api: wire,
    provider: options.config.providerId,
    baseUrl: options.config.baseUrl,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 128000,
    maxTokens: 4096,
  };
  const send = (current: Model<"openai-completions"> | Model<"anthropic-messages">, context: TranscriptContext, streamOptions?: { signal?: AbortSignal; apiKey?: string }) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
        const messages = await preparedMessages(options, gate, context, streamOptions);
        const streamOptionsForSdk = {
          apiKey: options.config.apiKey,
          fetch: fetchImpl,
          ...(streamOptions?.signal ? { signal: streamOptions.signal } : {}),
          maxRetries: 0,
          onPayload: (payload: unknown) => {
            gate.notePayload(JSON.stringify(payload));
            return payload;
          },
        };
        const inner = wire === "anthropic-messages"
          ? anthropicStreamSimple(current as Model<"anthropic-messages">, normalizeContext({ messages }), streamOptionsForSdk)
          : openaiStreamSimple(current as Model<"openai-completions">, normalizeContext({ messages }), streamOptionsForSdk);
        let terminal = false;
        for await (const event of inner) {
          if (event.type === "done" || event.type === "error") terminal = true;
          stream.push(wire === "anthropic-messages" ? restoreEvent(event) : event);
        }
        if (!terminal) {
          const result = await inner.result();
          if (wire === "anthropic-messages") restoreCoreToolNames(result);
          stream.end(result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "provider send refused";
        const failed = failMessage(current, message);
        stream.push({ type: "error", reason: "error", error: failed });
        stream.end(failed);
      }
    })();
    return stream;
  };
  if (wire === "anthropic-messages") {
    const anthropicModel = model as Model<"anthropic-messages">;
    const anthropicSend = send as (current: Model<"anthropic-messages">, context: TranscriptContext, streamOptions?: { signal?: AbortSignal; apiKey?: string }) => ReturnType<typeof send>;
    return createProvider({
      id: options.config.providerId,
      name: options.config.providerId,
      baseUrl: options.config.baseUrl,
      auth: {
        apiKey: {
          name: "explicit-injection",
          async resolve({ credential }) {
            if (!credential?.key || credential.key !== options.config.apiKey) return undefined;
            return { auth: { apiKey: credential.key }, source: "explicit-injection" };
          },
        },
      },
      models: [anthropicModel],
      api: {
        "anthropic-messages": {
          stream: anthropicSend,
          streamSimple: anthropicSend,
        },
      },
    });
  }
  const openaiModel = model as Model<"openai-completions">;
  const openaiSend = send as (current: Model<"openai-completions">, context: TranscriptContext, streamOptions?: { signal?: AbortSignal; apiKey?: string }) => ReturnType<typeof send>;
  return createProvider({
    id: options.config.providerId,
    name: options.config.providerId,
    baseUrl: options.config.baseUrl,
    auth: {
      apiKey: {
        name: "explicit-injection",
        async resolve({ credential }) {
          if (!credential?.key || credential.key !== options.config.apiKey) return undefined;
          return { auth: { apiKey: credential.key }, source: "explicit-injection" };
        },
      },
    },
    models: [openaiModel],
    api: {
      "openai-completions": {
        stream: openaiSend,
        streamSimple: openaiSend,
      },
    },
  });
}

export function sseText(text: string): string {
  const chunk = (delta: unknown, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "hark-local",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return `${chunk({ role: "assistant", content: text }, null)}${chunk({}, "stop")}data: [DONE]\n\n`;
}

let scriptedToolSequence = 0;
export function sseToolCall(name: string, args: unknown): string {
  const id = `call_local_${++scriptedToolSequence}`;
  const first = {
    role: "assistant",
    content: "",
    tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }],
  };
  const second = { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] };
  const chunk = (delta: unknown, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "hark-local",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return `${chunk(first, null)}${chunk(second, null)}${chunk({}, "tool_calls")}data: [DONE]\n\n`;
}

export function scriptedResponse(kind: "text" | "tool_call", textOrName: string, args?: unknown): Response {
  const body = kind === "text" ? sseText(textOrName) : sseToolCall(textOrName, args ?? {});
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
