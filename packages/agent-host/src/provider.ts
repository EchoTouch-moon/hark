import { createAssistantMessageEventStream, createProvider, type AssistantMessage, type Message, type Model, type Provider, type TranscriptContext } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { applyContextPack, renderContextPack } from "./context-pack.ts";
import type { ProviderConfig } from "./dto.ts";

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

export function assertProviderSlot(config: ProviderConfig): void {
  if (config.providerId === "faux" || config.modelId === "faux") {
    throw new Error("faux is not a product provider and is not a fallback");
  }
  if (config.wire !== "openai-completions") {
    throw new Error("only an explicit openai-completions constructor is implemented");
  }
}

export function endpointOf(config: ProviderConfig): string {
  const base = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  return new URL("chat/completions", base).toString();
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
    if (!options.fetchImpl) {
      throw new Error("network guard refused: no explicit fetch was injected");
    }
    return options.fetchImpl(input, { ...init, redirect: "error" });
  };
}

export function createExplicitProvider(options: TransportOptions, gate: ProviderGate): Provider {
  assertProviderSlot(options.config);
  const model: Model<"openai-completions"> = {
    id: options.config.modelId,
    name: options.config.modelId,
    api: "openai-completions",
    provider: options.config.providerId,
    baseUrl: options.config.baseUrl,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 128000,
    maxTokens: 4096,
  };
  const fetchImpl = createGuardedFetch(options);
  const send = (current: Model<"openai-completions">, context: TranscriptContext, streamOptions?: { signal?: AbortSignal; apiKey?: string }) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
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
        const inner = streamSimple(current, normalizeContext({ messages }), {
          apiKey: options.config.apiKey,
          fetch: fetchImpl,
          ...(streamOptions?.signal ? { signal: streamOptions.signal } : {}),
          maxRetries: 0,
          onPayload: (payload: unknown) => {
            gate.notePayload(JSON.stringify(payload));
            return payload;
          },
        });
        let terminal = false;
        for await (const event of inner) {
          if (event.type === "done" || event.type === "error") terminal = true;
          stream.push(event);
        }
        if (!terminal) stream.end(await inner.result());
      } catch (error) {
        const message = error instanceof Error ? error.message : "provider send refused";
        const failed: AssistantMessage = {
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
        stream.push({ type: "error", reason: "error", error: failed });
        stream.end(failed);
      }
    })();
    return stream;
  };
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
    models: [model],
    api: {
      "openai-completions": {
        stream: send,
        streamSimple: send,
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

export function sseToolCall(name: string, args: unknown): string {
  const id = "call_local";
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
