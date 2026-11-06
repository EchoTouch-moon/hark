import type {
  AppSnapshot,
  ConfirmImportInput,
  ConfirmImportResult,
  ConversationMessage,
  EvidenceDetail,
  EvidenceRef,
  HarkBridge,
  HarkErrorCode,
  HarkUIError,
  LocalScanSummaryData,
  NarrativeState,
  OnboardingRun,
  OnboardingStage,
  RootCandidate,
  RootPreview,
  RunStatus,
  RunStreamEvent,
  RuntimeStatus,
  ServicePermission,
  WorkspaceDetail,
  WorkspaceSummary,
} from "./HarkBridge.ts";

/**
 * Thin mapping from the existing Native shell camelCase DTOs.
 * This module does not call Tauri and does not know about dev-preview.
 */

export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Created before invoke so a per-turn Channel can deliver events early. */
export type TurnChannelFactory = (onEvent: (event: RunStreamEvent) => void) => unknown;

export interface NativeShellError {
  code: string;
  detail: string;
}

export interface PickTicket {
  pickToken: string;
  displayName: string;
  expiresAtUnixMs: number;
  directoryRead: string;
  remoteModel: string;
}

export interface AuthorizedRoot {
  id: string;
  path: string;
  dev: string;
  ino: string;
  status: "active" | "paused" | "revoked";
  createdAt: string;
  updatedAt: string;
}

export interface NativeWorkspace {
  id: string;
  rootId: string;
  agentId: string;
  conversationId: string;
  relativePath: string;
  dev: string;
  ino: string;
  displayName: string;
  status: string;
  createdAt: string;
}

export interface ServiceGrant {
  id: string;
  workspaceId: string;
  service: string;
  status: string;
  provider?: string | null;
  model?: string | null;
  updatedAt: string;
}

export interface ScanCandidate {
  id: string;
  relativePath: string;
  role: "single_root" | "independent_project" | "module_hint" | string;
  evidence: string[];
  suggested: boolean;
  workspaceId?: string | null;
}

export interface IgnoredEntry {
  relativePath: string;
  reason: string;
}

export interface InitialScan {
  id: string;
  rootId: string;
  status: "completed" | "limited" | "cancelled" | "failed" | string;
  coverage: string;
  limitsHit: string[];
  ignored: IgnoredEntry[];
  candidates: ScanCandidate[];
  defaultSingleProject: boolean;
  filesSeen: number;
  dirsSeen: number;
  createdAt: string;
  finishedAt: string;
}

export interface SourceRefDto {
  id: string;
  workspaceId: string;
  relativePath: string;
  contentSha256: string;
  byteLen: number;
  truncated: boolean;
  binary: boolean;
  excerpt?: string | null;
  observedAt: string;
  contentAvailable: boolean;
}

export interface ConversationEventDto {
  id: string;
  workspaceId: string;
  conversationId: string;
  kind: string;
  generation?: number | null;
  body: string;
  presentation: string;
  sourceIds: string[];
  createdAt: string;
}

export interface FirstMessageDto {
  event: ConversationEventDto;
  replayed: boolean;
  foldedLocalCard: boolean;
}

export interface ConfirmResultDto {
  workspaces: NativeWorkspace[];
  replayed: boolean;
}

export interface OnboardingCheckpointDto {
  workspaceId: string;
  generation: number;
  state: string;
  structureScanned: boolean;
  selectiveReadDone: boolean;
  modelAnalyzed: boolean;
  openingPresented: boolean;
  localCardFolded: boolean;
  modelStatus: string;
  errorCode?: string | null;
  activeRunId?: string | null;
  initialReadRequested: boolean;
}

export interface WorkspaceOverviewDto {
  workspaceId: string;
  relativePath: string;
  directoryStatus: string;
  readable: boolean;
  structureScanned: boolean;
  selectiveReadDone: boolean;
  modelAnalyzed: boolean;
  openingPresented: boolean;
  modelInference: boolean;
  sourceIds: string[];
}

export interface SidecarStatusDto {
  connected: boolean;
  transport: string;
  windowsJobObject: string;
  reason: string;
}

export interface ShellSnapshotDto {
  roots: AuthorizedRoot[];
  workspaces: NativeWorkspace[];
  readerCapability: string;
  remoteModelTransport: string;
  sidecar: SidecarStatusDto;
  notes: string[];
}

export interface SelectiveReadReportDto {
  sources: SourceRefDto[];
  skipped: string[];
}

const ID_RE = /^[a-z]+_[0-9a-fA-F]{32}$/;

export function isHarkId(value: string, prefix: string): boolean {
  return ID_RE.test(value) && value.startsWith(`${prefix}_`);
}

