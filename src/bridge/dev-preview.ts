import {
  AppEvent,
  AppSnapshot,
  ConfirmImportInput,
  ConfirmImportResult,
  ConversationId,
  ConversationMessage,
  CreateChildWorkspaceInput,
  CreateChildWorkspaceResult,
  EvidenceDetail,
  EvidenceRef,
  HarkBridge,
  ID,
  MemoryReceiptData,
  MemorySearchInput,
  MemorySearchPage,
  MessagePage,
  NarrativeState,
  OnboardingRun,
  OpinionFeedbackInput,
  OpinionView,
  RootPreview,
  RunId,
  RunStatus,
  RunStreamEvent,
  RuntimeStatus,
  SearchProviderConfig,
  SearchProviderType,
  StartAgentTurnInput,
  StartAgentTurnResult,
  WorkspaceDetail,
  WorkspaceId,
  WorkspacePermissions,
  WorkspacePermissionsUpdate,
  WorkspaceSummary,
} from "./HarkBridge";

/**
 * PRD §7.2 & §9.2:
 * DevPreviewBridge 仅用于显式开发预览（DEV PREVIEW / SYNTHETIC）。
 * 预览数据严格按照真实 DTO Schema 构造，支持模拟：
 * - 真实项目文件夹初扫与多项目候选（单项目 / Monorepo / 多候选拆分）
 * - 实时 Onboarding 阶段推进与 Agent 主动开场第一句话（或未授权 StepFun 时降级为 local_scan_card）
 * - 流式对话（runId + seq + tool_started + text_delta + memory_committed + run_completed）
 * - 结构化观点（OpinionView）、反例、不确定性与反馈回执
 * - 证据分级（file_read / git_observation / web_snippet 只见摘要 / web_fulltext 已读原文 / stale / unreadable）
 * - 记忆折页（MemoryFold）与历史检索
 * - 故障注入（Sidecar 失联、StepFun 未配置、来源过期等）
 */

const INITIAL_WORKSPACES: Record<WorkspaceId, WorkspaceDetail> = {
  "ws-hark-r1": {
    summary: {
      id: "ws-hark-r1",
      name: "Hark · 桌面炉心 R1",
      rootDisplayPath: "~/projects/hark-r1-desktop",
      lifecycle: "active",
      agentStatus: "idle",
      currentConversationId: "conv-hark-r1",
      lastObservedAt: "2026-11-05T18:20:00-08:00",
      overviewFreshness: "fresh",
      modelPermission: "enabled",
      searchPermission: "enabled",
      observerState: "active",
    },
    excludedPaths: ["node_modules/", "target/", ".git/objects/", "dist/"],
    readOnlyPaths: ["src/", "src-tauri/", "docs/", "Cargo.toml", "package.json", "NARRATIVE.md"],
    narrative: {
      availability: "known",
      flame: "gentle",
      stageLabel: "稳定小火 · 架构契约对齐中",
      narrativeReason: "已核验 Frontend PRD v1.0、NARRATIVE.md 与 Tauri 2 IPC 边界定义，存在 2 项有效观点与 1 条已入库架构决定。",
      basisRefs: ["ev-hark-prd", "ev-hark-narrative", "ev-hark-cargo"],
      observedAt: "2026-11-05T18:20:00-08:00",
      stale: false,
    },
    memoryFold: {
      id: "fold-hark-01",
      workspaceId: "ws-hark-r1",
      statement: "2026-10-31 叙事修订决定：废除按聊天条数与连续签到计算火势的旧规则，火光仅反映后端可核验的项目事实。",
      contextExcerpt: "在 docs/EMBER-STORY-SYSTEM.md 与 NARRATIVE.md 冲突裁决中，明确“对话即炉心”，没有可信叙事状态时一律回退至中性余光（neutral），不制造未登录负罪感。",
      recordedAt: "2026-10-31T21:15:00-08:00",
      sourceRefId: "ev-hark-narrative",
      sourceTitle: "NARRATIVE.md · 炉心叙事修订",
      validStatus: "active",
    },
  },
  "ws-pi-host": {
    summary: {
      id: "ws-pi-host",
      name: "Pi Agent Host Sidecar",
      rootDisplayPath: "~/projects/hark-r1-desktop/packages/agent-host",
      lifecycle: "active",
      agentStatus: "idle",
      currentConversationId: "conv-pi-host",
      lastObservedAt: "2026-11-05T17:45:00-08:00",
      overviewFreshness: "fresh",
      modelPermission: "enabled",
      searchPermission: "disabled",
      observerState: "active",
    },
    excludedPaths: ["node_modules/", "dist/", ".env.local"],
    readOnlyPaths: ["src/session.ts", "src/mcp-bridge.ts", "package.json"],
    parentWorkspaceId: "ws-hark-r1",
    narrative: {
      availability: "known",
      flame: "ember",
      stageLabel: "低伏微光 · 独立 Sidecar 空间",
      narrativeReason: "已从父项目拆分为独立子空间，当前联网搜索默认关闭，近期仅有本地会话协议核对。",
      basisRefs: ["ev-pi-session", "ev-pi-mcp"],
      observedAt: "2026-11-05T17:45:00-08:00",
      stale: false,
    },
    memoryFold: {
      id: "fold-pi-01",
      workspaceId: "ws-pi-host",
      statement: "Sidecar 进程不向 React 前端暴露任何端侧端口，所有流式事件必须经由 Rust Core 归一化为 RunStreamEvent。",
      contextExcerpt: "确保 API Key 与 MCP Server 连接完全隔离在宿主侧，前端仅消费具备 seq 序号的持久对账流。",
      recordedAt: "2026-11-02T14:10:00-08:00",
      sourceRefId: "ev-pi-session",
      sourceTitle: "packages/agent-host/src/session.ts",
      validStatus: "active",
    },
  },
};

