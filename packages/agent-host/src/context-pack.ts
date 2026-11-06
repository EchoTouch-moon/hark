import type { Message } from "@earendil-works/pi-ai";
import type { ContextSnapshot } from "./dto.ts";

/** Copied from Pi 1.5.0 messages.js. A test asserts SessionManager compaction text still starts with this. */
export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;
export const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:

<summary>
`;

export const PACK_SECTION = "hark.context_pack";

export function renderContextPack(snapshot: ContextSnapshot, stale: boolean): string {
  const lines = [
    "Hark request context pack. This is not a user message and not a current-fact source by itself.",
    `revision: ${snapshot.contextPackRevision}`,
    `sourceVersion: ${snapshot.sourceVersion}`,
    `empty: ${snapshot.empty ? "true" : "false"}`,
  ];
  if (snapshot.empty) {
    lines.push("Memory engine is not available. No long-term facts were supplied.");
  }
  if (snapshot.identity) lines.push(`identity: ${snapshot.identity}`);
  if (snapshot.overview) lines.push(`overview: ${snapshot.overview}`);
  if (stale) {
    lines.push("A prior compaction or snapshot is not the current source. Use this revision only.");
  }
  return lines.join("\n");
}

function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

export function isUntrustedSummaryMessage(message: Message): boolean {
  const text = messageText(message);
  return text.startsWith(COMPACTION_SUMMARY_PREFIX) || text.startsWith(BRANCH_SUMMARY_PREFIX);
}

/**
 * Request-only rewrite. Does not append a user message.
 * Keeps the leading system message and its tool declarations.
 */
export function applyContextPack(messages: readonly Message[], packText: string): Message[] {
  const kept = messages.filter((message) => !isUntrustedSummaryMessage(message));
  const systemIndex = kept.findIndex((message) => message.role === "system" && (message.toolsAdded?.length ?? 0) > 0);
  const head = systemIndex >= 0 ? kept[systemIndex] : undefined;
  if (!head || head.role !== "system" || !head.toolsAdded || head.toolsAdded.length === 0) {
    throw new Error("context pack refused: system tool declarations are missing");
  }
  const rewritten = {
    ...head,
    sections: { ...(head.sections ?? {}), [PACK_SECTION]: packText },
  };
  const rest = kept.filter((_, index) => index !== systemIndex).filter((message) => {
    if (message.role !== "system") return true;
    return !messageText(message).includes("Hark request context pack");
  });
  return [rewritten, ...rest];
}