export function encodePreviewId(rootId: string, scanId: string): string {
  return `native:${rootId}:${scanId}`;
}

export function parsePreviewId(previewId: string): { rootId: string; scanId: string } {
  const parts = previewId.split(":");
  if (parts.length !== 3 || parts[0] !== "native") {
    throw uiError(
      "SCOPE_DENIED",
      "导入确认缺少 Native root/scan 绑定。不会把预览 id 或路径当成授权。",
      false,
    );
  }
  const rootId = parts[1] ?? "";
  const scanId = parts[2] ?? "";
  if (!isHarkId(rootId, "root") || !isHarkId(scanId, "scan")) {
    throw uiError("SCOPE_DENIED", "rootId 或 scanId 不是 Core 发的 id。", false);
  }
  return { rootId, scanId };
}

export function uiError(
  code: HarkErrorCode,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>,
): HarkUIError {
  return {
    code,
    message,
    retryable,
    ...(details ? { details } : {}),
  };
}

export function unavailable(feature: string): HarkUIError {
  return uiError(
    "FEATURE_UNAVAILABLE",
    `${feature}尚未完成。不会用 Dev Preview 数据填充，也不会为此新增后端。`,
    false,
    { feature },
  );
}

export function parseInvokeError(err: unknown): NativeShellError {
  if (err && typeof err === "object") {
    const record = err as Record<string, unknown>;
    if (typeof record.code === "string") {
      return {
        code: record.code,
        detail: typeof record.detail === "string" ? record.detail : "",
      };
    }
    if (record.error && typeof record.error === "object") {
      return parseInvokeError(record.error);
    }
  }
  if (typeof err === "string") {
    try {
      return parseInvokeError(JSON.parse(err) as unknown);
    } catch {
      const matched = /^([a-z0-9_]+):\s*(.*)$/.exec(err);
      if (matched?.[1]) {
        return { code: matched[1], detail: matched[2] ?? "" };
      }
      return { code: "invoke_rejected", detail: err.slice(0, 240) };
    }
  }
  if (err instanceof Error) {
    return { code: "invoke_rejected", detail: err.message };
  }
  return { code: "invoke_rejected", detail: "IPC 拒绝值无法识别" };
}

export function toUiError(err: unknown): HarkUIError {
  if (isUiError(err)) return err;
  const parsed = parseInvokeError(err);
  return uiError(mapNativeCode(parsed.code), `${parsed.detail || "Native 拒绝"}（${parsed.code}）`, retryableNative(parsed.code), {
    nativeCode: parsed.code,
    nativeDetail: parsed.detail,
  });
}

export function isUiError(err: unknown): err is HarkUIError {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      "message" in err &&
      "retryable" in err &&
      typeof (err as HarkUIError).message === "string",
  );
}

function mapNativeCode(code: string): HarkErrorCode {
  switch (code) {
    case "workspace_not_found":
      return "WORKSPACE_NOT_FOUND";
    case "root_paused":
    case "root_revoked":
    case "overlap_refused":
    case "path_read_closed":
    case "pick_not_found":
    case "pick_expired":
    case "invalid_id":
      return "SCOPE_DENIED";
    case "model_not_authorized":
    case "model_not_configured":
    case "sidecar_not_configured":
    case "session_key_rejected":
    case "dev_runtime_missing":
      return "MODEL_NOT_CONFIGURED";
    case "sidecar_not_connected":
      return "SIDECAR_UNAVAILABLE";
    case "scan_already_running":
    case "read_already_running":
    case "run_already_active":
      return "RUN_ALREADY_ACTIVE";
    case "invalid_message":
      return "SCOPE_DENIED";
    case "source_ref_not_found":
    case "cross_workspace_ref":
      return "SOURCE_UNREADABLE";
    case "pick_cancelled":
    case "cancelled":
    case "scan_not_running":
    case "read_not_running":
      return "OPERATION_CANCELLED";
    case "invoke_rejected":
      return "CONNECTION_LOST";
    default:
      return "CONNECTION_LOST";
  }
}

function retryableNative(code: string): boolean {
  return (
    code === "scan_already_running" ||
    code === "read_already_running" ||
    code === "run_already_active" ||
    code === "invoke_rejected" ||
    code === "sqlite" ||
    code === "io" ||
    code === "timeout" ||
    code === "persistence_unknown"
  );
}

export function modelConfiguredFromSnapshot(snapshot: ShellSnapshotDto): boolean {
  return snapshot.remoteModelTransport !== "closed_no_approved_key" && snapshot.sidecar.connected;
}