const INITIAL_EVIDENCE: Record<ID, EvidenceDetail> = {
  "ev-hark-prd": {
    id: "ev-hark-prd",
    workspaceId: "ws-hark-r1",
    kind: "file_read",
    title: "Hark-R1-Frontend-PRD-v1.0.md",
    displayLocation: "docs/Hark-R1-Frontend-PRD-v1.0.md",
    observedAt: "2026-11-05T18:18:00-08:00",
    availability: "available",
    verificationLevel: "full_text",
    lineRange: "L15-L108",
    excerpt:
      "Hark 的前端不是项目管理工作台，而是人与一个持续理解项目的 Agent 共同思考的桌面空间。对话就是炉心。\n界面总原则：一个主窗口、一个主要对话面、一个背景火光；默认不常驻左侧导航和右侧详情栏。",
    relatedOpinionIds: ["op-hark-memory-wal", "op-hark-channel-seq"],
  },
  "ev-hark-narrative": {
    id: "ev-hark-narrative",
    workspaceId: "ws-hark-r1",
    kind: "file_read",
    title: "NARRATIVE.md · 2026-10-31 叙事修订",
    displayLocation: "NARRATIVE.md",
    observedAt: "2026-11-05T18:15:00-08:00",
    availability: "available",
    verificationLevel: "full_text",
    lineRange: "L1-L64",
    excerpt:
      "火焰是可观察项目事实的叙事投影，不使用消息数量、签到、活力百分比和「添柴」作为项目进度。没有可信叙事状态时，使用中性余光，不猜测「项目沉睡/健康/失败」。",
  },
  "ev-hark-cargo": {
    id: "ev-hark-cargo",
    workspaceId: "ws-hark-r1",
    kind: "git_observation",
    title: "src-tauri/Cargo.toml · Tauri v2 IPC 声明",
    displayLocation: "src-tauri/Cargo.toml @ commit 8f41c2a",
    observedAt: "2026-11-04T11:20:00-08:00",
    availability: "stale",
    verificationLevel: "partial_text",
    commitRef: "8f41c2a (HEAD~2)",
    staleReason: "本地工作树在 15 分钟前修改了 Cargo.lock 与 channel 缓冲区签名，当前快照尚未重新扫描核验。",
    excerpt:
      '[dependencies]\ntauri = { version = "2.1.0", features = ["tray-icon", "macos-private-api"] }\nrusqlite = { version = "0.32", features = ["bundled"] }',
    relatedOpinionIds: ["op-hark-channel-seq"],
  },
  "ev-tauri-docs-snippet": {
    id: "ev-tauri-docs-snippet",
    workspaceId: "ws-hark-r1",
    kind: "web_snippet",
    title: "Tauri 2.0 Inter-Process Communication · Channel Ordering",
    displayLocation: "v2.tauri.app/concept/inter-process-communication",
    observedAt: "2026-11-05T16:40:00-08:00",
    availability: "available",
    verificationLevel: "snippet",
    excerpt:
      "搜索摘要：Channels are designed to be fast and deliver ordered data streams from Rust commands to the frontend webview. Construct a Channel before invoking the command...",
    relatedOpinionIds: ["op-hark-channel-seq"],
  },
  "ev-unreadable-shell": {
    id: "ev-unreadable-shell",
    workspaceId: "ws-hark-r1",
    kind: "external_document",
    title: "StepFun Streaming Rate Limit Internal Wiki",
    displayLocation: "https://internal.example.org/stepfun-rate-limits",
    observedAt: "2026-11-05T17:00:00-08:00",
    availability: "unreadable",
    verificationLevel: "metadata",
    unreadableReason: "目标网页为 CSR 动态鉴权空壳，Reader 仅获取到 <div id='app'></div> 空节点，拒绝编造正文内容。",
    excerpt: "（未读取到有效正文，仅有外链标题元数据）",
  },
  "ev-excluded-child": {
    id: "ev-excluded-child",
    workspaceId: "ws-hark-r1",
    kind: "file_read",
    title: "packages/agent-host/src/session.ts（旧引用）",
    displayLocation: "packages/agent-host/src/session.ts",
    observedAt: "2026-11-01T10:00:00-08:00",
    availability: "restricted",
    verificationLevel: "snippet",
    removedFromCurrentScope: true,
    unreadableReason: "该子目录已拆分至独立工作空间「Pi Agent Host Sidecar」，已移出当前父空间只读范围，仅保留历史引文锚点，不再作为当前来源自动引用。",
    excerpt: "历史摘录：export class PiSessionManager { ... }",
  },
  "ev-pi-session": {
    id: "ev-pi-session",
    workspaceId: "ws-pi-host",
    kind: "file_read",
    title: "src/session.ts · Pi Session 生命周期管理",
    displayLocation: "src/session.ts",
    observedAt: "2026-11-05T17:40:00-08:00",
    availability: "available",
    verificationLevel: "full_text",
    lineRange: "L42-L96",
    excerpt:
      "export async function runAgentTurn(ctx: TurnContext): Promise<PersistedTurnReceipt> {\n  // 只有收到 SQLite 事务提交回执后才向 Rust Core 发出 memory_committed 事件\n}",
  },
  "ev-pi-mcp": {
    id: "ev-pi-mcp",
    workspaceId: "ws-pi-host",
    kind: "file_read",
    title: "src/mcp-bridge.ts · 搜索证据归一化",
    displayLocation: "src/mcp-bridge.ts",
    observedAt: "2026-11-05T17:42:00-08:00",
    availability: "available",
    verificationLevel: "full_text",
    lineRange: "L12-L55",
    excerpt:
      "// 严格区分 web_snippet（仅标题与搜索摘要）与 web_fulltext（Reader 成功抓取正文）",
  },
};

const INITIAL_OPINIONS: Record<ID, OpinionView> = {
  "op-hark-memory-wal": {
    id: "op-hark-memory-wal",
    workspaceId: "ws-hark-r1",
    title: "将项目架构决定存入 Workspace Memory，而非依赖滑动会话上下文",
    revision: 3,
    summary:
      "当前长对话若仅依赖 Pi Session 历史窗口，跨周回访时容易遗忘早期边界裁决。建议当用户在对话中明确确认架构取舍时，由后端显式写入 SQLite Workspace Memory 并返回操作回执 ID。",
    rationale:
      "根据 PRD §4.3 与 §7.6，AI 在文字中口头说「记住了」不等于数据已入库。只有 `memory_propose_change` 落库成功并返回 `memoryOperationId`，前端才能展示可撤销的记忆回执。",
    evidenceRefs: ["ev-hark-prd", "ev-hark-narrative"],
    counterArguments: [
      "如果每次琐碎闲聊都触发 Memory 写入提案，会导致记忆折页与历史检索被低信噪比记录污染。",
      "过严的写入门槛可能漏掉用户在反驳观点时隐含的重要约束。",
    ],
    uncertainties: [
      "尚未在 Windows NTFS 高并发文件锁场景下实测 SQLite WAL 模式与 Sidecar 同时读写的锁等待延迟。",
    ],
    suggestedNextStep:
      "在 `HarkBridge` 中保持 `memory_committed` 流事件与 `revertMemoryOperation` 撤销接口成对出现，仅对明确架构决定生成回执。",
    status: "active",
    lastUpdatedAt: "2026-11-05T18:12:00-08:00",
    history: [
      {
        revision: 1,
        status: "active",
        note: "初次提出：基于 PRD §4.3 建立独立记忆回执契约",
        updatedAt: "2026-11-03T15:00:00-08:00",
      },
      {
        revision: 2,
        status: "disputed",
        note: "用户反驳：不应自动把所有观点直接转存为决策，需区分 Agent Opinion 与 User Decision",
        updatedAt: "2026-11-04T19:30:00-08:00",
      },
      {
        revision: 3,
        status: "active",
        note: "已根据反馈修正：严格区分用户决策回执与 Agent 观点卡",
        updatedAt: "2026-11-05T18:12:00-08:00",
      },
    ],
  },
  "op-hark-channel-seq": {
    id: "op-hark-channel-seq",
    workspaceId: "ws-hark-r1",
    title: "Tauri 2 Channel 必须在 invoke 前构造，断线重开采用 getRunStatus + getConversation 对账",
    revision: 1,
    summary:
      "前端不能假设先启动 Run 再凭 runId 重新订阅同一个 Tauri Channel。窗口隐藏或重新挂载后，应直接调用 `getRunStatus` 与 `getConversation` 回读持久事实。",
    rationale:
      "Tauri 2 的 IPC Channel 绑定在单次命令调用生命周期上；若在 invoke 返回前已有增量事件到达，前端需按 requestId 暂存并在拿到 runId + seq 后去重排序。",
    evidenceRefs: ["ev-hark-prd", "ev-hark-cargo", "ev-tauri-docs-snippet"],
    counterArguments: [
      "如果用户在长回复中途频繁最小化又恢复窗口，仅靠对账持久消息可能短暂看不到正在生成的半截流式 Token。",
    ],
    uncertainties: [
      "src-tauri/Cargo.toml 最近一次本地修改尚未完成重新编译验证（证据 ev-hark-cargo 处于 stale 状态）。",
    ],
    suggestedNextStep:
      "先落地确定性的 `seq` 单调去重与 `completed_unverified` 警告态，不引入复杂的通用事件溯源总线。",
    status: "active",
    lastUpdatedAt: "2026-11-05T18:19:00-08:00",
    history: [
      {
        revision: 1,
        status: "active",
        note: "由 Tauri 2 IPC 规范与 PRD §7.6 归纳生成",
        updatedAt: "2026-11-05T18:19:00-08:00",
      },
    ],
  },
  "op-pi-isolation": {
    id: "op-pi-isolation",
    workspaceId: "ws-pi-host",
    title: "MCP 搜索工具返回结果应在 Sidecar 层剥离未读正文，防止摘要冒充全文",
    revision: 1,
    summary:
      "当联网搜索仅返回 SERP 摘要或遇到动态渲染空壳网页时，必须将 verificationLevel 标记为 snippet 或 metadata，前端据此展示「只见搜索摘要」。",
    rationale:
      "避免用户在查阅证据 Inspector 时误以为 Agent 已经通读了整篇外部技术文档。",
    evidenceRefs: ["ev-pi-mcp", "ev-pi-session"],
    counterArguments: [
      "部分极简 API 文档的正文长度与摘要接近，启发式阈值可能误判为 snippet。",
    ],
    uncertainties: [
      "GLM MCP 搜索超时阈值在弱网环境下的重试退避策略尚未冻结。",
    ],
    suggestedNextStep: "保持 EvidenceRef 的 verificationLevel 枚举在契约层必填。",
    status: "active",
    lastUpdatedAt: "2026-11-05T17:44:00-08:00",
    history: [
      {
        revision: 1,
        status: "active",
        note: "子空间初始化初读后生成",
        updatedAt: "2026-11-05T17:44:00-08:00",
      },
    ],
  },
};

