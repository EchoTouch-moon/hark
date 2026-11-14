import type {
  AppEvent,
  AppSnapshot,
  AttentionItem,
  ConfirmImportInput,
  ConfirmImportResult,
  ConversationMessage,
  EvidenceDetail,
  EvidenceRef,
  FlameStage,
  HarkBridge,
  HarkErrorCode,
  HarkUIError,
  LocalScanSummaryData,
  MemoryReceiptData,
  MemorySearchItem,
  MemorySearchPage,
  OpinionView,
  OutboundReviewRef,
  NarrativeState,
  OnboardingRun,
  OnboardingStage,
  RootCandidate,
  RootPreview,
  RunStatus,
  RunStreamEvent,
  RuntimeStatus,
  SearchProviderConfig,
  SearchProviderType,
  ServicePermission,
  WorkspaceDetail,
  WorkspaceSummary,
} from "./HarkBridge.ts";

/**
 * Thin mapping from the existing Native shell camelCase DTOs.
 * This module does not call Tauri and does not know about dev-preview.
 */

import { projectMemoryReceipts, type StoredMemoryReceipt } from "./receipt-projection.ts";
import { z } from "zod";

export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Created before invoke so a per-turn Channel can deliver events early. */
export type TurnChannelFactory = (onEvent: (event: RunStreamEvent) => void) => unknown;

/** Optional Tauri app-event listener injected by tauri-bridge. */
export type AppEventListener = (onEvent: (event: AppEvent) => void) => Promise<() => void>;

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
  modelTransportAvailable?: boolean;
  credentialError?: string | null;
  credentialPersistenceAvailable?: boolean;
  sidecar: SidecarStatusDto;
  notes: string[];
}

export interface SelectiveReadReportDto {
  sources: SourceRefDto[];
  skipped: string[];
}

export interface NarrativeStateDto {
  availability: string;
  flame: string;
  stageLabel: string;
  narrativeReason: string;
  basisRefs?: string[];
  observedAt?: string | null;
  stale?: boolean;
}

export interface AttentionItemDto {
  id: string;
  workspaceId: string;
  workspaceName: string;
  conversationId: string;
  headline: string;
  whyNow: string;
  targetOpinionId?: string | null;
  targetEvidenceId?: string | null;
  createdAt: string;
  dismissed?: boolean;
}

export interface ObserverStatusDto {
  workspaceId: string;
  observerState: string;
  paused: boolean;
}

export interface SearchConfigResponseDto {
  activeProvider: string;
  configuredProviders?: string[];
  providers?: Record<string, { apiKey?: string | null; endpoint?: string | null }>;
}

const ID_RE = /^[a-z]+_[0-9a-fA-F]{32}$/;
const outboundReviewSchema = z.object({
  reviewId: z.string().regex(/^review_[0-9a-f]{32}$/),
  workspaceId: z.string().regex(/^ws_[0-9a-f]{32}$/),
  runId: z.string().regex(/^run_[0-9a-f]{32}$/),
  recipient: z.string().min(1).max(2048),
  model: z.string().min(1).max(256),
  limits: z.array(z.object({ label: z.string().min(1).max(256), value: z.string().max(1024) }).strict()).max(32),
  sources: z.array(z.object({ sourceId: z.string().min(1).max(128), path: z.string().min(1).max(1024), version: z.string().min(1).max(256), byteLen: z.number().int().nonnegative().safe(), truncated: z.boolean() }).strict()).max(128),
  body: z.string().min(1).max(512 * 1024),
}).strict();

function assertOutboundRef(ref: OutboundReviewRef): void {
  if (!isHarkId(ref.workspaceId, "ws") || !isHarkId(ref.runId, "run") || !/^review_[0-9a-f]{32}$/.test(ref.reviewId)) {
    throw uiError("SCOPE_DENIED", "无法确认待审请求的所属项目和运行。", false);
  }
}

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
      return "MODEL_PERMISSION_REQUIRED";
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
    case "conflict_revision":
      return "CONFLICT_REVISION";
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
  return snapshot.remoteModelTransport === "stepfun_session_memory";
}