export function mapRuntime(snapshot: ShellSnapshotDto): RuntimeStatus {
  return {
    bridgeMode: "tauri_ipc",
    rustCoreStatus: "healthy",
    piSidecarStatus: snapshot.sidecar.connected ? "ready" : "unavailable",
    stepFunConfigured: modelConfiguredFromSnapshot(snapshot),
    mcpSearchConfigured: false,
    windowBehaviorOnClose: "hide_to_tray",
    launchAtLogin: false,
    notificationsEnabled: false,
  };
}

function permissionFromGrant(grants: ServiceGrant[] | undefined, service: string): ServicePermission {
  if (!grants) return "unavailable";
  const grant = grants.find((item) => item.service === service);
  if (!grant) return "unavailable";
  if (grant.status === "enabled") return "enabled";
  if (grant.status === "disabled" || grant.status === "paused" || grant.status === "revoked") {
    return "disabled";
  }
  return "unavailable";
}

export function mapWorkspaceSummary(
  workspace: NativeWorkspace,
  roots: AuthorizedRoot[],
  grants?: ServiceGrant[],
  overview?: WorkspaceOverviewDto,
): WorkspaceSummary {
  const root = roots.find((item) => item.id === workspace.rootId);
  const display = root?.path
    ? workspace.relativePath
      ? `${root.path}/${workspace.relativePath}`
      : root.path
    : workspace.relativePath || workspace.displayName;
  return {
    id: workspace.id,
    name: workspace.displayName || "未命名项目",
    rootDisplayPath: display,
    lifecycle: workspace.status === "active" ? "active" : "unavailable",
    agentStatus: overview?.selectiveReadDone ? "idle" : "reading",
    currentConversationId: workspace.conversationId,
    lastObservedAt: workspace.createdAt,
    overviewFreshness: overview ? "fresh" : "unknown",
    modelPermission: permissionFromGrant(grants, "model"),
    searchPermission: permissionFromGrant(grants, "search"),
    observerState: "unavailable",
  };
}

export function unknownNarrative(sourceIds: string[] = []): NarrativeState {
  return {
    availability: "unknown",
    flame: "neutral",
    stageLabel: "尚无叙事状态",
    narrativeReason: "Native 没有叙事命令。火势保持中性，不按聊天条数或导入次数推断。",
    basisRefs: sourceIds,
    stale: false,
  };
}

export function mapCheckpoint(checkpoint: OnboardingCheckpointDto): OnboardingRun {
  return {
    id: checkpoint.activeRunId ?? `checkpoint:${checkpoint.workspaceId}`,
    workspaceId: checkpoint.workspaceId,
    stage: mapOnboardingStage(checkpoint),
    progressText: describeCheckpoint(checkpoint),
    latestErrorCode: checkpoint.errorCode ?? undefined,
    lastUpdatedAt: checkpoint.workspaceId,
  };
}

function mapOnboardingStage(checkpoint: OnboardingCheckpointDto): OnboardingStage {
  switch (checkpoint.state) {
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "presented":
      return "completed";
    case "waiting_for_model_auth":
      return "waiting_for_model_auth";
    case "analyzing":
      return "analyzing";
    case "reading":
      return "reading";
    case "message_ready":
      return "message_ready";
    case "workspace_created":
      return "boundary_review";
    default:
      return "paused";
  }
}

function describeCheckpoint(checkpoint: OnboardingCheckpointDto): string {
  if (checkpoint.state === "cancelled") {
    return "认识已取消。已写入的本地卡不会被这条取消删掉。";
  }
  if (checkpoint.openingPresented || checkpoint.modelAnalyzed) {
    return "Core checkpoint 标记模型开场已提交。界面只展示已持久化结果，不在前端补写理解。";
  }
  if (
    checkpoint.state === "waiting_for_model_auth" ||
    checkpoint.modelStatus === "disabled" ||
    checkpoint.modelStatus === "unavailable"
  ) {
    return "本地发现卡不是模型理解。模型未配置，开场等待。默认壳没有已批准的模型，普通聊天失败时不会伪造回复。";
  }
  if (checkpoint.selectiveReadDone && !checkpoint.modelAnalyzed) {
    return "选择性读取已完成。若本地卡尚未出现，需要 commit_local_scan_card 的真实返回，而不是前端补一张卡。";
  }
  if (checkpoint.structureScanned) {
    return "结构初扫已在 Core。确认导入后才会选择性读取关键文件。";
  }
  if (checkpoint.errorCode) {
    return `认识未完成：${checkpoint.errorCode}。没有伪造开场。`;
  }
  return `Core onboarding 状态：${checkpoint.state}。没有业务事件通道，只展示这条 checkpoint。`;
}