const INITIAL_MESSAGES: Record<ConversationId, ConversationMessage[]> = {
  "conv-hark-r1": [
    {
      id: "msg-hark-opening",
      workspaceId: "ws-hark-r1",
      conversationId: "conv-hark-r1",
      role: "assistant",
      kind: "agent_opening_message",
      content:
        "我已经完成了对 `~/projects/hark-r1-desktop` 的首次初读。这是一个基于 Tauri 2、React 与 Rust Core 的桌面个人 Agent 项目，核心设计主张是「对话即炉心」——用单一中央对话面与玻璃后的受控火光取代传统多栏管理后台。",
      persistedAt: "2026-11-05T18:05:00-08:00",
      status: "persisted",
      sourceRefs: ["ev-hark-prd", "ev-hark-narrative", "ev-hark-cargo"],
      openingData: {
        projectUnderstanding:
          "项目以单窗口对话炉心（Conversation Hearth）承载所有项目理解、证据溯源与结构化观点，SQLite 与 Pi Agent Host Sidecar 完全由 Rust 宿主管理，前端仅通过类型化 HarkBridge 通信。",
        confirmedFacts: [
          "已从 NARRATIVE.md 与 Frontend PRD 确认：火势由后端 NarrativeState 驱动，严禁按聊天条数或签到计算。",
          "已确认前端状态边界：草稿、流式事件、Opinion 与证据均严格受 WorkspaceId 作用域隔离。",
          "已识别 Tauri 2 IPC 契约需求：invoke + Channel<RunStreamEvent> + AppEvent 三层通道。",
        ],
        unknownsAndUnverified: [
          "src-tauri/Cargo.toml 在最近一次本地变更后尚未重新核验（标记为 stale）。",
          "Windows 托盘最小化恢复与 NTFS 下 SQLite 并发锁延时仍待真机端到端验证。",
        ],
        guidingQuestion:
          "你希望我们先核对 `HarkBridge` 的流式断线重连契约，还是先审阅「记忆回执与观点卡」在对话流中的交互细节？",
      },
    },
    {
      id: "msg-hark-user-1",
      workspaceId: "ws-hark-r1",
      conversationId: "conv-hark-r1",
      role: "user",
      kind: "text",
      content:
        "我们先明确一点：只有当后端真实写入 SQLite Memory 并返回操作 ID 时，界面上才能出现「已记下决策」，不能因为模型回复里写了“我记住了”就弹绿色勾。另外帮我梳理一下当前关于 Memory 和 Channel 的两个核心观点。",
      persistedAt: "2026-11-05T18:10:00-08:00",
      status: "persisted",
    },
    {
      id: "msg-hark-assistant-1",
      workspaceId: "ws-hark-r1",
      conversationId: "conv-hark-r1",
      role: "assistant",
      kind: "text",
      content:
        "完全赞同。我已经将这条约束作为正式架构决定提交给 Rust Core 落库，并在下方附上了本次持久化的记忆回执与两张可独立反馈的观点卡。\n\n同时注意：我在检索外部参考时发现一条内部 Wiki 链接属于动态空壳（`unreadable`），以及一条 Tauri 官方文档仅返回了搜索摘要（`web_snippet`），你可以在证据详情中直接核对它们的阅读深度差异。",
      persistedAt: "2026-11-05T18:12:00-08:00",
      status: "persisted",
      sourceRefs: ["ev-hark-prd", "ev-tauri-docs-snippet", "ev-unreadable-shell", "ev-excluded-child"],
      opinionId: "op-hark-memory-wal",
      memoryOperationId: "mem-op-901",
      memoryReceipt: {
        operationId: "mem-op-901",
        workspaceId: "ws-hark-r1",
        decisionTitle: "禁止根据模型口头文本展示「已记住」状态",
        decisionSummary:
          "UI 仅在收到 Rust Core 持久化的 memory_committed 回执（含 operationId 与版本号）后，才渲染可查看、可撤销的记忆回执组件。",
        committedAt: "2026-11-05T18:12:00-08:00",
        revision: 1,
        reverted: false,
        sourceMessageId: "msg-hark-user-1",
      },
    },
    {
      id: "msg-hark-opinion-2",
      workspaceId: "ws-hark-r1",
      conversationId: "conv-hark-r1",
      role: "assistant",
      kind: "opinion_card",
      content: "关于 Tauri 2 流式通道与断线对账的配套观点如下：",
      persistedAt: "2026-11-05T18:19:00-08:00",
      status: "persisted",
      opinionId: "op-hark-channel-seq",
      sourceRefs: ["ev-hark-cargo", "ev-tauri-docs-snippet"],
    },
  ],
  "conv-pi-host": [
    {
      id: "msg-pi-opening",
      workspaceId: "ws-pi-host",
      conversationId: "conv-pi-host",
      role: "assistant",
      kind: "agent_opening_message",
      content:
        "这是从父项目拆分出的独立子工作空间 `Pi Agent Host Sidecar`（`~/projects/hark-r1-desktop/packages/agent-host`）。父空间已自动排除该目录，新证据将归属于当前子空间。",
      persistedAt: "2026-11-05T17:45:00-08:00",
      status: "persisted",
      sourceRefs: ["ev-pi-session", "ev-pi-mcp"],
      openingData: {
        projectUnderstanding:
          "负责封装 Pi SDK 与 StepFun / MCP 工具调用，作为受 Rust Core 托管的 TypeScript Sidecar 运行。",
        confirmedFacts: [
          "已确认 `src/session.ts` 与 `src/mcp-bridge.ts` 属于当前只读边界。",
          "当前子空间的联网搜索权限默认处于 `disabled` 状态。",
        ],
        unknownsAndUnverified: [
          "子进程异常退出后的自动拉起退避参数尚未在 Windows 宿主验证。",
        ],
        guidingQuestion:
          "需要先检查 `mcp-bridge.ts` 中搜索摘要与全文的归一化规则，还是调整当前子空间的联网搜索授权？",
      },
    },
    {
      id: "msg-pi-opinion-1",
      workspaceId: "ws-pi-host",
      conversationId: "conv-pi-host",
      role: "assistant",
      kind: "opinion_card",
      content: "我在初读 `src/mcp-bridge.ts` 后整理了一条关于证据阅读深度的观点：",
      persistedAt: "2026-11-05T17:46:00-08:00",
      status: "persisted",
      opinionId: "op-pi-isolation",
      sourceRefs: ["ev-pi-mcp"],
    },
  ],
};

export class DevPreviewHarkBridge implements HarkBridge {
  private workspaces: Record<WorkspaceId, WorkspaceDetail> = structuredClone(INITIAL_WORKSPACES);
  private evidence: Record<ID, EvidenceDetail> = structuredClone(INITIAL_EVIDENCE);
  private opinions: Record<ID, OpinionView> = structuredClone(INITIAL_OPINIONS);
  private conversations: Record<ConversationId, ConversationMessage[]> = structuredClone(INITIAL_MESSAGES);
  private onboardingRuns: Record<RunId, OnboardingRun> = {};
  private rootPreviews: Record<ID, RootPreview> = {};
  private activeRuns: Record<RunId, { cancelled: boolean; status: RunStatus }> = {};
  private listeners: Set<(event: AppEvent) => void> = new Set();
  private searchConfig: SearchProviderConfig = { activeProvider: "tavily", providers: {} };

  private runtime: RuntimeStatus = {
    bridgeMode: "dev_preview_synthetic",
    rustCoreStatus: "healthy",
    piSidecarStatus: "ready",
    stepFunConfigured: true,
    mcpSearchConfigured: true,
    windowBehaviorOnClose: "hide_to_tray",
    launchAtLogin: false,
    notificationsEnabled: true,
  };

