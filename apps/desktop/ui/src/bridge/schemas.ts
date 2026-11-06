import type {
  FlameStage,
  NarrativeState,
  RunStreamEvent,
  WorkspaceId,
  HarkUIError,
  HarkErrorCode,
} from "./HarkBridge.ts";

const VALID_FLAME_STAGES: ReadonlySet<string> = new Set([
  "neutral",
  "ember",
  "gentle",
  "bright",
  "milestone",
]);

/**
 * PRD §2.2 & §2.3:
 * 火焰由后端 NarrativeState 决定基础表达；未知阶段优雅回退到 neutral。
 * 绝不使用聊天条数、连续登录天数、按钮点击数来推算项目火势。
 */
export function resolveSafeFlameStage(state?: NarrativeState | null): FlameStage {
  if (!state || state.availability === "unknown") {
    return "neutral";
  }
  if (!VALID_FLAME_STAGES.has(state.flame)) {
    return "neutral";
  }
  return state.flame;
}

export interface FlameVisualDescriptor {
  stage: FlameStage;
  badgeText: string;
  description: string;
  coreOpacity: number;
  haloScale: number;
  warmthClass: string;
}

export function describeFlameVisual(state?: NarrativeState | null): FlameVisualDescriptor {
  const stage = resolveSafeFlameStage(state);
  if (!state || state.availability === "unknown") {
    return {
      stage: "neutral",
      badgeText: "尚未建立项目状态",
      description: "当前无已核验的项目进展快照，保持中性余光，不猜测项目健康度。",
      coreOpacity: 0.22,
      haloScale: 0.85,
      warmthClass: "from-stone-400/20 via-amber-700/10 to-transparent",
    };
  }

  switch (stage) {
    case "ember":
      return {
        stage: "ember",
        badgeText: state.stageLabel || "低伏微光 · 已有基础认识",
        description: state.narrativeReason || "已建立项目边界，近期可靠变更较少。",
        coreOpacity: 0.36,
        haloScale: 0.92,
        warmthClass: "from-[#e88e47]/25 via-[#f1bb7c]/12 to-transparent",
      };
    case "gentle":
      return {
        stage: "gentle",
        badgeText: state.stageLabel || "稳定小火 · 持续理解中",
        description: state.narrativeReason || "近期有已核验的文件阅读、代码观察或架构讨论。",
        coreOpacity: 0.52,
        haloScale: 1.0,
        warmthClass: "from-[#e88e47]/38 via-[#f1bb7c]/20 to-transparent",
      };
    case "bright":
      return {
        stage: "bright",
        badgeText: state.stageLabel || "舒展火光 · 关键脉络推进",
        description: state.narrativeReason || "近期存在明确可引用的项目决策与证据收敛。",
        coreOpacity: 0.68,
        haloScale: 1.08,
        warmthClass: "from-[#e88e47]/50 via-[#f1bb7c]/28 to-transparent",
      };
    case "milestone":
      return {
        stage: "milestone",
        badgeText: state.stageLabel || "金色暖光 · 已验证里程碑",
        description: state.narrativeReason || "后端已核验关键版本或核心架构里程碑达成。",
        coreOpacity: 0.78,
        haloScale: 1.14,
        warmthClass: "from-amber-400/55 via-[#e88e47]/32 to-transparent",
      };
    default:
      return {
        stage: "neutral",
        badgeText: "中性余光 · 待核验",
        description: state.narrativeReason || "尚未建立可信项目状态。",
        coreOpacity: 0.24,
        haloScale: 0.88,
        warmthClass: "from-stone-400/20 via-amber-700/10 to-transparent",
      };
  }
}

/**
 * PRD §7.6:
 * 流式事件去重、按 seq 单调排序、严格过滤非当前 Workspace 或非目标 RunId 的事件。
 */
export interface StreamAccumulatorState {
  workspaceId: WorkspaceId;
  runId: string;
  seenSeqs: number[];
  streamingText: string;
  activeToolLabel?: string;
  status: "idle" | "streaming" | "completed_verified" | "completed_unverified" | "cancelled" | "failed";
  persistedMessageId?: string;
  memoryReceiptId?: string;
  latestError?: HarkUIError;
}

export function createInitialStreamState(workspaceId: WorkspaceId, runId: string): StreamAccumulatorState {
  return {
    workspaceId,
    runId,
    seenSeqs: [],
    streamingText: "",
    status: "streaming",
  };
}

export function applyRunStreamEvents(
  initial: StreamAccumulatorState,
  events: RunStreamEvent[]
): StreamAccumulatorState {
  // 过滤出属于同一 workspaceId 与 runId 的事件
  const validEvents = events.filter(
    (e) =>
      e.schemaVersion === "hark.ui.v1" &&
      e.workspaceId === initial.workspaceId &&
      e.runId === initial.runId &&
      !initial.seenSeqs.includes(e.seq)
  );

  // 按 seq 升序排列
  validEvents.sort((a, b) => a.seq - b.seq);

  const next: StreamAccumulatorState = {
    ...initial,
    seenSeqs: [...initial.seenSeqs],
  };

  for (const ev of validEvents) {
    if (next.seenSeqs.includes(ev.seq)) continue;
    next.seenSeqs.push(ev.seq);

    switch (ev.type) {
      case "run_started":
        next.status = "streaming";
        break;
      case "text_delta":
        if (typeof ev.payload.delta === "string") {
          next.streamingText += ev.payload.delta;
        }
        break;
      case "tool_started":
        next.activeToolLabel = ev.payload.toolStageLabel || ev.payload.toolName || "正在读取项目上下文";
        break;
      case "tool_completed":
        next.activeToolLabel = undefined;
        break;
      case "memory_committed":
        if (ev.payload.memoryReceipt?.operationId) {
          next.memoryReceiptId = ev.payload.memoryReceipt.operationId;
        }
        break;
      case "run_completed":
        next.activeToolLabel = undefined;
        if (ev.payload.persistenceVerified && ev.payload.persistedMessageId) {
          next.status = "completed_verified";
          next.persistedMessageId = ev.payload.persistedMessageId;
        } else {
          // PRD §7.6: 模型已返回但消息保存状态未知时明确提示，禁止当作已持久化
          next.status = "completed_unverified";
        }
        break;
      case "run_cancelled":
        next.activeToolLabel = undefined;
        next.status = "cancelled";
        break;
      case "run_failed":
        next.activeToolLabel = undefined;
        next.status = "failed";
        next.latestError = ev.payload.error;
        break;
    }
  }

  return next;
}

