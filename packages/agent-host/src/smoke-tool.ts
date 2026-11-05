import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Name allowlist entry. Not a Core tool and not a built-in Pi tool. */
export const SMOKE_TOOL_NAME = "hark.smoke_noop";

export const FORBIDDEN_BUILTIN_TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "powershell",
] as const;

export function createSmokeNoopTool() {
  return defineTool({
    name: SMOKE_TOOL_NAME,
    label: "Smoke noop",
    description: "Capability-less isolated smoke tool. It does not read, write, spawn, or use the network.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: "noop" }],
        details: { capability: "none" as const },
      };
    },
  });
}