  private attentionItems = [
    {
      id: "att-cargo-stale",
      workspaceId: "ws-hark-r1",
      workspaceName: "Hark · 桌面炉心 R1",
      conversationId: "conv-hark-r1",
      headline: "src-tauri/Cargo.toml 存在未核验变更",
      whyNow: "本地工作树 15 分钟前修改了 IPC Channel 依赖配置，关联观点「Tauri 2 Channel 对账契约」的证据已标记为 stale，建议核对。",
      targetOpinionId: "op-hark-channel-seq",
      targetEvidenceId: "ev-hark-cargo",
      createdAt: "2026-11-05T18:22:00-08:00",
      dismissed: false,
    },
  ];

  private emit(event: AppEvent) {
    for (const cb of this.listeners) {
      cb(event);
    }
  }

  async getAppSnapshot(): Promise<AppSnapshot> {
    const summaries = Object.values(this.workspaces).map((w) => w.summary);
    return {
      schemaVersion: "hark.ui.v1",
      appVersion: "0.1.0-r1-preview",
      workspaces: summaries,
      currentWorkspaceId: summaries[0]?.id,
      runtime: structuredClone(this.runtime),
      attentionItems: this.attentionItems.filter((i) => !i.dismissed),
    };
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    return Object.values(this.workspaces).map((w) => structuredClone(w.summary));
  }

  async getWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceDetail> {
    const ws = this.workspaces[workspaceId];
    if (!ws) {
      throw {
        code: "WORKSPACE_NOT_FOUND",
        message: `找不到工作空间 ${workspaceId}`,
        retryable: false,
      };
    }
    return structuredClone(ws);
  }

  async updateWorkspaceState(
    workspaceId: WorkspaceId,
    observerState: "active" | "paused"
  ): Promise<WorkspaceSummary> {
    const ws = this.workspaces[workspaceId];
    if (!ws) {
      throw {
        code: "WORKSPACE_NOT_FOUND",
        message: "工作空间不存在",
        retryable: false,
      };
    }
    ws.summary.observerState = observerState;
    // PRD §4.6: 观察暂停时火焰不得错误变暗代表项目停滞，保持原 NarrativeState
    this.emit({
      type: "workspace_updated",
      workspaceId,
      timestamp: new Date().toISOString(),
    });
    return structuredClone(ws.summary);
  }

  async previewRoot(path: string): Promise<RootPreview> {
    const cleanPath = path.trim() || "~/projects/new-workspace";
    const previewId = `prev-${Date.now()}`;
    const isMultiCandidate =
      cleanPath.toLowerCase().includes("multi") ||
      cleanPath.toLowerCase().includes("studio") ||
      cleanPath.toLowerCase().includes("experiments");
    const isMonorepo = cleanPath.toLowerCase().includes("monorepo") || cleanPath.toLowerCase().includes("hark");

    let preview: RootPreview;
    if (isMultiCandidate) {
      preview = {
        previewId,
        displayPath: cleanPath,
        scanStatus: "ready",
        recommendedMode: "select_candidates",
        defaultExcludedPaths: ["node_modules/", ".git/", "target/", "dist/", ".DS_Store"],
        readOnlyBoundaryNote: "Hark R1 仅以只读方式扫描已选目录，绝不执行项目内脚本或写入业务源码。",
        uncoveredReasons: ["archive/legacy-2024 因包含超大二进制归档被默认跳过初扫"],
        candidates: [
          {
            candidateId: "cand-core-engine",
            relativePath: "./core-engine",
            suggestedName: "Core Engine (Rust)",
            classification: "independent_project",
            reasons: ["独立 Cargo.toml 与独立 .git 历史", "包含完整 README.md 与架构说明"],
            selectable: true,
          },
          {
            candidateId: "cand-web-portal",
            relativePath: "./web-portal",
            suggestedName: "Web Portal (Next.js)",
            classification: "independent_project",
            reasons: ["独立 package.json 与独立部署配置", "与 Core Engine 无共享 Workspace 锁文件"],
            selectable: true,
          },
          {
            candidateId: "cand-root-single",
            relativePath: ".",
            suggestedName: `${cleanPath.split("/").pop() || "Root"}（合并为单个项目导入）`,
            classification: "single_project",
            reasons: ["忽略子目录拆分，将整个根目录作为一个统一 Workspace 认识"],
            selectable: true,
          },
        ],
      };
    } else if (isMonorepo) {
      preview = {
        previewId,
        displayPath: cleanPath,
        scanStatus: "ready",
        recommendedMode: "single",
        defaultExcludedPaths: ["node_modules/", "target/", "dist/", ".turbo/"],
        readOnlyBoundaryNote: "检测到 Monorepo 工作区（pnpm-workspace.yaml / Cargo Workspace），R1 默认作为一个完整项目认识，不因多包而自动拆分。",
        uncoveredReasons: [],
        candidates: [
          {
            candidateId: "cand-monorepo-root",
            relativePath: ".",
            suggestedName: cleanPath.split("/").pop() || "Monorepo Project",
            classification: "single_project",
            reasons: [
              "发现根级 pnpm-workspace.yaml、Cargo.toml 与统一 README.md",
              "PRD §0.1 规范：Monorepo 不因多包自动拆分，建议作为一个 Workspace 整体理解",
            ],
            selectable: true,
          },
        ],
      };
    } else {
      preview = {
        previewId,
        displayPath: cleanPath,
        scanStatus: "ready",
        recommendedMode: "single",
        defaultExcludedPaths: ["node_modules/", ".git/", "dist/", "build/"],
        readOnlyBoundaryNote: "仅授权只读访问当前根目录及其子文件夹，模型初读仅在下方勾选时发送关键摘要片段。",
        uncoveredReasons: [],
        candidates: [
          {
            candidateId: "cand-single-root",
            relativePath: ".",
            suggestedName: cleanPath.split("/").filter(Boolean).pop() || "Local Project",
            classification: "single_project",
            reasons: ["发现根级 README.md、package.json 与 tsconfig.json", "单一职责代码仓库结构"],
            selectable: true,
          },
        ],
      };
    }

    this.rootPreviews[previewId] = preview;
    return structuredClone(preview);
  }