/**
 * PRD §4.2 & §4.5:
 * Workspace 间草稿严格隔离，切换 Workspace 绝不串草稿。
 */
export type DraftStore = Record<WorkspaceId, string>;

export function getWorkspaceDraft(store: DraftStore, workspaceId?: WorkspaceId): string {
  if (!workspaceId) return "";
  return store[workspaceId] ?? "";
}

export function setWorkspaceDraft(
  store: DraftStore,
  workspaceId: WorkspaceId,
  draftText: string
): DraftStore {
  return {
    ...store,
    [workspaceId]: draftText,
  };
}

/**
 * PRD §7.7:
 * 最小错误码机器可判别映射，不靠正则猜英文报错字符串。
 */
export function resolveErrorDescriptor(code: HarkErrorCode): {
  title: string;
  explanation: string;
  actionLabel: string;
  retryable: boolean;
} {
  switch (code) {
    case "WORKSPACE_NOT_FOUND":
      return {
        title: "当前工作空间不存在或已归档",
        explanation: "后端未找到该 Workspace 的有效记录，请返回空间选择器切换项目。",
        actionLabel: "返回项目选择",
        retryable: false,
      };
    case "SCOPE_DENIED":
      return {
        title: "超出当前授权范围",
        explanation: "目标文件或记忆不在当前 Workspace 只读边界内，Hark 不会自动放宽目录权限。",
        actionLabel: "查看只读边界",
        retryable: false,
      };
    case "MODEL_NOT_CONFIGURED":
      return {
        title: "尚未配置 StepFun 模型服务",
        explanation: "当前未检测到可用模型凭据，仅可浏览本地结构初扫与已有历史记录。",
        actionLabel: "打开模型设置",
        retryable: true,
      };
    case "MODEL_PERMISSION_REQUIRED":
      return {
        title: "当前项目未开启模型对话授权",
        explanation: "你需要先在当前 Workspace 授权将必要项目片段发送给已配置模型，才可发起智能分析。",
        actionLabel: "开启模型授权",
        retryable: true,
      };
    case "SEARCH_PERMISSION_REQUIRED":
      return {
        title: "联网搜索尚未启用",
        explanation: "当前项目禁用了外部联网检索，Agent 仅依据本地已授权文件回答。",
        actionLabel: "配置联网权限",
        retryable: true,
      };
    case "ONBOARDING_WAITING":
      return {
        title: "正在认识项目中",
        explanation: "首次项目初读正在运行，请等待当前阶段完成或取消后再操作。",
        actionLabel: "查看初读进度",
        retryable: true,
      };
    case "RUN_ALREADY_ACTIVE":
      return {
        title: "当前对话已有运行中的回复",
        explanation: "同一会话同一时间仅允许一个活动 Run，你可以等待完成或停止当前生成。",
        actionLabel: "停止当前生成",
        retryable: false,
      };
    case "SOURCE_STALE":
      return {
        title: "来源证据已过期",
        explanation: "本地文件或分支自上次观察后已发生变动，该片段不能直接作为最新事实。",
        actionLabel: "标记待重新核验",
        retryable: true,
      };
    case "SOURCE_UNREADABLE":
      return {
        title: "来源暂不可读",
        explanation: "目标网页为动态空壳或本地文件已移除，Hark 不会编造未读到的正文内容。",
        actionLabel: "查看受限原因",
        retryable: true,
      };
    case "CONFLICT_REVISION":
      return {
        title: "状态版本冲突",
        explanation: "该观点或权限配置已被其他操作更新，请先同步最新后端状态。",
        actionLabel: "重新同步状态",
        retryable: true,
      };
    case "SIDECAR_UNAVAILABLE":
      return {
        title: "Pi Agent Host Sidecar 进程不可用",
        explanation: "后端 Agent Sidecar 暂时失联，前端不会切换为假演示内容，请重试连接或检查运行状态。",
        actionLabel: "重试连接 Sidecar",
        retryable: true,
      };
    case "OPERATION_CANCELLED":
      return {
        title: "操作已取消",
        explanation: "当前模型生成已被中断，此前已持久化的对话与证据均完整保留。",
        actionLabel: "重新发送",
        retryable: true,
      };
    case "CONNECTION_LOST":
      return {
        title: "Native 调用没有完成",
        explanation: "IPC 拒绝或返回了未单独映射的壳错误。界面不会改用预览数据。",
        actionLabel: "重新从 Core 读取",
        retryable: true,
      };
    case "FEATURE_UNAVAILABLE":
      return {
        title: "这项还没有接到 Native",
        explanation: "记忆、观点、检索、观察器或子工作空间尚未完成。这里不会显示 Dev Preview 里的例子。",
        actionLabel: "知道了",
        retryable: false,
      };
  }
}
