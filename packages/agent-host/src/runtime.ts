import {
  createAgentSession,
  createExtensionRuntime,
  createSyntheticSourceInfo,
  defineTool,
  ModelRuntime,
  SessionManager,
  type Extension,
  type SessionManager as SessionManagerType,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { applyContextPack } from "./context-pack.ts";
import { createMemoryTools } from "./memory-tools.ts";
import { closeBuiltinCredentialProbes } from "./credentials/close-runtime.ts";
import { createMemoryCredentialStore } from "./memory-credentials.ts";
import {
  CLOSED_MEMORY_TOOLS,
  FORBIDDEN_TOOL_NAMES,
  HARK_TOOL_NAMES,
  STATIC_SYSTEM_PROMPT,
  overviewResultSchema,
  providerConfigSchema,
  readFileResultSchema,
  runStartPayloadSchema,
  scriptedTransportSchema,
  type HarkToolName,
  type ProviderConfig,
  type RunStartPayload,
  type ScriptedTransport,
} from "./dto.ts";
import {
  CorrelationGate,
  encodeFrame,
  errorFrame,
  IpcError,
  mintId,
  NdjsonParser,
  redactText,
  SideQueues,
  type Frame,
} from "./ipc.ts";
import { createEmptyResourceLoader } from "./empty-resource-loader.ts";
import { createIsolatedSettings } from "./isolated-session.ts";
import { createExplicitProvider, endpointOf, scriptedResponse, type ProviderGate } from "./provider.ts";
import type { OutboundRequestSnapshot } from "./outbound-request.ts";

const sessionRefSchema = z.string().regex(/^pi:[0-9a-f-]{36}$/);

interface SessionRecord {
  sessionRef: string;
  fileName: string;
  handoffIds: string[];
}

interface SessionIndex {
  sessions: SessionRecord[];
}

interface ActiveRun {
  requestId: string;
  workspaceId: string;
  runId: string;
  payload: RunStartPayload;
  abort: AbortController;
  cancelled: boolean;
  timedOut: boolean;
  completed: boolean;
  sessionRef: string;
  toolRequestIds: string[];
}

export interface HostOptions {
  appDataDir: string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  providerConfig?: ProviderConfig | null;
  scriptedTransport?: ScriptedTransport | null;
  fetchImpl?: typeof fetch;
  /** Only a trusted sender which owns review and the final send may implement this. */
  reviewedDispatch?: (snapshot: OutboundRequestSnapshot, run: { workspaceId: string; runId: string }, signal: AbortSignal) => Promise<Response>;
  now?: () => number;
  log?: (line: string) => void;
  hookShouldThrow?: () => boolean;
  failPack?: () => boolean;
}

function assertSafeDir(label: string, value: string): string {
  const resolved = path.resolve(value);
  if (!path.isAbsolute(resolved)) throw new Error(`${label} must be absolute`);
  const parts = new Set(resolved.split(path.sep));
  if (parts.has("personal-vault") || parts.has("memory-vault")) throw new Error(`${label} is a private vault`);
  const homePi = path.resolve(process.env.HOME ?? "/", ".pi");
  if (resolved === homePi || resolved.startsWith(`${homePi}${path.sep}`)) {
    throw new Error(`${label} must not be the global Pi directory`);
  }
  return resolved;
}

function relativePathAllowed(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function assistantText(message: AssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export class HostRuntime {
  readonly payloads: string[] = [];
  readonly fetchCount = { n: 0 };
  private readonly options: HostOptions;
  private readonly appDataDir: string;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly secrets: string[];
  private readonly gate = new CorrelationGate();
  private readonly queues = new SideQueues();
  private readonly parser = new NdjsonParser();
  private readonly pending = new Map<string, (frame: Frame) => void>();
  private readonly active = new Map<string, ActiveRun>();
  private writing = false;
  private stopped = false;
  private readonly providerConfig: ProviderConfig | null;
  private readonly scripted: ScriptedTransport | null;
  private scriptCursor = 0;
  private currentAbort: AbortSignal | null = null;
  private readonly providerGate: ProviderGate;
  private runtimePromise: Promise<ModelRuntime> | null = null;
  private shuttingDown = false;
  private outputDestroyed = false;
  private writeOutstanding = false;
  private runTimer: ReturnType<typeof setTimeout> | null = null;
  private backpressureTimer: ReturnType<typeof setTimeout> | null = null;
  private unblockTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly toolTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: HostOptions) {
    this.options = options;
    this.appDataDir = assertSafeDir("appDataDir", options.appDataDir);
    this.now = options.now ?? Date.now;
    this.providerConfig = options.providerConfig ?? null;
    this.scripted = options.scriptedTransport ?? null;
    this.secrets = this.providerConfig ? [this.providerConfig.apiKey] : [];
    this.log = (line) => options.log?.(redactText(line, this.secrets));
    this.providerGate = {
      cancelled: false,
      timedOut: false,
      closed: false,
      backpressured: false,
      failPack: false,
      hookThrew: false,
      recheck: async () => null,
      notePayload: (body) => {
        this.payloads.push(redactText(body, this.secrets));
      },
    };
  }

  async start(): Promise<void> {
    mkdirSync(this.appDataDir, { recursive: true });
    this.options.input.on("data", (chunk: Buffer) => {
      if (this.stopped) return;
      try {
        const frames = this.parser.push(chunk);
        for (const frame of frames) void this.onFrame(frame);
      } catch (error) {
        this.failParser(error);
      }
    });
    this.options.input.on("end", () => this.shutdown("stdin-end"));
    this.options.input.on("close", () => this.shutdown("stdin-close"));
    this.options.input.on("error", () => this.shutdown("stdin-error"));
    this.options.output.on("error", () => this.shutdown("stdout-error"));
    this.options.output.on("drain", () => this.clearBackpressure());
    const ready = this.requestFrame(null, null, "host.ready", {});
    this.gate.registerRequest(ready, this.now());
    this.send(ready);
  }

  private shutdown(reason: string): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.stopped = true;
    this.providerGate.cancelled = true;
    this.providerGate.closed = true;
    this.clearTimer(this.runTimer);
    this.runTimer = null;
    this.clearTimer(this.backpressureTimer);
    this.backpressureTimer = null;
    for (const timer of this.toolTimers.values()) clearTimeout(timer);
    this.toolTimers.clear();
    for (const [id, waiter] of [...this.pending.entries()]) {
      this.pending.delete(id);
      try {
        waiter(errorFrame(id, null, null, "cancelled", "host closed"));
      } catch {
        // The waiter may already have settled.
      }
    }
    for (const run of this.active.values()) {
      run.cancelled = true;
      if (!run.abort.signal.aborted) run.abort.abort();
    }
    this.queues.dropStream();
    this.log(`host shutdown ${reason}`);
    this.kick();
    this.unblockTimer = setTimeout(() => {
      if (this.writeOutstanding) this.forceUnblockOutput();
    }, 100);
  }

  private clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
    if (timer) clearTimeout(timer);
  }

  private forceUnblockOutput(): void {
    if (this.outputDestroyed) return;
    this.outputDestroyed = true;
    const output = this.options.output as NodeJS.WritableStream & { destroy?: (error?: Error) => void };
    try {
      output.destroy?.(new Error("host shutdown"));
    } catch {
      // The stream may already be closed.
    }
  }

  private armBackpressure(): void {
    this.providerGate.backpressured = true;
    if (this.backpressureTimer) return;
    this.backpressureTimer = setTimeout(() => {
      this.backpressureTimer = null;
      if (!this.providerGate.backpressured) return;
      this.providerGate.cancelled = true;
      for (const run of this.active.values()) {
        run.cancelled = true;
        if (!run.abort.signal.aborted) run.abort.abort();
      }
    }, 50);
  }

  private clearBackpressure(): void {
    this.providerGate.backpressured = false;
    this.clearTimer(this.backpressureTimer);
    this.backpressureTimer = null;
  }

  private failParser(error: unknown): void {
    if (this.shuttingDown) return;
    const ipc = error instanceof IpcError ? error : new IpcError("invalid_frame", "frame rejected");
    this.log(`ipc ${ipc.code}`);
    try {
      this.send(errorFrame(null, null, null, ipc.code, ipc.message));
    } catch {
      this.log("ipc error frame dropped");
    }
    this.shutdown("parser");
  }

  private requestFrame(workspaceId: string | null, runId: string | null, method: string, payload: Record<string, unknown>, deadlineUnixMs: number | null = null): Frame {
    const id = mintId("req");
    return {
      v: 1,
      kind: "request",
      id,
      replyTo: null,
      workspaceId,
      runId,
      method,
      deadlineUnixMs,
      payload,
      error: null,
    };
  }

  private send(frame: Frame): void {
    if (this.stopped && frame.method !== "error") return;
    this.queues.tryPush(frame);
    this.kick();
  }

  private kick(): void {
    if (this.writing) return;
    if (this.outputDestroyed) return;
    if (this.shuttingDown && this.queues.controlLen === 0) return;
    this.writing = true;
    void this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.queues.controlLen > 0 || (!this.stopped && this.queues.streamLen > 0)) {
        const frame = this.queues.pop();
        if (!frame) break;
        if (this.stopped && frame.kind !== "error") continue;
        await this.writeBytes(encodeFrame(frame));
      }
    } catch (error) {
      this.log(`stdout write failed ${error instanceof Error ? error.name : "error"}`);
      this.shutdown("stdout-error");
    } finally {
      this.writing = false;
      if (this.outputDestroyed) return;
      if (this.queues.controlLen > 0) this.kick();
      else if (!this.shuttingDown && !this.stopped && this.queues.streamLen > 0) this.kick();
    }
  }

  private writeBytes(bytes: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.outputDestroyed) {
        resolve();
        return;
      }
      this.writeOutstanding = true;
      let settled = false;
      const finish = (error?: Error | null) => {
        if (settled) return;
        settled = true;
        this.writeOutstanding = false;
        if (error && !this.shuttingDown) reject(error);
        else resolve();
      };
      try {
        const accepted = this.options.output.write(bytes, (error) => finish(error ?? null));
        if (accepted === false) this.armBackpressure();
      } catch (error) {
        finish(error instanceof Error ? error : new Error("write failed"));
      }
    });
  }

  private async onFrame(frame: Frame): Promise<void> {
    try {
      if (frame.kind === "response" || (frame.kind === "error" && frame.replyTo)) {
        try {
          this.gate.accept(frame, this.now());
        } catch (error) {
          const waiter = frame.replyTo ? this.pending.get(frame.replyTo) : undefined;
          if (waiter && frame.replyTo) this.pending.delete(frame.replyTo);
          waiter?.(frame.kind === "error" ? frame : errorFrame(frame.replyTo, frame.workspaceId, frame.runId, error instanceof IpcError ? error.code : "correlation_rejected", error instanceof Error ? error.message : "rejected"));
          throw error;
        }
        const waiter = frame.replyTo ? this.pending.get(frame.replyTo) : undefined;
        if (waiter && frame.replyTo) {
          this.pending.delete(frame.replyTo);
          waiter(frame);
        }
        return;
      }
      if (frame.kind !== "request" || frame.replyTo !== null) {
        this.gate.accept(frame, this.now());
        return;
      }
      this.gate.registerRequest(frame, this.now());
      if (frame.method === "run.cancel") {
        await this.onCancel(frame);
        return;
      }
      if (frame.method === "run.start") {
        await this.onRunStart(frame);
        return;
      }
      this.send(errorFrame(frame.id, frame.workspaceId, frame.runId, "invalid_frame", "unsupported method"));
    } catch (error) {
      const ipc = error instanceof IpcError ? error : new IpcError("invalid_frame", "frame rejected");
      this.send(errorFrame(frame.replyTo ?? frame.id, frame.workspaceId, frame.runId, ipc.code, ipc.message));
    }
  }

  private async onCancel(frame: Frame): Promise<void> {
    const target = frame.payload.targetRequestId;
    if (typeof target !== "string") {
      this.send(errorFrame(frame.id, frame.workspaceId, frame.runId, "invalid_frame", "targetRequestId missing"));
      return;
    }
    try {
      this.gate.cancel(target);
    } catch (error) {
      const ipc = error instanceof IpcError ? error : new IpcError("correlation_rejected", "unknown request");
      this.send(errorFrame(frame.id, frame.workspaceId, frame.runId, ipc.code, ipc.message));
      return;
    }
    for (const run of this.active.values()) {
      if (run.requestId === target) {
        run.cancelled = true;
        run.abort.abort();
        for (const toolId of run.toolRequestIds) {
          try {
            this.gate.cancel(toolId);
          } catch {
            // The tool request may already have completed.
          }
        }
      }
    }
    this.send({
      v: 1,
      kind: "response",
      id: frame.id,
      replyTo: frame.id,
      workspaceId: frame.workspaceId,
      runId: frame.runId,
      method: "run.cancel",
      deadlineUnixMs: null,
      payload: { cancelled: true, targetRequestId: target },
      error: null,
    });
  }

  private async onRunStart(frame: Frame): Promise<void> {
    const parsed = runStartPayloadSchema.safeParse(frame.payload);
    if (!parsed.success || !frame.workspaceId || !frame.runId) {
      this.send(errorFrame(frame.id, frame.workspaceId, frame.runId, "invalid_frame", "run.start payload rejected"));
      return;
    }
    const payload = parsed.data;
    if (payload.authorization.runId !== frame.runId || payload.authorization.provider !== payload.provider || payload.authorization.model !== payload.model) {
      this.send(errorFrame(frame.id, frame.workspaceId, frame.runId, "model_not_authorized", "run binding does not match the trusted snapshot"));
      return;
    }
    if (payload.authorization.current !== true || payload.authorization.directoryStatus !== "active" || payload.authorization.modelGrantStatus !== "active") {
      this.send(errorFrame(frame.id, frame.workspaceId, frame.runId, "model_not_authorized", "start snapshot is not an active grant"));
      return;
    }
    if (this.shuttingDown) {
      this.send(errorFrame(frame.id, frame.workspaceId, frame.runId, "cancelled", "host closed"));
      return;
    }
    if (this.active.size > 0) {
      this.send(errorFrame(frame.id, frame.workspaceId, frame.runId, "correlation_rejected", "host busy: one run is active"));
      return;
    }
    const slot = this.providerConfig;
    if (!slot?.enabled || slot.providerId !== payload.provider || slot.modelId !== payload.model) {
      this.send(errorFrame(frame.id, frame.workspaceId, frame.runId, "model_not_authorized", "explicit provider slot is closed or does not match"));
      return;
    }
    const run: ActiveRun = {
      requestId: frame.id,
      workspaceId: frame.workspaceId,
      runId: frame.runId,
      payload,
      abort: new AbortController(),
      cancelled: false,
      timedOut: false,
      completed: false,
      sessionRef: "",
      toolRequestIds: [],
    };
    this.active.set(frame.workspaceId, run);
    const deadline = this.gate.deadlineOf(frame.id);
    this.runTimer = deadline === null ? null : setTimeout(() => {
      run.timedOut = true;
      run.abort.abort();
    }, Math.max(0, deadline - this.now()));
    try {
      const opened = this.openSession(run);
      run.sessionRef = opened.sessionRef;
      this.send({
        v: 1,
        kind: "response",
        id: frame.id,
        replyTo: frame.id,
        workspaceId: frame.workspaceId,
        runId: frame.runId,
        method: "run.start",
        deadlineUnixMs: null,
        payload: {
          accepted: true,
          sendPermit: false,
          sessionRef: opened.sessionRef,
          resumed: opened.resumed,
          contextPolicy: opened.contextPolicy,
          handoffApplied: opened.handoffApplied,
          committedByHost: false,
          syntheticCore: payload.syntheticCore === true,
        },
        error: null,
      });
      await this.executeRun(run, opened.manager);
    } catch (error) {
      if (!run.completed) {
        const code = run.cancelled ? "cancelled" : run.timedOut ? "timeout" : "model_not_authorized";
        const message = redactText(error instanceof Error ? error.message : "run failed", this.secrets);
        this.send(errorFrame(frame.id, frame.workspaceId, frame.runId, code, message));
      }
    } finally {
      this.clearTimer(this.runTimer);
      this.runTimer = null;
      this.active.delete(frame.workspaceId);
    }
  }

  private sessionDir(workspaceId: string): string {
    const dir = path.join(this.appDataDir, "sessions", workspaceId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private agentCwd(workspaceId: string): string {
    const dir = path.join(this.appDataDir, "agent-cwd", workspaceId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private readIndex(workspaceId: string): SessionIndex {
    const file = path.join(this.sessionDir(workspaceId), "index.json");
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as SessionIndex;
      if (!parsed || !Array.isArray(parsed.sessions)) return { sessions: [] };
      return parsed;
    } catch {
      return { sessions: [] };
    }
  }

  private writeIndex(workspaceId: string, index: SessionIndex): void {
    writeFileSync(path.join(this.sessionDir(workspaceId), "index.json"), `${JSON.stringify(index)}\n`);
  }

  private openSession(run: ActiveRun): { manager: SessionManagerType; sessionRef: string; resumed: boolean; contextPolicy: string; handoffApplied: boolean } {
    const cwd = this.agentCwd(run.workspaceId);
    const dir = this.sessionDir(run.workspaceId);
    const index = this.readIndex(run.workspaceId);
    const requested = run.payload.sessionRef;
    const existing = requested ? index.sessions.find((item) => item.sessionRef === requested) : index.sessions.at(-1);
    let manager: SessionManagerType;
    let resumed = false;
    let createdNew = false;
    if (existing && (!requested || existing.sessionRef === requested)) {
      manager = SessionManager.open(path.join(dir, existing.fileName), dir, cwd);
      resumed = true;
    } else if (requested) {
      throw new IpcError("correlation_rejected", "sessionRef is not in this workspace");
    } else {
      manager = SessionManager.create(cwd, dir);
      createdNew = true;
    }
    const compacted = manager.getBranch().some((entry) => entry.type === "compaction" || entry.type === "branch_summary");
    let contextPolicy = "request-pack";
    if (compacted) {
      contextPolicy = "new-session-compaction-fallback";
      manager = SessionManager.create(cwd, dir);
      resumed = false;
      createdNew = true;
    }
    const sessionFile = manager.getSessionFile();
    const sessionId = manager.getSessionId();
    if (!sessionFile || !sessionRefSchema.safeParse(`pi:${sessionId}`).success) {
      throw new Error("official session id was not available");
    }
    const sessionRef = `pi:${sessionId}`;
    const fileName = path.basename(sessionFile);
    let record = index.sessions.find((item) => item.sessionRef === sessionRef);
    if (!record) {
      record = { sessionRef, fileName, handoffIds: [] };
      index.sessions.push(record);
    } else {
      record.fileName = fileName;
    }
    const handoffApplied = createdNew ? this.applyHandoff(run, manager, record) : false;
    if (handoffApplied && run.payload.handoffId && !record.handoffIds.includes(run.payload.handoffId)) {
      record.handoffIds.push(run.payload.handoffId);
    }
    this.writeIndex(run.workspaceId, index);
    return { manager, sessionRef, resumed, contextPolicy, handoffApplied };
  }

  private applyHandoff(run: ActiveRun, manager: SessionManagerType, target: SessionRecord): boolean {
    const handoffId = run.payload.handoffId;
    const recent = run.payload.recentMessages ?? [];
    if (!handoffId || recent.length === 0) return false;
    if (target.handoffIds.includes(handoffId)) return false;
    for (const message of recent) {
      if (message.text.includes("compacted into the following summary")) continue;
      if (message.role === "user") {
        manager.appendMessage({ role: "user", content: message.text, timestamp: message.createdAtUnixMs });
      } else {
        manager.appendMessage({
          role: "assistant",
          content: [{ type: "text", text: message.text }],
          api: this.providerConfig?.wire === "anthropic-messages" ? "anthropic-messages" : "openai-completions",
          provider: run.payload.provider,
          model: run.payload.model,
          stopReason: "stop",
          timestamp: message.createdAtUnixMs,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        });
      }
    }
    return true;
  }

  private async modelRuntime(): Promise<ModelRuntime> {
    if (this.runtimePromise) return this.runtimePromise;
    this.runtimePromise = (async () => {
      const slot = this.providerConfig;
      if (!slot) throw new Error("provider slot is closed");
      const runtime = await ModelRuntime.create({
        credentials: createMemoryCredentialStore(),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      await closeBuiltinCredentialProbes(runtime);
      const provider = createExplicitProvider(
        {
          config: slot,
          secrets: this.secrets,
          ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
          ...(this.options.reviewedDispatch ? {
            reviewedDispatch: async (snapshot: OutboundRequestSnapshot, signal: AbortSignal | undefined) => {
              const run = [...this.active.values()][0];
              if (!run || run.cancelled || run.timedOut || run.abort.signal.aborted || this.shuttingDown) {
                throw new Error("review dispatch refused: run closed");
              }
              const dispatch = this.options.reviewedDispatch;
              if (!dispatch) throw new Error("review dispatch unavailable");
              const combined = signal ? AbortSignal.any([run.abort.signal, signal]) : run.abort.signal;
              const response = await dispatch(snapshot, { workspaceId: run.workspaceId, runId: run.runId }, combined);
              if (combined.aborted || run.cancelled || run.timedOut || this.shuttingDown) {
                throw new Error("review dispatch refused: run closed");
              }
              return response;
            },
          } : {}),
          ...(this.scripted
            ? {
                scripted: async (signal) => {
                  this.log("scripted-transport-invoke");
                  const next = this.scripted?.responses[this.scriptCursor];
                  this.scriptCursor += 1;
                  if (!next) throw new Error("scripted transport has no more responses");
                  if (next.kind === "hold") {
                    await new Promise<void>((_resolve, reject) => {
                      const abort = () => reject(new Error("scripted transport aborted"));
                      if (signal?.aborted || this.currentAbort?.aborted) abort();
                      signal?.addEventListener("abort", abort, { once: true });
                      this.currentAbort?.addEventListener("abort", abort, { once: true });
                    });
                    throw new Error("scripted transport aborted");
                  }
                  this.fetchCount.n += 1;
                  if (next.kind === "text") return scriptedResponse("text", next.text);
                  return scriptedResponse("tool_call", next.name, next.arguments);
                },
              }
            : {}),
        },
        this.providerGate,
      );
      runtime.registerNativeProvider(provider);
      await runtime.setRuntimeApiKey(slot.providerId, slot.apiKey);
      return runtime;
    })();
    return this.runtimePromise;
  }

  private async executeRun(run: ActiveRun, manager: SessionManagerType): Promise<void> {
    const slot = this.providerConfig;
    if (!slot) throw new Error("provider slot is closed");
    const runtime = await this.modelRuntime();
    const model = runtime.getModel(slot.providerId, slot.modelId);
    if (!model) throw new Error("explicit model was not registered");
    const cwd = this.agentCwd(run.workspaceId);
    const agentDir = path.join(this.appDataDir, "agent", run.workspaceId);
    mkdirSync(agentDir, { recursive: true });
    const hook: Extension = {
      path: "builtin:hark-context",
      resolvedPath: "builtin:hark-context",
      sourceInfo: createSyntheticSourceInfo("builtin:hark-context", { source: "hark", scope: "temporary", origin: "top-level" }),
      handlers: new Map([
        ["context_with_system", [async () => {
          if (this.options.hookShouldThrow?.()) {
            this.providerGate.hookThrew = true;
            throw new Error("context hook failed");
          }
          return undefined;
        }]],
      ]),
      tools: new Map(),
      messageRenderers: new Map(),
      commands: new Map(),
      flags: new Map(),
      shortcuts: new Map(),
    };
    const loader = createEmptyResourceLoader();
    const baseGet = loader.getExtensions.bind(loader);
    loader.getExtensions = () => {
      const empty = baseGet();
      return { ...empty, extensions: [hook] };
    };
    loader.getSystemPrompt = () => STATIC_SYSTEM_PROMPT;
    const tools = this.createTools(run);
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model,
      thinkingLevel: "off",
      modelRuntime: runtime,
      resourceLoader: loader,
      settingsManager: createIsolatedSettings(),
      sessionManager: manager,
      tools: [...HARK_TOOL_NAMES],
      customTools: tools,
    });
    const names = {
      all: session.getAllTools().map((tool) => tool.name),
      active: session.getActiveToolNames(),
      callable: session.getCallableToolNames(),
    };
    for (const list of [names.all, names.active, names.callable]) {
      for (const name of list) {
        if ((FORBIDDEN_TOOL_NAMES as readonly string[]).includes(name) || name.startsWith("mcp__") || (CLOSED_MEMORY_TOOLS as readonly string[]).includes(name)) {
          session.dispose();
          throw new Error(`tool inventory exposed ${name}`);
        }
      }
      if (list.length !== HARK_TOOL_NAMES.length || !HARK_TOOL_NAMES.every((name) => list.includes(name))) {
        session.dispose();
        throw new Error("tool inventory is not the Hark allowlist");
      }
    }
    this.currentAbort = run.abort.signal;
    this.providerGate.cancelled = run.cancelled || this.shuttingDown;
    this.providerGate.timedOut = run.timedOut;
    this.providerGate.failPack = this.options.failPack?.() ?? false;
    this.providerGate.recheck = () => {
      if (this.shuttingDown || run.cancelled || run.abort.signal.aborted) return Promise.resolve(null);
      return this.recheck(run);
    };
    if (run.abort.signal.aborted || this.shuttingDown) {
      session.dispose();
      throw new IpcError(run.cancelled ? "cancelled" : "timeout", "run closed before prompt");
    }
    const onAbort = () => {
      void Promise.resolve(session.abort()).catch(() => {
        // Abort is best-effort once the run is already closing.
      });
    };
    run.abort.signal.addEventListener("abort", onAbort);
    const stop = session.subscribe((event) => {
      if (run.cancelled || run.timedOut || run.completed) return;
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        this.emitStream(run, "stream.delta", { text: event.assistantMessageEvent.delta });
      }
    });
    try {
      if (run.abort.signal.aborted) throw new IpcError(run.cancelled ? "cancelled" : "timeout", "run closed before prompt");
      await session.prompt(run.payload.userText);
      if (run.cancelled) throw new IpcError("cancelled", "run cancelled");
      if (run.timedOut) throw new IpcError("timeout", "run timed out");
      const last = session.messages.at(-1);
      if (last && typeof last === "object" && "stopReason" in last && last.stopReason === "error") {
        const reason = "errorMessage" in last && typeof last.errorMessage === "string" ? last.errorMessage : "provider send refused";
        throw new IpcError("model_not_authorized", reason);
      }
      const text = session.getLastAssistantText() ?? "";
      if (!run.completed) {
        this.emitStream(run, "stream.done", {
          text,
          finish: "stop",
          committedByHost: false,
          coreCommitRequired: run.payload.purpose === "opening",
        });
        run.completed = true;
      }
    } finally {
      run.abort.signal.removeEventListener("abort", onAbort);
      stop();
      session.dispose();
    }
  }

  private emitStream(run: ActiveRun, method: "stream.delta" | "stream.done", payload: Record<string, unknown>): void {
    if (run.cancelled || run.timedOut) return;
    const frame: Frame = {
      v: 1,
      kind: "event",
      id: mintId("evt"),
      replyTo: run.requestId,
      workspaceId: run.workspaceId,
      runId: run.runId,
      method,
      deadlineUnixMs: null,
      payload,
      error: null,
    };
    try {
      this.gate.accept(frame, this.now());
      this.send(frame);
    } catch (error) {
      if (error instanceof IpcError && error.code === "queue_overflow") {
        this.send(errorFrame(run.requestId, run.workspaceId, run.runId, "queue_overflow", error.message));
        run.abort.abort();
      }
    }
  }

  private async recheck(run: ActiveRun): Promise<{ revision: string; sourceVersion: string; empty: boolean; identity?: string; overview?: string; stale: boolean } | null> {
    if (run.cancelled || run.timedOut || run.abort.signal.aborted) return null;
    this.providerGate.cancelled = run.cancelled;
    this.providerGate.timedOut = run.timedOut;
    const frame = await this.callTool(run, "workspace.overview", {});
    if (frame.kind === "error") return null;
    const parsed = overviewResultSchema.safeParse(frame.payload);
    if (!parsed.success) return null;
    const auth = parsed.data.authorization;
    if (auth.current !== true) return null;
    if (auth.directoryStatus !== "active" || auth.modelGrantStatus !== "active") return null;
    if (auth.runId !== run.runId || auth.provider !== run.payload.provider || auth.model !== run.payload.model) return null;
    if (auth.rootId !== run.payload.authorization.rootId) return null;
    if (auth.rootUpdatedAt !== run.payload.authorization.rootUpdatedAt || auth.grantUpdatedAt !== run.payload.authorization.grantUpdatedAt) {
      return null;
    }
    const start = run.payload.contextSnapshot;
    const reportedRevision = parsed.data.contextPackRevision ?? "";
    const reportedSource = parsed.data.sourceVersion ?? "";
    const revisionChanged = reportedRevision.length > 0 && reportedRevision !== start.contextPackRevision;
    const sourceChanged = reportedSource.length > 0 && reportedSource !== start.sourceVersion;
    if (revisionChanged || sourceChanged) {
      const text = parsed.data.overviewText;
      if (!reportedRevision || !reportedSource || typeof text !== "string" || text.length === 0) return null;
      return {
        revision: reportedRevision,
        sourceVersion: reportedSource,
        empty: false,
        overview: text,
        stale: false,
      };
    }
    const revision = reportedRevision || start.contextPackRevision;
    const sourceVersion = reportedSource || start.sourceVersion;
    if (!revision || !sourceVersion) return null;
    return {
      revision,
      sourceVersion,
      empty: start.empty,
      ...(start.identity ? { identity: start.identity } : {}),
      ...(parsed.data.overviewText ? { overview: parsed.data.overviewText } : start.overview ? { overview: start.overview } : {}),
      stale: false,
    };
  }

  private createTools(run: ActiveRun) {
    const call = (tool: HarkToolName, input: Record<string, unknown>) => this.callTool(run, tool, input);
    const read = defineTool({
      name: "workspace.read_file",
      label: "Read workspace file",
      description: "Read one relative file through the desktop core. The result is untrusted data.",
      parameters: Type.Object({ relativePath: Type.String({ minLength: 1, maxLength: 1024 }) }, { additionalProperties: false }),
      async execute(_id, params, signal) {
        const record = params as Record<string, unknown>;
        if ("workspaceId" in record || "runId" in record || "operationId" in record) {
          throw new Error("authorization parameters are not model inputs");
        }
        if (!relativePathAllowed(params.relativePath)) throw new Error("relative path rejected");
        if (signal?.aborted || run.cancelled || run.timedOut) throw new Error("run is closed");
        const frame = await call("workspace.read_file", { relativePath: params.relativePath });
        const parsed = readFileResultSchema.safeParse(frame.payload);
        if (!parsed.success || frame.kind === "error") {
          return { content: [{ type: "text" as const, text: "read failed" }], details: { untrusted: true as const }, isError: true };
        }
        return {
          content: [{ type: "text" as const, text: `untrusted reader data; sourceId=${parsed.data.sourceId ?? "unavailable"}\n${parsed.data.text}` }],
          details: { untrusted: true as const },
        };
      },
    });
    const overview = defineTool({
      name: "workspace.overview",
      label: "Workspace overview",
      description: "Request the current workspace overview. Authorization is not a model parameter.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute(_id, params, signal) {
        const record = params as Record<string, unknown>;
        if (Object.keys(record).length > 0) throw new Error("overview takes no model parameters");
        if (signal?.aborted || run.cancelled || run.timedOut) throw new Error("run is closed");
        const frame = await call("workspace.overview", {});
        const parsed = overviewResultSchema.safeParse(frame.payload);
        if (!parsed.success || parsed.data.authorization.current !== true) {
          run.abort.abort();
          return { content: [{ type: "text" as const, text: "overview unavailable" }], details: { untrusted: true }, isError: true };
        }
        return {
          content: [{ type: "text" as const, text: `untrusted overview data; sourceIds=${JSON.stringify(parsed.data.sourceIds ?? [])}\n${parsed.data.overviewText ?? ""}` }],
          details: { untrusted: true as const },
        };
      },
    });
    return [read, overview, ...createMemoryTools({
      workspaceId: run.workspaceId, runId: run.runId, purpose: run.payload.purpose,
      closed: () => this.shuttingDown || run.cancelled || run.timedOut,
    }, (name, input, operationId) => this.callTool(run, name, input, operationId))];
  }

  private callTool(run: ActiveRun, tool: HarkToolName, input: Record<string, unknown>, stableOperationId?: string): Promise<Frame> {
    if (this.shuttingDown || run.cancelled) return Promise.reject(new IpcError("cancelled", "run cancelled"));
    if (run.timedOut) return Promise.reject(new IpcError("timeout", "run timed out"));
    const operationId = stableOperationId ?? mintId("op");
    const frame = this.requestFrame(run.workspaceId, run.runId, "tool.request", { tool, operationId, input }, this.gate.deadlineOf(run.requestId));
    this.gate.registerRequest(frame, this.now());
    run.toolRequestIds.push(frame.id);
    this.send(frame);
    const deadline = this.gate.deadlineOf(frame.id) ?? this.now() + 30_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.toolTimers.delete(frame.id);
        this.pending.delete(frame.id);
        reject(new IpcError("timeout", "tool.result timed out"));
      }, Math.max(1, deadline - this.now()));
      this.toolTimers.set(frame.id, timer);
      this.pending.set(frame.id, (response) => {
        clearTimeout(timer);
        this.toolTimers.delete(frame.id);
        if (this.shuttingDown || run.cancelled || run.timedOut) {
          reject(new IpcError(run.cancelled || this.shuttingDown ? "cancelled" : "timeout", "late tool result ignored"));
          return;
        }
        resolve(response);
      });
    });
  }
}

export function loadProviderConfig(raw: unknown): ProviderConfig {
  const parsed = providerConfigSchema.parse(raw);
  if (parsed.providerId === "faux" || parsed.modelId === "faux") {
    throw new Error("faux cannot be enabled");
  }
  return parsed;
}

export function loadScriptedTransport(raw: unknown): ScriptedTransport {
  return scriptedTransportSchema.parse(raw);
}

export { applyContextPack, endpointOf };