  async confirmImport(input: ConfirmImportInput): Promise<ConfirmImportResult> {
    const preview = this.rootPreviews[input.previewId];
    const basePath = preview?.displayPath || "~/projects/imported-workspace";
    const selected =
      preview?.candidates.filter((c) => input.selectedCandidateIds.includes(c.candidateId)) || [];
    const effectiveCandidates =
      selected.length > 0
        ? selected
        : [
            {
              candidateId: "cand-default",
              relativePath: ".",
              suggestedName: basePath.split("/").filter(Boolean).pop() || "新导入项目",
              classification: "single_project" as const,
              reasons: ["发现 README.md 与核心配置"],
              selectable: true,
            },
          ];

    const createdIds: WorkspaceId[] = [];
    let primaryRunId = "";

    effectiveCandidates.forEach((cand, idx) => {
      const wsId = `ws-import-${Date.now()}-${idx}`;
      const convId = `conv-${wsId}`;
      const runId = `onboard-run-${wsId}`;
      if (idx === 0) primaryRunId = runId;
      createdIds.push(wsId);

      const fullPath =
        cand.relativePath === "."
          ? basePath
          : `${basePath.replace(/\/$/, "")}/${cand.relativePath.replace(/^\.\//, "")}`;

      const modelPerm = !this.runtime.stepFunConfigured
        ? "unavailable"
        : input.enableModelInitialRead
        ? "enabled"
        : "disabled";

      const evId = `ev-init-${wsId}`;
      this.evidence[evId] = {
        id: evId,
        workspaceId: wsId,
        kind: "file_read",
        title: `${cand.suggestedName} · README.md 与结构清单`,
        displayLocation: `${fullPath}/README.md`,
        observedAt: new Date().toISOString(),
        availability: "available",
        verificationLevel: "full_text",
        lineRange: "L1-L48",
        excerpt: `# ${cand.suggestedName}\n已通过 Hark R1 只读边界初扫。\n包含依据：${cand.reasons.join("；")}\n默认排除项：${(input.customExcludedPaths || preview?.defaultExcludedPaths || ["node_modules/"]).join(", ")}`,
      };

      const isModelEnabled = modelPerm === "enabled";

      // PRD §4.1.7: 未配置模型或用户未授权时显示 local_scan_card；启用模型则进入真实认识阶段并最终产出 agent_opening_message
      const onboardingStage = isModelEnabled ? "reading" : "waiting_for_model_auth";

      const localScanMsgId = `msg-scan-${wsId}`;
      const openingMsgId = `msg-open-${wsId}`;

      const initialMessages: ConversationMessage[] = [];
      if (!isModelEnabled) {
        initialMessages.push({
          id: localScanMsgId,
          workspaceId: wsId,
          conversationId: convId,
          role: "assistant",
          kind: "local_scan_card",
          content: `已完成对 \`${fullPath}\` 的本地只读结构扫描（未调用远程模型）。`,
          persistedAt: new Date().toISOString(),
          status: "persisted",
          sourceRefs: [evId],
          localScanData: {
            scannedFilesCount: 42,
            detectedLanguages: ["TypeScript", "Rust", "Markdown"],
            keyManifests: ["README.md", "package.json", "Cargo.toml"],
            unverifiedAreas: ["尚未启用 StepFun 模型初读，暂未生成深层架构理解与观点"],
            modelAuthRequired: true,
          },
        });
      }

      this.conversations[convId] = initialMessages;

      this.onboardingRuns[runId] = {
        id: runId,
        workspaceId: wsId,
        stage: onboardingStage,
        progressText: isModelEnabled
          ? "阶段 1/3 · 正在扫描目录结构与关键清单文件 (README, package.json, Cargo.toml)…"
          : "已完成本地只读初扫 · 等待开启模型初读授权以生成首次主动开场",
        scanReadCount: isModelEnabled ? 14 : 42,
        scanTotalEstimate: 42,
        localScanCardMessageId: !isModelEnabled ? localScanMsgId : undefined,
        openingMessageId: isModelEnabled ? openingMsgId : undefined,
        lastUpdatedAt: new Date().toISOString(),
      };

      this.workspaces[wsId] = {
        summary: {
          id: wsId,
          name: cand.suggestedName,
          rootDisplayPath: fullPath,
          lifecycle: "active",
          agentStatus: isModelEnabled ? "reading" : "idle",
          currentConversationId: convId,
          lastObservedAt: new Date().toISOString(),
          overviewFreshness: "fresh",
          modelPermission: modelPerm,
          searchPermission: input.enableWebSearch ? "enabled" : "disabled",
          observerState: "active",
        },
        excludedPaths: input.customExcludedPaths || preview?.defaultExcludedPaths || ["node_modules/", "target/"],
        readOnlyPaths: ["README.md", "src/", "docs/", "package.json"],
        activeOnboardingRunId: runId,
        narrative: {
          availability: isModelEnabled ? "known" : "unknown",
          flame: isModelEnabled ? "ember" : "neutral",
          stageLabel: isModelEnabled ? "低伏微光 · 正在建立首次项目理解" : "尚未建立项目状态（仅本地扫描）",
          narrativeReason: isModelEnabled
            ? "已确认只读目录边界，正在读取核心架构文档准备主动开场。"
            : "尚未启用模型初读，保持中性余光，不猜测项目健康度。",
          basisRefs: [evId],
          observedAt: new Date().toISOString(),
          stale: false,
        },
      };
    });

    this.emit({
      type: "workspace_updated",
      workspaceId: createdIds[0],
      timestamp: new Date().toISOString(),
    });

    return {
      workspaceIds: createdIds,
      focusedWorkspaceId: createdIds[0],
      onboardingRunId: primaryRunId,
    };
  }

  async advanceOnboardingForPreview(runId: RunId): Promise<OnboardingRun> {
    const run = this.onboardingRuns[runId];
    if (!run) {
      throw {
        code: "WORKSPACE_NOT_FOUND",
        message: "找不到 Onboarding Run",
        retryable: false,
      };
    }
    const ws = this.workspaces[run.workspaceId];
    if (!ws) {
      throw {
        code: "WORKSPACE_NOT_FOUND",
        message: "工作空间不存在",
        retryable: false,
      };
    }

    if (run.stage === "reading") {
      run.stage = "analyzing";
      run.scanReadCount = 38;
      run.scanTotalEstimate = 42;
      run.progressText = "阶段 2/3 · 已读取关键文档，Pi Agent 正在归纳项目依据与待验证边界…";
      ws.summary.agentStatus = "analyzing";
    } else if (run.stage === "analyzing" || run.stage === "message_ready") {
      run.stage = "completed";
      run.scanReadCount = 42;
      run.scanTotalEstimate = 42;
      run.progressText = "首次认识已完成 · 首条开场消息已持久化保存";
      ws.summary.agentStatus = "idle";
      ws.activeOnboardingRunId = undefined;
      ws.narrative = {
        availability: "known",
        flame: "gentle",
        stageLabel: "稳定小火 · 已完成首次认识",
        narrativeReason: `已阅读 ${ws.summary.name} 的核心清单与文档，首条主动开场消息已落库。`,
        basisRefs: ws.narrative.basisRefs,
        observedAt: new Date().toISOString(),
        stale: false,
      };

      const convId = ws.summary.currentConversationId!;
      const existing = this.conversations[convId] || [];
      const openId = run.openingMessageId || `msg-open-${ws.summary.id}`;
      if (!existing.some((m) => m.id === openId)) {
        // PRD §4.1.6 & §4.1.7: 若此前有 local_scan_card，折叠为附件，不重复介绍
        const priorScanCard = existing.find((m) => m.kind === "local_scan_card");
        const filtered = existing.filter((m) => m.kind !== "local_scan_card");
        filtered.push({
          id: openId,
          workspaceId: ws.summary.id,
          conversationId: convId,
          role: "assistant",
          kind: "agent_opening_message",
          content: `我已经读完 \`${ws.summary.rootDisplayPath}\` 下的核心清单与入口文档。这是一个结构清晰的本地项目，我已经建立了只读边界与初步证据索引。`,
          persistedAt: new Date().toISOString(),
          status: "persisted",
          sourceRefs: ws.narrative.basisRefs,
          openingData: {
            projectUnderstanding: `当前 Workspace「${ws.summary.name}」包含核心源码目录与文档规范，默认排除了构建产物目录（${ws.excludedPaths.slice(0, 3).join(", ")}）。`,
            confirmedFacts: [
              `已核验只读目录范围：${ws.readOnlyPaths.join(", ")}`,
              "已建立专属会话与独立 Workspace Memory 空间，与其他项目隔离",
            ],
            unknownsAndUnverified: [
              "尚未核验运行时环境变量与外部服务集成边界",
              "历史 Git 分支演进中的未合并技术债仍待按需深读",
            ],
            guidingQuestion: `关于「${ws.summary.name}」，你希望我们先梳理核心模块架构，还是先检查最近正在修改的功能边界？`,
            foldedLocalScanId: priorScanCard?.id,
          },
        });
        this.conversations[convId] = filtered;
      }
    }

    run.lastUpdatedAt = new Date().toISOString();
    this.emit({
      type: "onboarding_progress",
      workspaceId: run.workspaceId,
      runId: run.id,
      timestamp: run.lastUpdatedAt,
    });
    return structuredClone(run);
  }