export function mapSourceRef(source: SourceRefDto): EvidenceDetail {
  const visible = source.contentAvailable && !source.binary && Boolean(source.excerpt);
  const availability = source.contentAvailable ? "available" : "restricted";
  return {
    id: source.id,
    workspaceId: source.workspaceId,
    kind: "file_read",
    title: source.relativePath || source.id,
    displayLocation: source.relativePath || "（无相对路径）",
    observedAt: source.observedAt,
    availability,
    verificationLevel: visible ? (source.truncated ? "partial_text" : "partial_text") : "metadata",
    excerpt: visible ? (source.excerpt ?? "") : "",
    unreadableReason: visible
      ? undefined
      : source.binary
        ? "二进制文件。壳只返回可见状态，不会按路径再读。"
        : "摘录不可见。不会按任意路径再读文件。",
  };
}

export function mapSourceRefList(source: SourceRefDto): EvidenceRef {
  const detail = mapSourceRef(source);
  return {
    id: detail.id,
    workspaceId: detail.workspaceId,
    kind: detail.kind,
    title: detail.title,
    displayLocation: detail.displayLocation,
    observedAt: detail.observedAt,
    availability: detail.availability,
    verificationLevel: detail.verificationLevel,
  };
}

export function mapConversationEvent(
  event: ConversationEventDto,
  sources: SourceRefDto[],
  modelAnalyzed: boolean,
): ConversationMessage {
  const sourceRefs = event.sourceIds;
  const base: ConversationMessage = {
    id: event.id,
    workspaceId: event.workspaceId,
    conversationId: event.conversationId,
    role: event.kind === "user_message" ? "user" : event.kind === "local_scan_card" ? "system_notice" : "assistant",
    kind:
      event.kind === "local_scan_card"
        ? "local_scan_card"
        : event.kind === "agent_opening_message"
          ? "agent_opening_message"
          : "text",
    content: event.body,
    persistedAt: event.createdAt,
    status: "persisted",
    sourceRefs,
  };
  if (event.kind === "local_scan_card") {
    base.localScanData = localScanSummary(event, sources, modelAnalyzed);
  }
  return base;
}

function localScanSummary(
  event: ConversationEventDto,
  sources: SourceRefDto[],
  modelAnalyzed: boolean,
): LocalScanSummaryData {
  const related = sources.filter((source) => event.sourceIds.includes(source.id));
  const manifests = related.map((source) => source.relativePath).filter((path) => path.length > 0);
  return {
    scannedFilesCount: related.length,
    detectedLanguages: ["未做模型识别"],
    keyManifests: manifests.length > 0 ? manifests : ["尚未选读关键文件"],
    unverifiedAreas: [
      "这是 Core 的 local_scan_card，不是模型理解。",
      "计数是已选读来源，不是整树文件普查。",
      event.presentation === "folded_evidence"
        ? "这张卡已被 Core 标为折叠证据，正文仍是当时写入的本地说明。"
        : "不能据此声称完整阅读、构建或外网研究。",
    ],
    modelAuthRequired: !modelAnalyzed,
  };
}

export function mapScanToPreview(
  ticket: PickTicket,
  root: AuthorizedRoot,
  scan: InitialScan,
): RootPreview {
  const candidates = scan.candidates.map((candidate) => mapCandidate(candidate, ticket.displayName));
  return {
    previewId: encodePreviewId(root.id, scan.id),
    displayPath: `${ticket.displayName} · ${root.path}`,
    scanStatus:
      scan.status === "completed" ? "ready" : scan.status === "limited" ? "partial" : "failed",
    candidates,
    uncoveredReasons: [
      ...scan.limitsHit.map((hit) => `预算：${hit}`),
      ...scan.ignored.map((item) => `${item.relativePath || "（根）"}：${item.reason}`),
      `覆盖：${scan.coverage}。结构计数 files=${scan.filesSeen} dirs=${scan.dirsSeen}，不是模型阅读数。`,
    ],
    recommendedMode: scan.defaultSingleProject ? "single" : "select_candidates",
    defaultExcludedPaths: scan.ignored.map((item) => item.relativePath).filter((path) => path.length > 0),
    readOnlyBoundaryNote: `只读。显示名「${ticket.displayName}」。授权只用一次性 pickToken，确认时不回传路径。模型传输标记：${ticket.remoteModel}。壳内模型初读固定关闭。`,
  };
}

