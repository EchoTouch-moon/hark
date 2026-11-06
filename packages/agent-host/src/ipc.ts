import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const require = createRequire(import.meta.url);
const limitsJson = require("../../../contracts/ipc-v1.limits.json") as {
  version: number;
  maxFrameBytes: number;
  maxStreamQueue: number;
  maxControlQueue: number;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
};

export const IPC_LIMITS = limitsJson;

const ID_PREFIX =
  "req|evt|err|ws|run|root|src|msg|scan|cand|op|tool|grant|agt|conv|onb";
export const idSchema = z.string().regex(new RegExp(`^(${ID_PREFIX})_[0-9a-f]{32}$`));

export function mintId(prefix: "req" | "evt" | "err" | "op"): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

const errorBodySchema = z
  .object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
  })
  .strict();

export const frameSchema = z
  .object({
    v: z.literal(1),
    kind: z.enum(["request", "response", "event", "error"]),
    id: idSchema,
    replyTo: idSchema.nullable(),
    workspaceId: z.string().regex(/^ws_[0-9a-f]{32}$/).nullable(),
    runId: z.string().regex(/^run_[0-9a-f]{32}$/).nullable(),
    method: z.string().min(1).max(128),
    deadlineUnixMs: z.number().int().nonnegative().nullable(),
    payload: z.record(z.string(), z.unknown()),
    error: errorBodySchema.nullable(),
  })
  .strict()
  .superRefine((frame, ctx) => {
    if (frame.kind === "request") {
      if (!frame.id.startsWith("req_")) ctx.addIssue({ code: "custom", message: "request id" });
      if (frame.error) ctx.addIssue({ code: "custom", message: "request cannot carry error" });
    }
    if (frame.kind === "response") {
      if (!frame.id.startsWith("req_")) ctx.addIssue({ code: "custom", message: "response id" });
      if (frame.replyTo !== frame.id) ctx.addIssue({ code: "custom", message: "response id must echo the request" });
    }
    if (frame.kind === "event" && !frame.id.startsWith("evt_")) {
      ctx.addIssue({ code: "custom", message: "event id" });
    }
    if (frame.kind === "error") {
      if (!frame.id.startsWith("err_")) ctx.addIssue({ code: "custom", message: "error id" });
      if (!frame.error) ctx.addIssue({ code: "custom", message: "error frame requires error body" });
    }
  });

export type Frame = z.infer<typeof frameSchema>;

export class IpcError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "IpcError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function errorFrame(replyTo: string | null, workspaceId: string | null, runId: string | null, code: string, message: string): Frame {
  return {
    v: 1,
    kind: "error",
    id: mintId("err"),
    replyTo,
    workspaceId,
    runId,
    method: "error",
    deadlineUnixMs: null,
    payload: {},
    error: {
      code,
      message,
      retryable: code === "timeout" || code === "queue_overflow",
    },
  };
}

export function encodeFrame(frame: Frame): Buffer {
  const parsed = frameSchema.safeParse(frame);
  if (!parsed.success) throw new IpcError("invalid_frame", "refusing to encode an invalid frame");
  const bytes = Buffer.from(JSON.stringify(parsed.data), "utf8");
  if (bytes.includes(0x0a) || bytes.includes(0x0d)) {
    throw new IpcError("invalid_frame", "frame contains a newline");
  }
  if (bytes.length > IPC_LIMITS.maxFrameBytes) {
    throw new IpcError("frame_too_large", String(bytes.length));
  }
  return Buffer.concat([bytes, Buffer.from("\n")]);
}

export class NdjsonParser {
  private buf = Buffer.alloc(0);
  private failed = false;

  push(input: Buffer): Frame[] {
    if (this.failed) throw new IpcError("invalid_frame", "parser needs resync");
    this.buf = Buffer.concat([this.buf, input]);
    const out: Frame[] = [];
    while (true) {
      const pos = this.buf.indexOf(0x0a);
      if (pos === -1) {
        if (this.buf.length > IPC_LIMITS.maxFrameBytes) {
          this.buf = Buffer.alloc(0);
          this.failed = true;
          throw new IpcError("frame_too_large", "line exceeded max frame before newline");
        }
        break;
      }
      let line = this.buf.subarray(0, pos);
      this.buf = this.buf.subarray(pos + 1);
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      if (line.length === 0) continue;
      if (line.length > IPC_LIMITS.maxFrameBytes) {
        this.failed = true;
        throw new IpcError("frame_too_large", String(line.length));
      }
      let json: unknown;
      try {
        json = JSON.parse(line.toString("utf8"));
      } catch {
        this.failed = true;
        throw new IpcError("invalid_frame", "frame is not json");
      }
      const parsed = frameSchema.safeParse(json);
      if (!parsed.success) {
        this.failed = true;
        throw new IpcError("invalid_frame", "frame schema rejected");
      }
      out.push(parsed.data);
    }
    return out;
  }