  async createChildWorkspace(input: CreateChildWorkspaceInput): Promise<CreateChildWorkspaceResult> {
    const parent = this.workspaces[input.parentWorkspaceId];
    if (!parent) {
      throw {
        code: "WORKSPACE_NOT_FOUND",
        message: "父工作空间不存在",
        retryable: false,
      };
    }

    // PRD §4.5: 一次请求原子提交父空间排除与新子空间创建，不出现半成功
    const cleanSub = input.relativeSubPath.replace(/^\/+|\/+$/g, "") || "packages/sub-module";
    if (input.excludeFromParent && !parent.excludedPaths.includes(`${cleanSub}/`)) {
      parent.excludedPaths.push(`${cleanSub}/`);
    }

    const childId = `ws-child-${Date.now()}`;
    const convId = `conv-${childId}`;
    const runId = `onboard-${childId}`;
    const fullChildPath = `${parent.summary.rootDisplayPath.replace(/\/$/, "")}/${cleanSub}`;
    const evId = `ev-${childId}`;

    this.evidence[evId] = {
      id: evId,
      workspaceId: childId,
      kind: "file_read",
      title: `${input.suggestedName} · 子模块入口文件`,
      displayLocation: `${cleanSub}/package.json`,
      observedAt: new Date().toISOString(),
      availability: "available",
      verificationLevel: "full_text",
      lineRange: "L1-L30",
      excerpt: `{\n  "name": "${input.suggestedName.toLowerCase().replace(/\s+/g, "-")}",\n  "private": true\n}`,
    };

    this.conversations[convId] = [
      {
        id: `msg-open-${childId}`,
        workspaceId: childId,
        conversationId: convId,
        role: "assistant",
        kind: "agent_opening_message",
        content: `已将子目录 \`${cleanSub}\` 拆分为独立工作空间「${input.suggestedName}」。父工作空间「${parent.summary.name}」已同步排除该路径，${
          input.retainParentHistoryRef ? "父空间旧对话中的历史引文将保留只读锚点（标记为已移出当前范围）。" : "后续文件观察完全归属当前子空间。"
        }`,
        persistedAt: new Date().toISOString(),
        status: "persisted",
        sourceRefs: [evId],
        openingData: {
          projectUnderstanding: `独立子项目空间（源自 ${parent.summary.name} 的 ${cleanSub}），拥有独立会话、观点与记忆库。`,
          confirmedFacts: [
            `父空间已原子排除 ${cleanSub}/，防止双 Agent 重复索引`,
            "已建立当前子项目的独立证据作用域",
          ],
          unknownsAndUnverified: ["子模块与父仓库公共依赖的版本耦合细节待深入阅读"],
          guidingQuestion: `在「${input.suggestedName}」子空间中，我们先关注哪个核心模块？`,
        },
      },
    ];

    this.onboardingRuns[runId] = {
      id: runId,
      workspaceId: childId,
      stage: "completed",
      progressText: "子空间初始化与首条开场已完成",
      scanReadCount: 18,
      scanTotalEstimate: 18,
      openingMessageId: `msg-open-${childId}`,
      lastUpdatedAt: new Date().toISOString(),
    };

    const childDetail: WorkspaceDetail = {
      summary: {
        id: childId,
        name: input.suggestedName,
        rootDisplayPath: fullChildPath,
        lifecycle: "active",
        agentStatus: "idle",
        currentConversationId: convId,
        lastObservedAt: new Date().toISOString(),
        overviewFreshness: "fresh",
        modelPermission: parent.summary.modelPermission,
        searchPermission: parent.summary.searchPermission,
        observerState: "active",
      },
      excludedPaths: ["node_modules/", "dist/"],
      readOnlyPaths: [`${cleanSub}/src/`, `${cleanSub}/package.json`],
      parentWorkspaceId: parent.summary.id,
      narrative: {
        availability: "known",
        flame: "ember",
        stageLabel: "低伏微光 · 新建独立子空间",
        narrativeReason: `已从 ${parent.summary.name} 拆分并完成边界核验。`,
        basisRefs: [evId],
        observedAt: new Date().toISOString(),
        stale: false,
      },
    };

    this.workspaces[childId] = childDetail;
    this.emit({
      type: "workspace_updated",
      workspaceId: childId,
      timestamp: new Date().toISOString(),
    });

    return {
      childWorkspace: structuredClone(childDetail.summary),
      updatedParentExcludedPaths: [...parent.excludedPaths],
      onboardingRunId: runId,
    };
  }

  async getOnboardingRun(runId: RunId): Promise<OnboardingRun> {
    const run = this.onboardingRuns[runId];
    if (!run) {
      throw {
        code: "WORKSPACE_NOT_FOUND",
        message: "未找到对应的首次认识任务",
        retryable: false,
      };
    }
    return structuredClone(run);
  }

  async getConversation(conversationId: ConversationId): Promise<MessagePage> {
    const msgs = this.conversations[conversationId] || [];
    const ws = Object.values(this.workspaces).find(
      (w) => w.summary.currentConversationId === conversationId
    );
    return {
      workspaceId: ws?.summary.id || "ws-hark-r1",
      conversationId,
      messages: structuredClone(msgs),
    };
  }

  async startAgentTurn(
    input: StartAgentTurnInput,
    onEvent: (event: RunStreamEvent) => void
  ): Promise<StartAgentTurnResult> {
    const ws = this.workspaces[input.workspaceId];
    if (!ws) {
      throw {
        code: "WORKSPACE_NOT_FOUND",
        message: "当前工作空间不存在",
        retryable: false,
      };
    }

    if (this.runtime.piSidecarStatus === "unavailable") {
      throw {
        code: "SIDECAR_UNAVAILABLE",
        message: "Pi Agent Host Sidecar 当前不可用，请重试连接或检查运行状态（绝不静默切换为假回复）。",
        retryable: true,
      };
    }

    if (!this.runtime.stepFunConfigured) {
      throw {
        code: "MODEL_NOT_CONFIGURED",
        message: "尚未配置 StepFun 模型服务凭据，无法发起远程推理请求。",
        retryable: true,
      };
    }

    if (ws.summary.modelPermission !== "enabled") {
      throw {
        code: "MODEL_PERMISSION_REQUIRED",
        message: "当前工作空间尚未开启模型对话权限，请先在工作空间权限中启用 StepFun 授权。",
        retryable: true,
      };
    }

    const userMsg: ConversationMessage = {
      id: `msg-user-${Date.now()}`,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      role: "user",
      kind: "text",
      content: input.userPrompt,
      persistedAt: new Date().toISOString(),
      status: "persisted",
    };

    if (!this.conversations[input.conversationId]) {
      this.conversations[input.conversationId] = [];
    }
    this.conversations[input.conversationId].push(userMsg);

    const runId = `run-${Date.now()}`;
    ws.summary.agentStatus = "responding";

    this.activeRuns[runId] = {
      cancelled: false,
      status: {
        runId,
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        state: "running",
      },
    };

    const promptText = input.userPrompt.trim();
    const shouldCommitMemory =
      promptText.includes("决定") ||
      promptText.includes("记住") ||
      promptText.includes("采用") ||
      promptText.includes("确认") ||
      promptText.includes("规范");

    const availableRefs = Object.values(this.evidence)
      .filter((e) => e.workspaceId === input.workspaceId && !e.removedFromCurrentScope)
      .map((e) => e.id);

    const selectedRefs = availableRefs.slice(0, 2);

    // 模拟真实 Tauri Channel 异步有序流式事件（支持中途 cancelAgentTurn）
    setTimeout(() => {
      if (this.activeRuns[runId]?.cancelled) return;
      onEvent({
        schemaVersion: "hark.ui.v1",
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        runId,
        seq: 1,
        type: "run_started",
        payload: {},
      });
    }, 60);

    setTimeout(() => {
      if (this.activeRuns[runId]?.cancelled) return;
      onEvent({
        schemaVersion: "hark.ui.v1",
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        runId,
        seq: 2,
        type: "tool_started",
        payload: {
          toolName: "workspace_read_evidence",
          toolStageLabel: `正在核对「${ws.summary.name}」的只读证据与记忆索引…`,
        },
      });
    }, 180);

    setTimeout(() => {
      if (this.activeRuns[runId]?.cancelled) return;
      onEvent({
        schemaVersion: "hark.ui.v1",
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        runId,
        seq: 3,
        type: "tool_completed",
        payload: {
          toolName: "workspace_read_evidence",
        },
      });
      onEvent({
        schemaVersion: "hark.ui.v1",
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        runId,
        seq: 4,
        type: "text_delta",
        payload: {
          delta: `结合「${ws.summary.name}」当前的只读边界与已核验证据，我对「${promptText.slice(0, 28)}」的梳理如下：\n\n`,
        },
      });
    }, 360);

    setTimeout(() => {
      if (this.activeRuns[runId]?.cancelled) return;
      onEvent({
        schemaVersion: "hark.ui.v1",
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        runId,
        seq: 5,
        type: "text_delta",
        payload: {
          delta: shouldCommitMemory
            ? "1. **依据与影响面**：已核对当前工作空间内的关联文档，你的这项架构要求与「单页炉心、后端单一权威」完全一致。\n2. **持久记忆回执**：我已调用 `memory_propose_change` 将该决定写入当前 Workspace SQLite 记忆表，并生成了可随时撤销的持久回执。"
            : "1. **已核验事实**：相关模块定义在当前只读目录下清晰可查，且未突破 Workspace 作用域。\n2. **待核验边界**：若后续涉及跨平台托盘或外部 MCP 检索，我们会继续在同一对话流中附上分级证据引用。",
        },
      });
    }, 580);

    setTimeout(() => {
      if (this.activeRuns[runId]?.cancelled) return;

      const assistantMsgId = `msg-asst-${Date.now()}`;
      const fullContent =
        `结合「${ws.summary.name}」当前的只读边界与已核验证据，我对「${promptText.slice(0, 28)}」的梳理如下：\n\n` +
        (shouldCommitMemory
          ? "1. **依据与影响面**：已核对当前工作空间内的关联文档，你的这项架构要求与「单页炉心、后端单一权威」完全一致。\n2. **持久记忆回执**：我已调用 `memory_propose_change` 将该决定写入当前 Workspace SQLite 记忆表，并生成了可随时撤销的持久回执。"
          : "1. **已核验事实**：相关模块定义在当前只读目录下清晰可查，且未突破 Workspace 作用域。\n2. **待核验边界**：若后续涉及跨平台托盘或外部 MCP 检索，我们会继续在同一对话流中附上分级证据引用。");

      let memoryReceipt: MemoryReceiptData | undefined;
      if (shouldCommitMemory) {
        memoryReceipt = {
          operationId: `mem-op-${Date.now()}`,
          workspaceId: input.workspaceId,
          decisionTitle: `用户明确决定：${promptText.slice(0, 26)}`,
          decisionSummary: `由用户在对话中明确提出并经 Rust Core SQLite 持久化记录（关联会话 ${input.conversationId}）。`,
          committedAt: new Date().toISOString(),
          revision: 1,
          reverted: false,
          sourceMessageId: userMsg.id,
        };
        onEvent({
          schemaVersion: "hark.ui.v1",
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          runId,
          seq: 6,
          type: "memory_committed",
          payload: {
            memoryReceipt,
          },
        });
      }

      const persistedMsg: ConversationMessage = {
        id: assistantMsgId,
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        role: "assistant",
        kind: "text",
        content: fullContent,
        persistedAt: new Date().toISOString(),
        status: "persisted",
        runId,
        sourceRefs: selectedRefs,
        memoryOperationId: memoryReceipt?.operationId,
        memoryReceipt,
      };

      this.conversations[input.conversationId].push(persistedMsg);
      ws.summary.agentStatus = "idle";
      this.activeRuns[runId].status = {
        runId,
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        state: "completed",
        persistedAssistantMessageId: assistantMsgId,
      };

      onEvent({
        schemaVersion: "hark.ui.v1",
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        runId,
        seq: 7,
        type: "run_completed",
        payload: {
          persistedMessageId: assistantMsgId,
          persistenceVerified: true,
        },
      });
    }, 820);

    return {
      runId,
      acceptedUserMessage: structuredClone(userMsg),
    };
  }