function mapCandidate(candidate: ScanCandidate, displayName: string): RootCandidate {
  const classification =
    candidate.role === "single_root"
      ? "single_project"
      : candidate.role === "independent_project"
        ? "independent_project"
        : candidate.role === "module_hint"
          ? "module"
          : "uncertain";
  return {
    candidateId: candidate.id,
    relativePath: candidate.relativePath || ".",
    suggestedName: candidate.relativePath ? candidate.relativePath : displayName || "整个目录",
    classification,
    reasons: candidate.evidence.length > 0 ? candidate.evidence : ["Core 未附带额外依据"],
    selectable: candidate.role !== "module_hint",
  };
}

export function buildConfirmArgs(input: ConfirmImportInput): { request: Record<string, unknown> } {
  const { rootId, scanId } = parsePreviewId(input.previewId);
  if (input.nativeSelection !== "single" && input.nativeSelection !== "selected") {
    throw uiError("SCOPE_DENIED", "缺少 nativeSelection。不会猜测 single 或 selected。", false);
  }
  let selection: Record<string, unknown>;
  if (input.nativeSelection === "single") {
    selection = { kind: "single" };
  } else {
    if (input.selectedCandidateIds.length === 0) {
      throw uiError("SCOPE_DENIED", "selected 确认没有 candidateId。", false);
    }
    for (const id of input.selectedCandidateIds) {
      if (!isHarkId(id, "cand")) {
        throw uiError("SCOPE_DENIED", `candidateId 无效：${id}`, false);
      }
    }
    selection = { kind: "selected", candidateIds: input.selectedCandidateIds };
  }
  const request = { rootId, scanId, selection };
  assertNoClosedFields(request);
  return { request };
}

const CLOSED_FIELDS = [
  "path",
  "success",
  "approved",
  "risk",
  "completed",
  "enableModelInitialRead",
  "enableWebSearch",
  "customExcludedPaths",
  "requestId",
  "previewId",
];

export function assertNoClosedFields(value: Record<string, unknown>): void {
  for (const key of CLOSED_FIELDS) {
    if (key in value) {
      throw uiError("SCOPE_DENIED", `确认体不能包含 ${key}。`, false);
    }
  }
  const selection = value.selection;
  if (!selection || typeof selection !== "object") {
    throw uiError("SCOPE_DENIED", "确认体缺少 selection。", false);
  }
  for (const key of CLOSED_FIELDS) {
    if (key in (selection as Record<string, unknown>)) {
      throw uiError("SCOPE_DENIED", `selection 不能包含 ${key}。`, false);
    }
  }
}

export function mapAppSnapshot(snapshot: ShellSnapshotDto, workspaces: NativeWorkspace[]): AppSnapshot {
  const ordered = [...workspaces].sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
  return {
    schemaVersion: "hark.ui.v1",
    appVersion: "r1-native",
    workspaces: ordered.map((workspace) => mapWorkspaceSummary(workspace, snapshot.roots)),
    currentWorkspaceId: ordered[0]?.id,
    runtime: mapRuntime(snapshot),
    attentionItems: [],
  };
}

export interface AgentTurnStatusDto {
  runId: string;
  workspaceId: string;
  conversationId: string;
  state: RunStatus["state"] | string;
  persistedAssistantMessageId?: string;
  latestError?: { code: string; message: string; retryable: boolean };
}

const TURN_STATES = ["running", "completed", "cancelled", "failed", "persistence_unknown"] as const;

function isTurnState(value: string): value is RunStatus["state"] {
  return (TURN_STATES as readonly string[]).includes(value);
}

export function mapAgentTurnStatus(
  status: AgentTurnStatusDto,
  fallbackConversationId?: string,
): RunStatus {
  return {
    runId: status.runId,
    workspaceId: status.workspaceId,
    conversationId: status.conversationId || fallbackConversationId || "",
    state: isTurnState(status.state) ? status.state : "persistence_unknown",
    ...(status.persistedAssistantMessageId
      ? { persistedAssistantMessageId: status.persistedAssistantMessageId }
      : {}),
    ...(status.latestError
      ? {
          latestError: uiError(
            mapNativeCode(status.latestError.code),
            status.latestError.message,
            status.latestError.retryable,
            { nativeCode: status.latestError.code },
          ),
        }
      : {}),
  };
}

function assertTurnInput(input: {
  requestId: string;
  workspaceId: string;
  conversationId: string;
  userPrompt: string;
}): void {
  const requestId = input.requestId.trim();
  if (!requestId || requestId.length > 128 || /[\u0000-\u001f]/.test(requestId)) {
    throw uiError("SCOPE_DENIED", "requestId 不能作为幂等键。不会开始回合。", false);
  }
  if (!isHarkId(input.workspaceId, "ws") || !isHarkId(input.conversationId, "conv")) {
    throw uiError("WORKSPACE_NOT_FOUND", "workspaceId 或 conversationId 不是 Core id。", false);
  }
  if (!input.userPrompt.trim()) {
    throw uiError("SCOPE_DENIED", "userPrompt 为空。不会伪造回复。", false);
  }
}

