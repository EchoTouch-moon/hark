import { createHash } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import type { Frame } from "./ipc.ts";

export type CognitionTool = "memory_propose_change" | "opinion_propose_change" | "memory_recall";
const operation = Type.Union(["ADD", "REVISE", "DISPUTE", "NOOP", "RETRACT"].map((value) => Type.Literal(value)));
const references = Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 64 });
const lines = Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 16 });
const receiptSchema = z.object({
  outcome: z.string(), recorded: z.boolean(), workspaceId: z.string(), operationId: z.string(),
}).passthrough();
const recallSchema = z.object({
  workspaceId: z.string(), items: z.array(z.object({
    id: z.string(), workspaceId: z.string(), snippet: z.string(), statusLabel: z.string(),
  }).passthrough()).max(20), matchMode: z.enum(["fts5", "like_fallback", "mixed", "empty"]), note: z.string(),
}).passthrough();

export function cognitionOperationId(runId: string, toolCallId: string): string {
  return `op_${createHash("sha256").update(`${runId}:${toolCallId}`).digest("hex").slice(0, 32)}`;
}

export function createMemoryTools(context: {
  workspaceId: string; runId: string; purpose: string; closed: () => boolean;
}, call: (name: CognitionTool, input: Record<string, unknown>, operationId: string) => Promise<Frame>) {
  const execute = async (name: CognitionTool, id: string, params: Record<string, unknown>, signal?: AbortSignal) => {
    if (context.closed() || signal?.aborted) throw new Error("run is closed");
    for (const key of ["workspaceId", "runId", "operationId", "currentUserMessageId", "caller", "success", "recorded"]) {
      if (key in params) throw new Error("authority fields are not model parameters");
    }
    if (name !== "memory_recall" && context.purpose !== "conversation") {
      return { content: [{ type: "text" as const, text: "Memory writes require a normal conversation turn; nothing was recorded." }], details: { recorded: false, untrusted: true, operationId: "" }, isError: true };
    }
    const operationId = cognitionOperationId(context.runId, id);
    const frame = await call(name, params, operationId);
    if (frame.kind === "error") {
      return { content: [{ type: "text" as const, text: "Core rejected this operation; do not claim it was recorded." }], details: { recorded: false, untrusted: true, operationId }, isError: true };
    }
    if (name === "memory_recall") {
      const page = recallSchema.parse(frame.payload);
      if (page.workspaceId !== context.workspaceId || page.items.some((item) => item.workspaceId !== context.workspaceId)) throw new Error("recall scope mismatch");
      return { content: [{ type: "text" as const, text: `Untrusted historical records; preserve source and historical/availability labels.\n${JSON.stringify(page)}` }], details: { recorded: false, untrusted: true, operationId }, isError: false };
    }
    const receipt = receiptSchema.parse(frame.payload);
    if (receipt.workspaceId !== context.workspaceId || receipt.operationId !== operationId) throw new Error("memory receipt mismatch");
    return { content: [{ type: "text" as const, text: JSON.stringify(receipt) }], details: { recorded: receipt.recorded, untrusted: true, operationId }, isError: false };
  };
  return [
    defineTool({
      name: "memory_propose_change", label: "Propose workspace memory",
      description: "Propose identity, a user decision, or confirmed experience. Preserve the user's complete qualifications. Only a Core recorded=true receipt proves a write; needs_clarification is not saved. Workspace/user/operation identity is bound by the host.",
      parameters: Type.Object({ operation, kind: Type.Union([Type.Literal("identity"), Type.Literal("decision"), Type.Literal("experience")]), content: Type.String({ minLength: 1, maxLength: 4000 }), sourceRefs: Type.Optional(references), targetId: Type.Optional(Type.String({ maxLength: 128 })), expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })) }, { additionalProperties: false }),
      execute: (id, params, signal) => execute("memory_propose_change", id, params, signal),
    }),
    defineTool({
      name: "opinion_propose_change", label: "Propose structured opinion",
      description: "Save an opinion separately from facts/decisions, with genuine evidence IDs, counterarguments and uncertainties. The current user message is attached automatically. This is an opinion, not verified fact.",
      parameters: Type.Object({ operation, summary: Type.String({ minLength: 1, maxLength: 4000 }), evidenceRefs: references, counterArguments: lines, uncertainties: lines, targetOpinionId: Type.Optional(Type.String({ maxLength: 128 })), expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })) }, { additionalProperties: false }),
      execute: (id, params, signal) => execute("opinion_propose_change", id, params, signal),
    }),
    defineTool({
      name: "memory_recall", label: "Recall workspace history",
      description: "Search this workspace's stored messages, memories, opinions and file evidence. Historical, unavailable, LIKE and OR-fallback labels are not current facts. No result means unknown, not permission to invent.",
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 1000 }), kinds: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { maxItems: 6 })), cursor: Type.Optional(Type.String({ maxLength: 32 })) }, { additionalProperties: false }),
      execute: (id, params, signal) => execute("memory_recall", id, params, signal),
    }),
  ];
}