  async getRunStatus(runId: RunId): Promise<RunStatus> {
    const r = this.activeRuns[runId];
    if (!r) {
      return {
        runId,
        workspaceId: "ws-hark-r1",
        conversationId: "conv-hark-r1",
        state: "completed",
      };
    }
    return structuredClone(r.status);
  }

  async cancelAgentTurn(runId: RunId): Promise<RunStatus> {
    const r = this.activeRuns[runId];
    if (r) {
      r.cancelled = true;
      r.status.state = "cancelled";
      const ws = this.workspaces[r.status.workspaceId];
      if (ws) ws.summary.agentStatus = "idle";

      // 保存一条真实已取消记录，不删除已有会话历史（PRD §4.2）
      const conv = this.conversations[r.status.conversationId];
      if (conv) {
        conv.push({
          id: `msg-cancel-${Date.now()}`,
          workspaceId: r.status.workspaceId,
          conversationId: r.status.conversationId,
          role: "system_notice",
          kind: "text",
          content: "已停止当前模型生成（OPERATION_CANCELLED）。此前已保存的消息与工具证据均完整保留。",
          persistedAt: new Date().toISOString(),
          status: "cancelled",
          runId,
        });
      }
      return structuredClone(r.status);
    }
    return {
      runId,
      workspaceId: "ws-hark-r1",
      conversationId: "conv-hark-r1",
      state: "cancelled",
    };
  }

  async getOpinion(opinionId: ID): Promise<OpinionView> {
    const op = this.opinions[opinionId];
    if (!op) {
      throw {
        code: "WORKSPACE_NOT_FOUND",
        message: "未找到该观点记录",
        retryable: false,
      };
    }
    return structuredClone(op);
  }

  async listWorkspaceOpinions(workspaceId: WorkspaceId): Promise<OpinionView[]> {
    return Object.values(this.opinions)
      .filter((o) => o.workspaceId === workspaceId)
      .map((o) => structuredClone(o));
  }

  async submitOpinionFeedback(input: OpinionFeedbackInput): Promise<OpinionView> {
    const op = this.opinions[input.opinionId];
    if (!op || op.workspaceId !== input.workspaceId) {
      throw {
        code: "SCOPE_DENIED",
        message: "观点不属于当前工作空间",
        retryable: false,
      };
    }
    if (op.revision !== input.expectedRevision) {
      throw {
        code: "CONFLICT_REVISION",
        message: `观点版本已更新至 v${op.revision}，请先同步最新状态。`,
        retryable: true,
      };
    }

    op.revision += 1;
    op.lastUpdatedAt = new Date().toISOString();

    let nextStatus = op.status;
    let actionLabel = "";
    switch (input.action) {
      case "helpful":
        nextStatus = "active";
        actionLabel = "用户确认「有帮助 / 采纳建议」";
        break;
      case "rebut":
        nextStatus = "disputed";
        actionLabel = "用户提出「反驳」";
        break;
      case "shelve":
        nextStatus = "shelved";
        actionLabel = "用户选择「暂时搁置」";
        break;
      case "revise":
        nextStatus = "active";
        actionLabel = "用户提交「修正意见」";
        break;
    }

    op.status = nextStatus;
    if (input.userComment) {
      op.userFeedbackNote = input.userComment;
      if (input.action === "revise") {
        op.suggestedNextStep = input.userComment;
      }
    }

    op.history.push({
      revision: op.revision,
      status: op.status,
      note: input.userComment ? `${actionLabel}：${input.userComment}` : actionLabel,
      updatedAt: op.lastUpdatedAt,
    });

    // 若关联了待处理提醒，标记完成
    this.attentionItems.forEach((item) => {
      if (item.targetOpinionId === op.id) {
        item.dismissed = true;
      }
    });

    return structuredClone(op);
  }

  async revertMemoryOperation(
    workspaceId: WorkspaceId,
    operationId: ID
  ): Promise<MemoryReceiptData> {
    for (const msgs of Object.values(this.conversations)) {
      for (const m of msgs) {
        if (m.workspaceId === workspaceId && m.memoryReceipt?.operationId === operationId) {
          m.memoryReceipt.reverted = true;
          m.memoryReceipt.revision += 1;
          return structuredClone(m.memoryReceipt);
        }
      }
    }
    throw {
      code: "WORKSPACE_NOT_FOUND",
      message: "未找到对应的记忆写入回执",
      retryable: false,
    };
  }

  async getEvidence(evidenceId: ID): Promise<EvidenceDetail> {
    const ev = this.evidence[evidenceId];
    if (!ev) {
      throw {
        code: "SOURCE_UNREADABLE",
        message: "找不到对应来源证据",
        retryable: false,
      };
    }
    return structuredClone(ev);
  }

  async listWorkspaceEvidence(workspaceId: WorkspaceId): Promise<EvidenceRef[]> {
    return Object.values(this.evidence)
      .filter((e) => e.workspaceId === workspaceId)
      .map((e) => structuredClone(e));
  }

