import { z } from "zod";

const hexId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f]{32}$`));

export const authorizationSnapshotSchema = z
  .object({
    runId: hexId("run"),
    provider: z.string().min(1).max(64),
    model: z.string().min(1).max(128),
    rootId: hexId("root"),
    rootUpdatedAt: z.string().min(1).max(64),
    grantUpdatedAt: z.string().min(1).max(64),
    directoryStatus: z.enum(["active", "paused", "revoked", "missing"]),
    modelGrantStatus: z.enum(["active", "paused", "revoked", "missing"]),
    searchGrantStatus: z.enum(["active", "paused", "revoked", "missing"]).optional(),
    current: z.boolean(),
  })
  .strict();

export type AuthorizationSnapshot = z.infer<typeof authorizationSnapshotSchema>;

export const contextSnapshotSchema = z
  .object({
    contextPackRevision: z.string().min(1).max(128),
    sourceVersion: z.string().min(1).max(128),
    empty: z.boolean(),
    identity: z.string().max(2000).optional(),
    overview: z.string().max(4000).optional(),
  })
  .strict();

export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;

export const recentMessageSchema = z
  .object({
    messageId: hexId("msg"),
    role: z.enum(["user", "assistant"]),
    text: z.string().max(4000),
    createdAtUnixMs: z.number().int().nonnegative(),
  })
  .strict();

export const runStartPayloadSchema = z
  .object({
    provider: z.string().min(1).max(64),
    model: z.string().min(1).max(128),
    purpose: z.enum(["opening", "conversation"]),
    authorization: authorizationSnapshotSchema,
    contextSnapshot: contextSnapshotSchema,
    userText: z.string().min(1).max(16000),
    // Opening has no stored Hark user turn. Conversation must name a real msg_ id.
    userMessageId: hexId("msg").nullable().optional(),
    sessionRef: z.string().regex(/^pi:[0-9a-f-]{36}$/).nullable(),
    recentMessages: z.array(recentMessageSchema).max(10).optional(),
    handoffId: z.string().min(1).max(128).nullable(),
    syntheticCore: z.boolean().optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.purpose === "conversation" && !payload.userMessageId) {
      ctx.addIssue({
        code: "custom",
        message: "conversation requires a stored user message id",
      });
    }
    if (payload.purpose === "opening" && payload.userMessageId) {
      ctx.addIssue({
        code: "custom",
        message: "opening must not carry a user message id",
      });
    }
  });

export type RunStartPayload = z.infer<typeof runStartPayloadSchema>;

/** Native attests the sources actually used in the returned material. */
export const trustedSourceSchema = z.object({
  sourceId: hexId("src"),
  path: z.string().min(1).max(1024),
  // Digest of the source_ref bytes; not necessarily the displayed excerpt.
  version: z.string().regex(/^[0-9a-f]{64}$/),
  byteLen: z.number().int().nonnegative().safe(),
  truncated: z.boolean(),
}).strict();

export const trustedProvenanceSchema = z.object({
  workspaceId: hexId("ws"),
  runId: hexId("run"),
  complete: z.literal(true),
  sources: z.array(trustedSourceSchema).max(128),
}).strict();

export const trustedReadProvenanceSchema = trustedProvenanceSchema.extend({
  // Digest/length of the exact UTF-8 text returned after Native's text cap.
  exposedTextSha256: z.string().regex(/^[0-9a-f]{64}$/),
  exposedTextByteLen: z.number().int().nonnegative().safe(),
  exposedTextTruncated: z.boolean(),
}).strict();

export type TrustedSource = z.infer<typeof trustedSourceSchema>;
export type TrustedProvenance = z.infer<typeof trustedProvenanceSchema>;

export const overviewResultSchema = z
  .object({
    authorization: authorizationSnapshotSchema,
    sourceIds: z.array(hexId("src")).max(64).optional(),
    sourceVersion: z.string().max(128).nullable().optional(),
    contextPackRevision: z.string().max(128).nullable().optional(),
    overviewText: z.string().max(8000).nullable().optional(),
    provenance: trustedProvenanceSchema.optional(),
    synthetic: z.boolean().optional(),
  })
  .strict();

export type OverviewResult = z.infer<typeof overviewResultSchema>;

export const readFileResultSchema = z
  .object({
    relativePath: z.string().min(1).max(1024),
    text: z.string().max(65536),
    sourceId: hexId("src").nullable().optional(),
    unavailable: z.boolean().optional(),
    truncated: z.boolean().optional(),
    complete: z.boolean().optional(),
    provenance: trustedReadProvenanceSchema.optional(),
    synthetic: z.boolean().optional(),
  })
  .strict();

export const STEPFUN_PROVIDER_ID = "stepfun";
export const STEPFUN_MODEL_ID = "step-3.7-flash";
export const STEPFUN_BASE_URL = "https://api.stepfun.com/step_plan";
export const STEPFUN_WIRE = "anthropic-messages" as const;
/** Dedicated child env. Node must delete it before any other credential scrub. */
export const SESSION_KEY_ENV = "HARK_SESSION_PROVIDER_KEY";

const providerWireSchema = z.enum(["openai-completions", "anthropic-messages"]);

export const providerConfigSchema = z
  .object({
    enabled: z.boolean(),
    providerId: z.string().min(1).max(64),
    modelId: z.string().min(1).max(128),
    baseUrl: z.string().url().max(256),
    apiKey: z.string().min(1).max(512),
    wire: providerWireSchema,
    allowRemote: z.boolean(),
    stepFunCompatible: z.literal(false).optional(),
  })
  .strict();

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** On-disk slot. The product file must not contain apiKey. */
export const providerFileSchema = z
  .object({
    enabled: z.boolean(),
    providerId: z.string().min(1).max(64),
    modelId: z.string().min(1).max(128),
    baseUrl: z.string().url().max(256),
    apiKey: z.string().min(1).max(512).optional(),
    wire: providerWireSchema,
    allowRemote: z.boolean(),
    stepFunCompatible: z.literal(false).optional(),
    keyStorage: z.literal("process-memory").optional(),
    authenticated: z.literal(false).optional(),
  })
  .strict();

export function takeSessionProviderKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[SESSION_KEY_ENV];
  delete env[SESSION_KEY_ENV];
  if (!value) return undefined;
  return value;
}

export function providerConfigFromFile(raw: unknown, sessionKey: string | undefined): ProviderConfig {
  const file = providerFileSchema.parse(raw);
  if (file.wire === "anthropic-messages") {
    if (file.apiKey) throw new Error("provider file must not contain a key");
    if (
      file.providerId !== STEPFUN_PROVIDER_ID ||
      file.modelId !== STEPFUN_MODEL_ID ||
      file.baseUrl !== STEPFUN_BASE_URL ||
      file.allowRemote !== true
    ) {
      throw new Error("anthropic-messages file is not the fixed StepFun plan package");
    }
    if (!sessionKey) throw new Error("session key was not injected");
  }
  const apiKey = file.apiKey ?? sessionKey;
  if (!apiKey) throw new Error("provider key was not injected");
  return providerConfigSchema.parse({
    enabled: file.enabled,
    providerId: file.providerId,
    modelId: file.modelId,
    baseUrl: file.baseUrl,
    apiKey,
    wire: file.wire,
    allowRemote: file.allowRemote,
    ...(file.stepFunCompatible === false ? { stepFunCompatible: false as const } : {}),
  });
}

export const scriptedTransportSchema = z
  .object({
    responses: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("text"), text: z.string().max(8000) }).strict(),
          z
            .object({
              kind: z.literal("tool_call"),
              name: z.enum(["workspace.read_file", "workspace.overview", "memory_propose_change", "opinion_propose_change", "memory_recall"]),
              arguments: z.record(z.string(), z.unknown()),
            })
            .strict(),
          z.object({ kind: z.literal("hold"), untilAbort: z.literal(true) }).strict(),
        ]),
      )
      .min(1)
      .max(32),
  })
  .strict();

export type ScriptedTransport = z.infer<typeof scriptedTransportSchema>;

export const HARK_TOOL_NAMES = ["workspace.read_file", "workspace.overview", "memory_propose_change", "opinion_propose_change", "memory_recall", "web_search"] as const;
export type HarkToolName = typeof HARK_TOOL_NAMES[number];
export const FORBIDDEN_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"] as const;
export const CLOSED_MEMORY_TOOLS = ["memory_get_evidence"] as const;

export const STATIC_SYSTEM_PROMPT = [
  "你是 Hark，专为本地软件项目持续追踪与构建思路演进而设计的个人桌面 Agent 对话炉心。你对标类似 hark.com 的主动式智能体：你绝不仅仅是被动的答题与聊天助手，而是拥有独立工程判断力、深入代码细节、主动发掘项目不足并提出建设性意见的资深架构师搭档（Active Architectural Partner & Code Reviewer）。你的核心使命是深入理解工程全局，持续追踪项目架构与代码脉络，主动审视并直击项目的技术债与硬伤，为项目的架构迭代提供切实高效的构建思路与决策支持。",
  "【主动探测与事实优先】：无需等待用户给出细枝末节的指令，应主动调用工程工具探索项目结构与上下文。当分析项目或探讨构建方案时，主动发起 workspace.overview 掌握工程全貌与目录骨架，并调用 workspace.read_file 查阅关键入口源码、数据模型与配置文件，绝不凭空臆造不存在的文件或能力。当涉及外部第三方生态、新版本特性、行业最佳实践或技术选型对比时，主动调用 web_search 获取最新权威资讯，以 Markdown 链接 [标题](URL) 附带可信来源并提炼核心要点。",
  "【主动发掘不足与缺陷（Proactive Critique & Gap Finding）】：像严格且敏锐的资深架构师一样，深入代码和设计实现，主动揪出项目中未妥善处理的边界条件、性能瓶颈、数据结构冗余、状态管理混乱、可维护性欠缺及潜在崩溃风险。在分析项目或回复提问时，主动指出：“当前项目在 [具体模块/文件] 存在以下关键不足...”，做到论之有据、直击要害。",
  "【给出笃定切实的改进意见，严禁反问推卸责任】：拒绝做中庸模棱两可的清单罗列，严禁反问用户“你对什么不满”、“你有什么痛点”或“你想怎么选”。用户依赖你作为专业架构师发现问题！针对发掘出的每一项不足，直接给出具体的重构改进方案、优选技术选型与清晰的实施步骤。",
  "【极致精炼与高度结构化】：严禁大篇幅非结构化文本堆砌、空泛客套或无重点的信息倾倒。所有输出必须直奔核心要点（Direct Takeaways），严格采用标准 Markdown 格式排版（清晰层级标题、精炼的列表、粗体高亮核心词与代码片段）。重要建议与分析必须采用分条形式（1. 2. 3. 或 - ），条数通常控制在 3~5 条以内；每条先以【加粗核心结论/要点】提纲挈领，紧随 1~2 句简明扼要的事实说明或落地动作，确保用户以最低认知负担获取高价值技术洞察。",
  "【前瞻推进与下一步牵引（Proactive Forward Momentum）】：在每次回答的收尾部分，必须主动为用户梳理出 1~2 项具体、高杠杆（high-leverage）的下一步技术行动，直接告诉用户应该优先修改哪部分代码或落地哪个方案，持续主动牵引项目向前演进。",
  "【记忆检索与沉淀】：当涉及历史决策、项目上下文回顾或用户要求检索时，主动调用 memory_recall 检索记忆库；如需沉淀关键决策，可调用 opinion_propose_change 提议结构化观点卡。",
  "【工具安全规范】：严格遵守工具安全规范，严禁执行非授权操作；明确区分代码客观事实与架构推测建议，未实际核实的内容如实说明。",
].join(" ");