export function mapRuntime(snapshot: ShellSnapshotDto): RuntimeStatus {
  return {
    bridgeMode: "tauri_ipc",
    rustCoreStatus: "healthy",
    piSidecarStatus: snapshot.sidecar.connected ? "ready" : "unavailable",
    stepFunConfigured: modelConfiguredFromSnapshot(snapshot),
    modelTransportAvailable: snapshot.modelTransportAvailable === true,
    credentialError: snapshot.credentialError,
    credentialPersistenceAvailable: snapshot.credentialPersistenceAvailable === true,
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

export function deriveObserverState(
  directoryStatus?: AuthorizedRoot["status"],
  grants?: ServiceGrant[],
): WorkspaceSummary["observerState"] {
  if (directoryStatus === "revoked") return "unauthorized";
  if (directoryStatus === "paused") return "paused";
  if (!grants) return "unavailable";
  const bgGrant = grants.find((item) => item.service === "background_model");
  if (bgGrant?.status === "paused") return "paused";
  if (bgGrant?.status === "revoked") return "unauthorized";
  return "active";
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
    observerState: deriveObserverState(root?.status, grants),
  };
}

const VALID_FLAMES: ReadonlySet<FlameStage> = new Set([
  "neutral",
  "ember",
  "gentle",
  "bright",
  "milestone",
]);

export function mapNarrativeState(dto: NarrativeStateDto): NarrativeState {
  const availability = dto.availability === "known" ? "known" : "unknown";
  const flame: FlameStage = VALID_FLAMES.has(dto.flame as FlameStage)
    ? (dto.flame as FlameStage)
    : "neutral";
  return {
    availability,
    flame,
    stageLabel: dto.stageLabel || "尚无叙事状态",
    narrativeReason: dto.narrativeReason || "等待更多项目资料。",
    basisRefs: Array.isArray(dto.basisRefs) ? dto.basisRefs : [],
    ...(dto.observedAt ? { observedAt: dto.observedAt } : {}),
    stale: Boolean(dto.stale),
  };
}

export function mapAttentionItem(dto: AttentionItemDto): AttentionItem {
  return {
    id: dto.id,
    workspaceId: dto.workspaceId,
    workspaceName: dto.workspaceName,
    conversationId: dto.conversationId,
    headline: dto.headline,
    whyNow: dto.whyNow,
    ...(dto.targetOpinionId ? { targetOpinionId: dto.targetOpinionId } : {}),
    ...(dto.targetEvidenceId ? { targetEvidenceId: dto.targetEvidenceId } : {}),
    createdAt: dto.createdAt,
    dismissed: Boolean(dto.dismissed),
  };
}

export function unknownNarrative(sourceIds: string[] = []): NarrativeState {
  return {
    availability: "unknown",
    flame: "neutral",
    stageLabel: "尚无叙事状态",
    narrativeReason: "等待更多项目资料。",
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
  if (checkpoint.openingPresented) {
    return "completed";
  }
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
    return "已取消，之前读取的资料仍然保留。";
  }
  if (checkpoint.openingPresented || checkpoint.modelAnalyzed) {
    return "项目的初步分析已完成。";
  }
  if (
    checkpoint.state === "waiting_for_model_auth" ||
    checkpoint.modelStatus === "disabled" ||
    checkpoint.modelStatus === "unavailable"
  ) {
    return "本地资料已准备好。配置并授权 AI 后，可以继续分析。";
  }
  if (checkpoint.selectiveReadDone && !checkpoint.modelAnalyzed) {
    return "已读取部分项目资料。";
  }
  if (checkpoint.structureScanned) {
    return "已检查项目结构，确认后将读取相关资料。";
  }
  if (checkpoint.errorCode) {
    return "项目资料读取未完成，请检查项目权限后重试。";
  }
  return "项目资料准备中。";
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
      `已检查 ${scan.filesSeen} 个文件和 ${scan.dirsSeen} 个文件夹。`,
    ],
    recommendedMode: scan.defaultSingleProject ? "single" : "select_candidates",
    defaultExcludedPaths: scan.ignored.map((item) => item.relativePath).filter((path) => path.length > 0),
    readOnlyBoundaryNote: "Hark 只会读取你选择的文件夹，不会修改文件或运行项目中的命令。",
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
    reasons: candidate.evidence.length > 0 ? candidate.evidence : ["所选文件夹"],
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

export function mapAppSnapshot(
  snapshot: ShellSnapshotDto,
  workspaces: NativeWorkspace[],
  attentionItems: AttentionItem[] = [],
): AppSnapshot {
  const ordered = [...workspaces].sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
  return {
    schemaVersion: "hark.ui.v1",
    appVersion: "r1-native",
    workspaces: ordered.map((workspace) => mapWorkspaceSummary(workspace, snapshot.roots)),
    currentWorkspaceId: ordered[0]?.id,
    runtime: mapRuntime(snapshot),
    attentionItems,
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
          latestError: mapTurnError(status.latestError),
        }
      : {}),
  };
}