  async searchWorkspaceMemory(input: MemorySearchInput): Promise<MemorySearchPage> {
    const q = input.query.trim().toLowerCase();
    const items: MemorySearchPage["items"] = [];

    const ws = this.workspaces[input.workspaceId];
    if (ws?.memoryFold) {
      if (
        !q ||
        ws.memoryFold.statement.toLowerCase().includes(q) ||
        ws.memoryFold.contextExcerpt.toLowerCase().includes(q)
      ) {
        items.push({
          id: ws.memoryFold.id,
          workspaceId: input.workspaceId,
          kind: "decision",
          title: "记忆折页 · 历史核心决定",
          snippet: ws.memoryFold.statement,
          recordedAt: ws.memoryFold.recordedAt,
          statusLabel: "有效记忆折页",
          sourceRefId: ws.memoryFold.sourceRefId,
        });
      }
    }

    // 检索当前 Workspace 的持久消息与记忆回执
    const convId = ws?.summary.currentConversationId;
    const msgs = (convId && this.conversations[convId]) || [];
    for (const m of msgs) {
      if (m.memoryReceipt) {
        if (
          !q ||
          m.memoryReceipt.decisionTitle.toLowerCase().includes(q) ||
          m.memoryReceipt.decisionSummary.toLowerCase().includes(q)
        ) {
          items.push({
            id: m.memoryReceipt.operationId,
            workspaceId: input.workspaceId,
            kind: "decision",
            title: m.memoryReceipt.decisionTitle,
            snippet: m.memoryReceipt.decisionSummary,
            recordedAt: m.memoryReceipt.committedAt,
            statusLabel: m.memoryReceipt.reverted ? "已撤销" : `已入库 v${m.memoryReceipt.revision}`,
            conversationId: m.conversationId,
          });
        }
      }
    }

    // 检索当前 Workspace 的观点
    for (const op of Object.values(this.opinions)) {
      if (op.workspaceId !== input.workspaceId) continue;
      if (
        !q ||
        op.title.toLowerCase().includes(q) ||
        op.summary.toLowerCase().includes(q)
      ) {
        items.push({
          id: op.id,
          workspaceId: input.workspaceId,
          kind: "opinion",
          title: op.title,
          snippet: op.summary,
          recordedAt: op.lastUpdatedAt,
          statusLabel: `观点 · ${op.status} (v${op.revision})`,
          opinionId: op.id,
        });
      }
    }

    // 检索当前 Workspace 的证据
    for (const ev of Object.values(this.evidence)) {
      if (ev.workspaceId !== input.workspaceId) continue;
      if (
        !q ||
        ev.title.toLowerCase().includes(q) ||
        ev.excerpt.toLowerCase().includes(q)
      ) {
        items.push({
          id: ev.id,
          workspaceId: input.workspaceId,
          kind: "local_fact",
          title: ev.title,
          snippet: ev.excerpt,
          recordedAt: ev.observedAt || new Date().toISOString(),
          statusLabel: `证据 · ${ev.verificationLevel}`,
          sourceRefId: ev.id,
        });
      }
    }

    const filtered =
      input.kinds && input.kinds.length > 0
        ? items.filter((i) => input.kinds!.includes(i.kind))
        : items;

    return {
      workspaceId: input.workspaceId,
      items: filtered,
    };
  }

  async getWorkspacePermissions(id: WorkspaceId): Promise<WorkspacePermissions> {
    const ws = this.workspaces[id];
    if (!ws) {
      throw {
        code: "WORKSPACE_NOT_FOUND",
        message: "工作空间不存在",
        retryable: false,
      };
    }
    return {
      workspaceId: id,
      revision: 1,
      readOnlyPaths: [...ws.readOnlyPaths],
      excludedPaths: [...ws.excludedPaths],
      modelPermission: ws.summary.modelPermission,
      searchPermission: ws.summary.searchPermission,
      observerState: ws.summary.observerState,
    };
  }

  async setWorkspacePermissions(
    input: WorkspacePermissionsUpdate
  ): Promise<WorkspacePermissions> {
    const ws = this.workspaces[input.workspaceId];
    if (!ws) {
      throw {
        code: "WORKSPACE_NOT_FOUND",
        message: "工作空间不存在",
        retryable: false,
      };
    }

    const prevModelPerm = ws.summary.modelPermission;
    if (input.modelPermission) {
      ws.summary.modelPermission = input.modelPermission;
    }
    if (input.searchPermission) {
      ws.summary.searchPermission = input.searchPermission;
    }
    if (input.observerState) {
      ws.summary.observerState = input.observerState;
    }
    if (input.excludedPaths) {
      ws.excludedPaths = [...input.excludedPaths];
    }

    // PRD §4.1.7: 若此前因未授权模型而停留在 local_scan_card，用户后来启用模型后，生成 agent_opening_message 并把 local_scan_card 折叠为证据附件
    if (prevModelPerm !== "enabled" && ws.summary.modelPermission === "enabled") {
      if (ws.activeOnboardingRunId && this.onboardingRuns[ws.activeOnboardingRunId]) {
        const run = this.onboardingRuns[ws.activeOnboardingRunId];
        run.stage = "reading";
        await this.advanceOnboardingForPreview(run.id);
        await this.advanceOnboardingForPreview(run.id);
      }
    }

    this.emit({
      type: "permissions_changed",
      workspaceId: input.workspaceId,
      timestamp: new Date().toISOString(),
    });

    return this.getWorkspacePermissions(input.workspaceId);
  }

  async getNarrativeState(id: WorkspaceId): Promise<NarrativeState> {
    const ws = this.workspaces[id];
    if (!ws) {
      return {
        availability: "unknown",
        flame: "neutral",
        stageLabel: "尚未建立项目状态",
        narrativeReason: "找不到对应工作空间",
        basisRefs: [],
        stale: false,
      };
    }
    return structuredClone(ws.narrative);
  }

  async getRuntimeStatus(): Promise<RuntimeStatus> {
    return structuredClone(this.runtime);
  }

  async updateRuntimePreference(
    patch: Partial<
      Pick<
        RuntimeStatus,
        | "windowBehaviorOnClose"
        | "launchAtLogin"
        | "notificationsEnabled"
        | "stepFunConfigured"
        | "piSidecarStatus"
      >
    >
  ): Promise<RuntimeStatus> {
    this.runtime = {
      ...this.runtime,
      ...patch,
    };
    if (patch.piSidecarStatus === "unavailable") {
      this.runtime.activeError = {
        code: "SIDECAR_UNAVAILABLE",
        message: "Pi Agent Host 进程未响应（心跳超时），当前已暂停远程推理调用，本地已持久化的历史消息与证据仍可正常审阅。",
        retryable: true,
        recoveryActionLabel: "重启 Sidecar 并重连",
      };
    } else if (patch.piSidecarStatus === "ready") {
      this.runtime.activeError = undefined;
    }

    this.emit({
      type: "runtime_status_changed",
      timestamp: new Date().toISOString(),
    });
    return structuredClone(this.runtime);
  }

  async subscribeAppEvents(onEvent: (event: AppEvent) => void): Promise<() => void> {
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }

  async observeWorkspace(workspaceId: WorkspaceId): Promise<void> {
    const ws = this.workspaces[workspaceId];
    if (!ws || ws.summary.observerState !== "active") return;
    ws.summary.lastObservedAt = new Date().toISOString();
  }

  async dismissAttentionItem(workspaceId: WorkspaceId, attentionId: ID): Promise<void> {
    for (const item of this.attentionItems) {
      if (item.workspaceId === workspaceId && item.id === attentionId) {
        item.dismissed = true;
      }
    }
  }

  async getSearchConfig(): Promise<SearchProviderConfig> {
    return structuredClone(this.searchConfig);
  }

  async saveSearchConfig(config: SearchProviderConfig): Promise<void> {
    this.searchConfig = structuredClone(config);
  }

  async testSearchConnection(_provider: SearchProviderType, _apiKey: string): Promise<{ success: boolean; message: string }> {
    return { success: true, message: "模拟连接测试通过" };
  }
}
