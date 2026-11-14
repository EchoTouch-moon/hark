import type { ConversationMessage, MemoryReceiptData } from "./HarkBridge.ts";

/** Read-only artifacts from Core receipts, never new conversation evidence. */
export interface StoredMemoryReceipt {
  operationId: string; workspaceId: string; recorded: boolean; reverted: boolean;
  stillCurrent: boolean; currentStatus?: string | null;
  decisionTitle?: string | null; decisionSummary?: string | null;
  committedAt: string | null; revision: number | null; sourceMessageId?: string | null;
}

export function projectMemoryReceipts(
  messages: ConversationMessage[], receipts: StoredMemoryReceipt[], workspaceId: string, conversationId: string,
): ConversationMessage[] {
  const artifacts = receipts.filter((r) =>
    r.workspaceId === workspaceId && (r.recorded || r.reverted) && r.committedAt && Number.isInteger(r.revision)
  ).map((r): ConversationMessage => {
    const reverted = r.reverted || r.currentStatus === "retracted";
    const receipt: MemoryReceiptData = {
      operationId: r.operationId, workspaceId, revision: r.revision!, committedAt: r.committedAt!,
      decisionTitle: `${!r.stillCurrent && !reverted ? "历史写入 · " : ""}${r.decisionTitle ?? "项目记忆"}`,
      decisionSummary: r.decisionSummary ?? "以保存的 Core 修订为准", reverted,
      ...(r.sourceMessageId ? { sourceMessageId: r.sourceMessageId } : {}),
    };
    return {
      id: `receipt:${r.operationId}`, workspaceId, conversationId, role: "system_notice",
      kind: "memory_receipt", content: "持久化记忆收据（不是对话原文）", status: "persisted",
      persistedAt: r.committedAt!, memoryReceipt: receipt,
    };
  });
  const result: ConversationMessage[] = [];
  const placed = new Set<string>();
  for (const message of messages) {
    result.push(message);
    for (const artifact of artifacts) {
      if (artifact.memoryReceipt?.sourceMessageId === message.id && !placed.has(artifact.id)) {
        result.push(artifact); placed.add(artifact.id);
      }
    }
  }
  for (const artifact of artifacts) if (!placed.has(artifact.id)) result.push(artifact);
  return result;
}