function mapTurnError(error: { code: string; message: string; retryable: boolean }): HarkUIError {
  if (error.message.includes("network guard refused: no explicit fetch was injected")) {
    return uiError("CONNECTION_LOST", "AI 服务连接暂不可用，请稍后再试。", false);
  }
  if (error.code === "model_not_authorized") {
    return uiError("CONNECTION_LOST", "AI 服务无法完成请求，请检查连接和项目权限。", error.retryable);
  }
  return uiError(mapNativeCode(error.code), error.message, error.retryable, { nativeCode: error.code });
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

const VALID_SEARCH_PROVIDERS: ReadonlySet<string> = new Set([
  "tavily",
  "zhipu_mcp",
  "bing",
  "serper",
  "duckduckgo",
]);

function normalizeSearchProvider(value: string | undefined): SearchProviderType {
  const lower = (value ?? "").trim().toLowerCase();
  return VALID_SEARCH_PROVIDERS.has(lower) ? (lower as SearchProviderType) : "tavily";
}

export function createTauriHarkBridge(
  invoke: InvokeFn,
  options?: { turnChannel?: TurnChannelFactory; listenAppEvents?: AppEventListener },
): HarkBridge {
  const turnChannel = options?.turnChannel;
  const listenAppEvents = options?.listenAppEvents;
  const cache = {
    roots: [] as AuthorizedRoot[],
    workspaces: [] as NativeWorkspace[],
    snapshot: null as ShellSnapshotDto | null,
    focusWorkspaceId: undefined as string | undefined,
    runs: new Map<string, { workspaceId: string; conversationId: string }>(),
    opinions: new Map<string, string>(),
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
      const perWorkspaceAttention = await Promise.all(
        workspaces.map(async (workspace) => {
          try {
            const items = await call<AttentionItemDto[]>("list_attention_items", {
              workspaceId: workspace.id,
            });
            return items
              .map(mapAttentionItem)
              .filter((item) => !item.dismissed)
              .map((item) => ({
                ...item,
                workspaceName: item.workspaceName ?? workspace.displayName,
                conversationId: item.conversationId ?? workspace.conversationId,
              }));
          } catch {
            return [] as AttentionItem[];
          }
        }),
      );
      const attentionItems = perWorkspaceAttention
        .flat()
        .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
      return mapAppSnapshot(snapshot, workspaces, attentionItems);
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
      const [overview, grants, checkpoint, sources, narrativeDto, roots] = await Promise.all([
        call<WorkspaceOverviewDto>("workspace_overview", { workspaceId }),
        call<ServiceGrant[]>("service_grants", { workspaceId }),
        call<OnboardingCheckpointDto>("onboarding", { workspaceId }),
        call<SourceRefDto[]>("list_source_refs", { workspaceId }),
        call<NarrativeStateDto>("get_narrative_state", { workspaceId }),
        ensureRoots(),
      ]);
      const narrative = mapNarrativeState(narrativeDto);
      const summary = mapWorkspaceSummary(workspace, roots, grants, overview);
      if (narrative.observedAt) {
        summary.lastObservedAt = narrative.observedAt;
      }
      const detail: WorkspaceDetail = {
        summary,
        excludedPaths: [],
        readOnlyPaths: sources.map((source) => source.relativePath).filter((path) => path.length > 0),
        narrative,
        activeOnboardingRunId: checkpoint.activeRunId ?? `checkpoint:${workspaceId}`,
        rootId: workspace.rootId,
        directoryStatus: roots.find((root) => root.id === workspace.rootId)?.status,
      };
      return detail;
    },
    async updateWorkspaceState(workspaceId, observerState) {
      const status = await call<ObserverStatusDto>("set_observer_paused", {
        workspaceId,
        paused: observerState === "paused",
      });
      const [workspace, grants, roots] = await Promise.all([
        workspaceById(workspaceId),
        call<ServiceGrant[]>("service_grants", { workspaceId }),
        ensureRoots(),
      ]);
      const summary = mapWorkspaceSummary(workspace, roots, grants);
      summary.observerState = status.paused ? "paused" : "active";
      return summary;
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
      const [events, sources, checkpoint, receipts] = await Promise.all([
        call<ConversationEventDto[]>("list_conversation", { workspaceId: workspace.id }),
        call<SourceRefDto[]>("list_source_refs", { workspaceId: workspace.id }),
        call<OnboardingCheckpointDto>("onboarding", { workspaceId: workspace.id }),
        call<StoredMemoryReceipt[]>("list_memory_receipts", { workspaceId: workspace.id }),
      ]);
      return {
        workspaceId: workspace.id,
        conversationId: workspace.conversationId,
        messages: projectMemoryReceipts(events.map((event) => mapConversationEvent(event, sources, checkpoint.modelAnalyzed)), receipts, workspace.id, workspace.conversationId),
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
      const channel = turnChannel((event) => {
        const mapped = event.payload.error
          ? { ...event, payload: { ...event.payload, error: mapTurnError(event.payload.error) } }
          : event;
        onEvent(mapped);
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
      return {
        runId: result.runId,
        acceptedUserMessage: mapConversationEvent(result.acceptedUserMessage, [], false),
      };
    },
    async getOutboundReview(ref) {
      assertOutboundRef(ref);
      const raw = await call<unknown>("get_outbound_review", { request: ref });
      const parsed = outboundReviewSchema.safeParse(raw);
      if (!parsed.success || parsed.data.reviewId !== ref.reviewId || parsed.data.workspaceId !== ref.workspaceId || parsed.data.runId !== ref.runId) {
        throw uiError("SCOPE_DENIED", "待审请求与当前运行不匹配。", false);
      }
      return parsed.data;
    },
    async decideOutboundReview(ref, decision) {
      assertOutboundRef(ref);
      if (decision !== "approve" && decision !== "reject") throw uiError("SCOPE_DENIED", "审阅决定无效。", false);
      await call("decide_outbound_review", { request: { ...ref, decision } });
    },
    async getRunStatusByRequest(workspaceId, conversationId, requestId) {
      const status = await call<AgentTurnStatusDto | null>("get_agent_turn_by_request", {
        request: { workspaceId, conversationId, requestId },
      });
      if (!status) return null;
      if (status.workspaceId !== workspaceId || status.conversationId !== conversationId || !isHarkId(status.runId, "run")) {
        throw uiError("CONNECTION_LOST", "无法确认消息所属对话。", false);
      }
      cache.runs.set(status.runId, { workspaceId, conversationId });
      return mapAgentTurnStatus(status, conversationId);
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
    async getOpinion(opinionId) {
      const workspaceId = cache.opinions.get(opinionId) ?? cache.focusWorkspaceId;
      if (!workspaceId) throw uiError("WORKSPACE_NOT_FOUND", "没有观点所属的工作空间。", false);
      const opinion = await call<OpinionView>("get_opinion", { request: { workspaceId, opinionId } });
      cache.opinions.set(opinion.id, opinion.workspaceId);
      return opinion;
    },
    async listWorkspaceOpinions(workspaceId) {
      const opinions = await call<OpinionView[]>("list_workspace_opinions", { workspaceId });
      for (const opinion of opinions) cache.opinions.set(opinion.id, opinion.workspaceId);
      return opinions;
    },
    async submitOpinionFeedback(input) {
      const opinion = await call<OpinionView>("submit_opinion_feedback", { request: input });
      cache.opinions.set(opinion.id, opinion.workspaceId);
      return opinion;
    },
    async revertMemoryOperation(workspaceId, operationId) {
      const receipt = await call<MemoryReceiptData & { reverted: boolean; committedAt?: string; revision?: number }>(
        "revert_memory_operation", { request: { workspaceId, operationId } },
      );
      if (!receipt.reverted || !receipt.committedAt || !Number.isInteger(receipt.revision)) {
        throw uiError("CONNECTION_LOST", "未收到 Core 的撤销收据，不会显示已撤销。", true);
      }
      return { ...receipt, decisionTitle: receipt.decisionTitle ?? "记忆变更", decisionSummary: receipt.decisionSummary ?? "已追加撤销修订，原历史保留" };
    },
    async getEvidence(evidenceId) {
      const workspaceId = cache.focusWorkspaceId;
      if (!workspaceId) {
        throw uiError("SOURCE_UNREADABLE", "没有当前 workspace，不会按路径查找来源。", false);
      }
      if (isHarkId(evidenceId, "msg")) {
        const message = await call<ConversationEventDto>("get_message_evidence", {
          request: { workspaceId, messageId: evidenceId },
        });
        return {
          id: message.id, workspaceId: message.workspaceId, kind: "conversation",
          title: message.kind === "user_message" ? "用户原文" : "历史对话原文（不是独立验证事实）",
          displayLocation: `对话 ${message.conversationId}`, observedAt: message.createdAt,
          availability: "available", verificationLevel: "full_text", excerpt: message.body,
        };
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
    async searchWorkspaceMemory(input) {
      cache.focusWorkspaceId = input.workspaceId;
      const page = await call<Omit<MemorySearchPage, "items"> & {
        items: (MemorySearchItem & { termMatch?: string })[];
        note?: string; usedOrFallback?: boolean;
      }>("search_workspace_memory", { request: input });
      for (const item of page.items) if (item.opinionId) cache.opinions.set(item.opinionId, input.workspaceId);
      return { ...page, items: page.items.map((item) => ({
        ...item,
        statusLabel: [item.statusLabel,
          item.termMatch === "like_fallback" || item.termMatch === "mixed" ? "短词匹配含LIKE（非FTS排名）" : "",
          page.usedOrFallback ? "OR召回，仅供线索" : "",
        ].filter(Boolean).join(" · "),
      })) };
    },
    async getWorkspacePermissions(workspaceId) {
      const grants = await call<ServiceGrant[]>("service_grants", { workspaceId });
      const cachedWs = cache.workspaces.find((item) => item.id === workspaceId);
      const cachedRoot = cachedWs ? cache.roots.find((item) => item.id === cachedWs.rootId) : undefined;
      return {
        workspaceId,
        revision: 0,
        readOnlyPaths: [],
        excludedPaths: [],
        modelPermission: permissionFromGrant(grants, "model"),
        searchPermission: permissionFromGrant(grants, "search"),
        observerState: deriveObserverState(cachedRoot?.status, grants),
      };
    },
    async setWorkspacePermissions(input) {
      if (input.excludedPaths !== undefined) {
        throw unavailable("路径排除授权");
      }
      if (input.modelPermission !== undefined && input.modelPermission !== "enabled" && input.modelPermission !== "disabled") {
        throw unavailable("模型授权");
      }
      if (input.searchPermission !== undefined && input.searchPermission !== "enabled" && input.searchPermission !== "disabled") {
        throw unavailable("搜索授权");
      }
      if (input.observerState !== undefined && input.observerState !== "active" && input.observerState !== "paused") {
        throw unavailable("观察器状态");
      }
      if (input.modelPermission === undefined && input.searchPermission === undefined && input.observerState === undefined) {
        throw unavailable("空权限更新");
      }
      if (input.modelPermission !== undefined) {
        await call("set_model_grant", {
          request: { workspaceId: input.workspaceId, enabled: input.modelPermission === "enabled" },
        });
      }
      if (input.searchPermission !== undefined) {
        await call("set_search_grant", {
          workspaceId: input.workspaceId,
          enabled: input.searchPermission === "enabled",
        });
      }
      if (input.observerState !== undefined) {
        await call("set_observer_paused", {
          workspaceId: input.workspaceId,
          paused: input.observerState === "paused",
        });
      }
      return this.getWorkspacePermissions(input.workspaceId);
    },
    async getNarrativeState(workspaceId) {
      const dto = await call<NarrativeStateDto>("get_narrative_state", { workspaceId });
      return mapNarrativeState(dto);
    },
    async observeWorkspace(workspaceId) {
      await call("observe_workspace", { workspaceId });
    },
    async dismissAttentionItem(workspaceId, attentionId) {
      await call<boolean>("dismiss_attention_item", { workspaceId, attentionId });
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
    async subscribeAppEvents(onEvent) {
      if (listenAppEvents) {
        return listenAppEvents(onEvent);
      }
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
    async getSearchConfig(): Promise<SearchProviderConfig> {
      const res = await call<SearchConfigResponseDto>("get_search_config");
      const providers: SearchProviderConfig["providers"] = {};
      if (res.providers && typeof res.providers === "object") {
        for (const [key, creds] of Object.entries(res.providers)) {
          if (!VALID_SEARCH_PROVIDERS.has(key) || !creds) continue;
          providers[key as SearchProviderType] = {
            ...(creds.apiKey ? { apiKey: creds.apiKey } : {}),
            ...(creds.endpoint ? { endpoint: creds.endpoint } : {}),
          };
        }
      }
      return {
        activeProvider: normalizeSearchProvider(res.activeProvider),
        providers,
      };
    },
    async saveSearchConfig(config: SearchProviderConfig): Promise<void> {
      const providers: Record<string, { apiKey?: string; endpoint?: string }> = {};
      for (const [key, creds] of Object.entries(config.providers ?? {})) {
        if (!VALID_SEARCH_PROVIDERS.has(key) || !creds) continue;
        const apiKey = creds.apiKey?.trim();
        const endpoint = creds.endpoint?.trim();
        if (apiKey || endpoint) {
          providers[key] = {
            ...(apiKey ? { apiKey } : {}),
            ...(endpoint ? { endpoint } : {}),
          };
        }
      }
      await call<SearchConfigResponseDto>("save_search_config", {
        config: {
          activeProvider: normalizeSearchProvider(config.activeProvider),
          providers,
        },
      });
    },
    async testSearchConnection(provider: SearchProviderType, apiKey: string, endpoint?: string): Promise<{ success: boolean; message: string }> {
      if (!apiKey || !apiKey.trim()) return { success: false, message: "请输入有效的 API Key" };
      if (provider === "tavily") {
        try {
          const res = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: apiKey.trim(), query: "test", max_results: 1 }),
          });
          if (res.ok) return { success: true, message: "连接成功！Tavily API 密钥有效。" };
          if (res.status === 401) return { success: false, message: "Tavily API Key 鉴权失败，请检查密钥是否正确。" };
          return { success: false, message: `Tavily 返回状态码 ${res.status}` };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, message: `网络连接异常: ${msg}` };
        }
      }
      if (provider === "zhipu_mcp") {
        const target = endpoint?.trim() || "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp";
        const authHeader = `Bearer ${apiKey.trim()}`;
        const parsePayload = (raw: string): Record<string, unknown> => {
          const trimmed = raw.trim();
          if (!trimmed) return {};
          if (!trimmed.startsWith("data:") && !trimmed.includes("\ndata:")) {
            return JSON.parse(trimmed) as Record<string, unknown>;
          }
          const lines = trimmed.split(/\r?\n/);
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i] ?? "";
            if (line.startsWith("data:")) {
              const jsonPart = line.slice(5).trim();
              if (jsonPart && jsonPart !== "[DONE]") {
                return JSON.parse(jsonPart) as Record<string, unknown>;
              }
            }
          }
          return {};
        };
        try {
          const initRes = await fetch(target, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              Authorization: authHeader,
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-03-26",
                capabilities: {},
                clientInfo: { name: "hark-desktop", version: "0.1.0" },
              },
            }),
          });
          if (initRes.status === 401 || initRes.status === 403) {
            return { success: false, message: "智谱 MCP 鉴权失败，请核对 Coding Plan 专属 API Key。" };
          }
          if (!initRes.ok) {
            return { success: false, message: `智谱 MCP 返回状态码 ${initRes.status}` };
          }
          const sessionId = initRes.headers.get("mcp-session-id");
          const initPayload = parsePayload(await initRes.text());
          if (
            initPayload.success === false ||
            (typeof initPayload.code === "number" && initPayload.code !== 200 && initPayload.code !== 0)
          ) {
            return {
              success: false,
              message: `智谱 MCP 鉴权或调用失败（${String(initPayload.code ?? "error")}）：${String(initPayload.msg ?? initPayload.message ?? "未知错误")}`,
            };
          }
          if (initPayload.error && typeof initPayload.error === "object") {
            const errObj = initPayload.error as { message?: string };
            return { success: false, message: `智谱 MCP 初始化失败: ${errObj.message || "未知错误"}` };
          }

          const listHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            Authorization: authHeader,
          };
          if (sessionId) listHeaders["mcp-session-id"] = sessionId;

          const listRes = await fetch(target, {
            method: "POST",
            headers: listHeaders,
            body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
          });
          if (!listRes.ok) {
            return { success: false, message: `智谱 MCP tools/list 返回状态码 ${listRes.status}` };
          }
          const listPayload = parsePayload(await listRes.text());
          const resultObj = listPayload.result as { tools?: Array<{ name?: string }> } | undefined;
          const tools = Array.isArray(resultObj?.tools) ? resultObj.tools : [];
          const toolNames = tools.map((t) => t.name).filter(Boolean).join(", ");
          return {
            success: true,
            message: toolNames
              ? `连接成功！智谱 MCP 鉴权通过，可用工具: ${toolNames}`
              : "连接成功！智谱 MCP 握手鉴权通过。",
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, message: `智谱 MCP 连接异常: ${msg}` };
        }
      }
      return { success: true, message: `已验证 ${provider} 提供商格式。` };
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
  listenAppEvents?: AppEventListener;
}): HarkBridge {
  if (input.mode === "dev_preview_synthetic") {
    return input.devPreview;
  }
  if (!input.hostAvailable) {
    return input.unavailable;
  }
  return createTauriHarkBridge(input.invoke, {
    turnChannel: input.turnChannel,
    listenAppEvents: input.listenAppEvents,
  });
}