  get closed(): boolean {
    return this.failed;
  }
}

interface Outstanding {
  workspaceId: string | null;
  runId: string | null;
  cancelled: boolean;
  deadlineUnixMs: number | null;
}

export class CorrelationGate {
  private readonly outstanding = new Map<string, Outstanding>();
  private readonly seen = new Set<string>();

  registerRequest(frame: Frame, nowUnixMs: number): void {
    if (frame.kind !== "request") throw new IpcError("invalid_frame", "only requests are registered");
    if (this.seen.has(frame.id) || this.outstanding.has(frame.id)) {
      throw new IpcError("correlation_rejected", "duplicate request id");
    }
    const deadline = frame.deadlineUnixMs ?? nowUnixMs + IPC_LIMITS.defaultTimeoutMs;
    if (deadline - nowUnixMs > IPC_LIMITS.maxTimeoutMs) {
      throw new IpcError("invalid_frame", "deadline exceeds max timeout");
    }
    this.seen.add(frame.id);
    this.outstanding.set(frame.id, {
      workspaceId: frame.workspaceId,
      runId: frame.runId,
      cancelled: false,
      deadlineUnixMs: deadline,
    });
  }

  cancel(requestId: string): void {
    const slot = this.outstanding.get(requestId);
    if (!slot) throw new IpcError("correlation_rejected", "unknown request");
    slot.cancelled = true;
  }

  deadlineOf(requestId: string): number | null {
    return this.outstanding.get(requestId)?.deadlineUnixMs ?? null;
  }

  accept(frame: Frame, nowUnixMs: number): void {
    const deadline = frame.deadlineUnixMs ?? this.outstanding.get(frame.replyTo ?? frame.id)?.deadlineUnixMs;
    if (deadline !== undefined && deadline !== null && nowUnixMs > deadline) {
      throw new IpcError("timeout", "frame deadline exceeded");
    }
    if (frame.kind === "request" && frame.replyTo === null) return;
    const key = frame.replyTo ?? frame.id;
    const slot = this.outstanding.get(key);
    if (!slot) throw new IpcError("correlation_rejected", "reply does not match an outstanding request");
    if (slot.cancelled) throw new IpcError("cancelled", "request was cancelled");
    if (slot.workspaceId && frame.workspaceId && slot.workspaceId !== frame.workspaceId) {
      throw new IpcError("workspace_mismatch", "cross-workspace reply rejected");
    }
    if (slot.runId && frame.runId && slot.runId !== frame.runId) {
      throw new IpcError("run_mismatch", "cross-run reply rejected");
    }
    if (frame.workspaceId === null && slot.workspaceId && frame.kind !== "request") {
      throw new IpcError("workspace_mismatch", "reply dropped workspace binding");
    }
  }
}

const STREAM_METHODS = new Set(["stream.delta", "stream.done"]);

export class SideQueues {
  private readonly control: Frame[] = [];
  private readonly stream: Frame[] = [];

  tryPush(frame: Frame): void {
    const stream = STREAM_METHODS.has(frame.method);
    const queue = stream ? this.stream : this.control;
    const cap = stream ? IPC_LIMITS.maxStreamQueue : IPC_LIMITS.maxControlQueue;
    if (queue.length >= cap) throw new IpcError("queue_overflow", stream ? "stream" : "control", true);
    queue.push(frame);
  }

  pop(): Frame | undefined {
    return this.control.shift() ?? this.stream.shift();
  }

  get controlLen(): number {
    return this.control.length;
  }

  get streamLen(): number {
    return this.stream.length;
  }

  dropStream(): void {
    this.stream.length = 0;
  }
}

export function redactText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 6) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [redacted]");
}