export function createTauriHarkBridge(
  invoke: InvokeFn,
  options?: { turnChannel?: TurnChannelFactory },
): HarkBridge {
  const turnChannel = options?.turnChannel;
  const cache = {
    roots: [] as AuthorizedRoot[],
    workspaces: [] as NativeWorkspace[],
    snapshot: null as ShellSnapshotDto | null,
    focusWorkspaceId: undefined as string | undefined,
    runs: new Map<string, { workspaceId: string; conversationId: string }>(),
  };

  const call = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      return await invoke<T>(cmd, args);
    } catch (err) {
      throw toUiError(err);
    }
  };

  const remember = (roots: AuthorizedRoot[], workspaces: NativeWorkspace[], snapshot?: ShellSnapshotDto) => {
    cache.roots = roots;
    cache.workspaces = workspaces;
    if (snapshot) cache.snapshot = snapshot;
  };

  const ensureRoots = async (): Promise<AuthorizedRoot[]> => {
    if (cache.roots.length > 0) return cache.roots;
    const roots = await call<AuthorizedRoot[]>("list_roots");
    cache.roots = roots;
    return roots;
  };

  const workspaceById = async (workspaceId: string): Promise<NativeWorkspace> => {
    if (!isHarkId(workspaceId, "ws")) {
      throw uiError("WORKSPACE_NOT_FOUND", "workspaceId 不是 Core id。", false);
    }
    const cached = cache.workspaces.find((item) => item.id === workspaceId);
    if (cached) return cached;
    const workspace = await call<NativeWorkspace>("get_workspace", { workspaceId });
    cache.workspaces = [...cache.workspaces.filter((item) => item.id !== workspace.id), workspace];
    return workspace;
  };

  const workspaceForConversation = async (conversationId: string): Promise<NativeWorkspace> => {
    const cached = cache.workspaces.find((item) => item.conversationId === conversationId);
    if (cached) return cached;
    const listed = await call<NativeWorkspace[]>("list_workspaces");
    cache.workspaces = listed;
    const found = listed.find((item) => item.conversationId === conversationId || item.id === conversationId);
    if (!found) {
      throw uiError("WORKSPACE_NOT_FOUND", "没有与该会话对应的 Core workspace。", false);
    }
    return found;
  };

  const bridge: HarkBridge = {
    async getAppSnapshot() {
      const snapshot = await call<ShellSnapshotDto>("shell_snapshot");
      const workspaces = await call<NativeWorkspace[]>("list_workspaces");
      remember(snapshot.roots, workspaces, snapshot);
      return mapAppSnapshot(snapshot, workspaces);
    },
    async previewRoot() {
      throw uiError(
        "SCOPE_DENIED",
        "Native 模式不能用输入路径预览或授权。请使用系统文件夹选择器。",
        false,
        { nativeCode: "path_read_closed" },
      );
    },
    async pickAndScan() {
      const ticket = await call<PickTicket>("pick_directory");
      if (!ticket.pickToken || ticket.pickToken.includes("/") || ticket.pickToken.includes("\\")) {
        throw uiError("SCOPE_DENIED", "picker 没有返回可用的无路径 token。", false);
      }
      const root = await call<AuthorizedRoot>("authorize_picked", {
        request: { pickToken: ticket.pickToken },
      });
      const scan = await call<InitialScan>("scan_root", { rootId: root.id });
      cache.roots = [...cache.roots.filter((item) => item.id !== root.id), root];
      return mapScanToPreview(ticket, root, scan);
    },
    async confirmImport(input) {
      const args = buildConfirmArgs(input);
      const result = await call<ConfirmResultDto>("confirm_import", args);
      if (!result.workspaces.length) {
        throw uiError("WORKSPACE_NOT_FOUND", "confirm_import 没有返回 workspace。不会补造一个。", false);
      }
      cache.workspaces = result.workspaces;
      const focused = result.workspaces[0];
      if (!focused) {
        throw uiError("WORKSPACE_NOT_FOUND", "confirm_import 没有可聚焦的 workspace。", false);
      }
      return {
        workspaceIds: result.workspaces.map((item) => item.id),
        focusedWorkspaceId: focused.id,
        onboardingRunId: `checkpoint:${focused.id}`,
      } satisfies ConfirmImportResult;
    },
    async continueLocalRecognition(workspaceId) {
      if (!isHarkId(workspaceId, "ws")) {
        throw uiError("WORKSPACE_NOT_FOUND", "不能对无效 workspace 做选择性读取。", false);
      }
      await call<SelectiveReadReportDto>("selective_key_read", { workspaceId });
      await call<FirstMessageDto>("commit_local_scan_card", { workspaceId });
    },
    async createChildWorkspace() {
      throw unavailable("子工作空间 / 父目录排除");
    },
    async listWorkspaces() {
      const workspaces = await call<NativeWorkspace[]>("list_workspaces");
      const roots = await ensureRoots();
      cache.workspaces = workspaces;
      return workspaces.map((workspace) => mapWorkspaceSummary(workspace, roots));
    },
    async getWorkspace(workspaceId) {
      cache.focusWorkspaceId = workspaceId;
      const workspace = await workspaceById(workspaceId);
      const [overview, grants, checkpoint, sources, roots] = await Promise.all([
        call<WorkspaceOverviewDto>("workspace_overview", { workspaceId }),
        call<ServiceGrant[]>("service_grants", { workspaceId }),
        call<OnboardingCheckpointDto>("onboarding", { workspaceId }),
        call<SourceRefDto[]>("list_source_refs", { workspaceId }),
        ensureRoots(),
      ]);
      const summary = mapWorkspaceSummary(workspace, roots, grants, overview);
      const detail: WorkspaceDetail = {
        summary,
        excludedPaths: [],
        readOnlyPaths: sources.map((source) => source.relativePath).filter((path) => path.length > 0),
        narrative: unknownNarrative(overview.sourceIds),
        activeOnboardingRunId: checkpoint.activeRunId ?? `checkpoint:${workspaceId}`,
        rootId: workspace.rootId,
        directoryStatus: roots.find((root) => root.id === workspace.rootId)?.status,
      };
      return detail;
    },
    async updateWorkspaceState() {
      throw unavailable("文件观察器");
    },
    async getOnboardingRun(runId) {
      const workspaceId = runId.startsWith("checkpoint:") ? runId.slice("checkpoint:".length) : runId;
      if (!isHarkId(workspaceId, "ws")) {
        throw unavailable("按任意 runId 查询 onboarding");
      }
      return mapCheckpoint(await call<OnboardingCheckpointDto>("onboarding", { workspaceId }));
    },
    async getConversation(conversationId) {
      const workspace = await workspaceForConversation(conversationId);
      const [events, sources, checkpoint] = await Promise.all([
        call<ConversationEventDto[]>("list_conversation", { workspaceId: workspace.id }),
        call<SourceRefDto[]>("list_source_refs", { workspaceId: workspace.id }),
        call<OnboardingCheckpointDto>("onboarding", { workspaceId: workspace.id }),
      ]);
      return {
        workspaceId: workspace.id,
        conversationId: workspace.conversationId,
        messages: events.map((event) => mapConversationEvent(event, sources, checkpoint.modelAnalyzed)),
      };
    },
    async startAgentTurn(input, onEvent) {
      assertTurnInput(input);
      if (!turnChannel) {
        throw uiError(
          "SIDECAR_UNAVAILABLE",
          "Turn channel 未绑定。不会伪造流式事件，也不会把候选标成已保存。",
          false,
        );
      }
      const events: RunStreamEvent[] = [];
      const channel = turnChannel((event) => {
        events.push(event);
        onEvent(event);
      });
      const result = await call<{
        runId: string;
        acceptedUserMessage: ConversationEventDto;
      }>("start_agent_turn", {
        request: {
          requestId: input.requestId.trim(),
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          userPrompt: input.userPrompt,
        },
        onEvent: channel,
      });
      if (!isHarkId(result.runId, "run")) {
        throw uiError("CONNECTION_LOST", "start_agent_turn 没有返回 Core runId。不会补造完成事件。", true);
      }
      cache.runs.set(result.runId, {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
      });
      if (events.some((event) => event.type === "run_completed" && event.payload.persistenceVerified !== true)) {
        throw uiError(
          "CONNECTION_LOST",
          "run_completed 没有 persistenceVerified。不会把候选当已保存。",
          true,
        );
      }
      return {
        runId: result.runId,
        acceptedUserMessage: mapConversationEvent(result.acceptedUserMessage, [], false),
      };
    },
    async getRunStatus(runId) {
      const owned = cache.runs.get(runId);
      if (!owned) {
        throw uiError(
          "CONNECTION_LOST",
          "没有这个 run 的 workspace 归属。不会猜测 workspace，也不会把候选当完成。",
          true,
        );
      }
      const status = await call<AgentTurnStatusDto>("get_agent_turn", {
        request: { workspaceId: owned.workspaceId, runId },
      });
      return mapAgentTurnStatus(status, owned.conversationId);
    },
    async cancelAgentTurn(runId) {
      const owned = cache.runs.get(runId);
      if (!owned) {
        throw uiError(
          "CONNECTION_LOST",
          "没有这个 run 的 workspace 归属。不会猜测 workspace 来取消。",
          true,
        );
      }
      const status = await call<AgentTurnStatusDto>("cancel_agent_turn", {
        request: { workspaceId: owned.workspaceId, runId },
      });
      return mapAgentTurnStatus(status, owned.conversationId);
    },
    async getOpinion() {
      throw unavailable("观点");
    },
    async listWorkspaceOpinions() {
      return [];
    },
    async submitOpinionFeedback() {
      throw unavailable("观点反馈");
    },
    async revertMemoryOperation() {
      throw unavailable("记忆撤销");
    },
    async getEvidence(evidenceId) {
      const workspaceId = cache.focusWorkspaceId;
      if (!workspaceId) {
        throw uiError("SOURCE_UNREADABLE", "没有当前 workspace，不会按路径查找来源。", false);
      }
      const source = await call<SourceRefDto>("get_source_ref", {
        request: { workspaceId, sourceId: evidenceId },
      });
      return mapSourceRef(source);
    },
    async listWorkspaceEvidence(workspaceId) {
      cache.focusWorkspaceId = workspaceId;
      const sources = await call<SourceRefDto[]>("list_source_refs", { workspaceId });
      return sources.map(mapSourceRefList);
    },
    async searchWorkspaceMemory() {
      throw unavailable("记忆 / FTS 检索");
    },
    async getWorkspacePermissions(workspaceId) {
      const grants = await call<ServiceGrant[]>("service_grants", { workspaceId });
      return {
        workspaceId,
        revision: 0,
        readOnlyPaths: [],
        excludedPaths: [],
        modelPermission: permissionFromGrant(grants, "model"),
        searchPermission: permissionFromGrant(grants, "search"),
        observerState: "unavailable" as const,
      };
    },
    async setWorkspacePermissions(input) {
      const extra = input.searchPermission !== undefined || input.observerState !== undefined || input.excludedPaths !== undefined;
      if (extra || (input.modelPermission !== "enabled" && input.modelPermission !== "disabled")) {
        throw unavailable("搜索、观察或路径授权");
      }
      await call("set_model_grant", {
        request: { workspaceId: input.workspaceId, enabled: input.modelPermission === "enabled" },
      });
      return this.getWorkspacePermissions(input.workspaceId);
    },
    async getNarrativeState(workspaceId) {
      const overview = await call<WorkspaceOverviewDto>("workspace_overview", { workspaceId });
      return unknownNarrative(overview.sourceIds);
    },
    async getRuntimeStatus() {
      const snapshot = await call<ShellSnapshotDto>("shell_snapshot");
      cache.snapshot = snapshot;
      cache.roots = snapshot.roots;
      return mapRuntime(snapshot);
    },
    async updateRuntimePreference() {
      throw unavailable("前端拨动模型、Sidecar 或窗口偏好开关");
    },
    async subscribeAppEvents() {
      return () => {};
    },
    async hideWindow() {
      await call<void>("hide_window");
    },
    async quitApp() {
      await call<void>("quit_app");
    },
    async pauseDirectory(rootId) {
      await call<AuthorizedRoot>("pause_directory", { rootId });
    },
    async resumeDirectory(rootId) {
      await call<AuthorizedRoot>("resume_directory", { rootId });
    },
    async revokeDirectory(rootId) {
      await call<AuthorizedRoot>("revoke_directory", { rootId });
    },
    async configureStepFunSession(apiKey) {
      return call("configure_stepfun_session", { request: { apiKey } });
    },
    async clearStepFunSession() {
      return call("clear_stepfun_session");
    },
    async stepFunSessionStatus() {
      return call("stepfun_session_status");
    },
    async startConfiguredOpening(workspaceId) {
      await call("start_configured_opening", { request: { workspaceId } });
    },
  };

  return bridge;
}

export function selectBridge(input: {
  mode: "dev_preview_synthetic" | "strict_tauri_ipc";
  hostAvailable: boolean;
  invoke: InvokeFn;
  devPreview: HarkBridge;
  unavailable: HarkBridge;
  turnChannel?: TurnChannelFactory;
}): HarkBridge {
  if (input.mode === "dev_preview_synthetic") {
    return input.devPreview;
  }
  if (!input.hostAvailable) {
    return input.unavailable;
  }
  return createTauriHarkBridge(input.invoke, { turnChannel: input.turnChannel });
}
