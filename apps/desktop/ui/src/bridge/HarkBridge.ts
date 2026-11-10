/**
 * Hark R1 · 前端与 Rust Core / Pi Agent Host 领域契约与接口合同 (v1.0)
 * 对应 PRD §7.3, §7.4, §7.5, §7.6, §7.7
 */

export type ID = string;
export type ISODateTime = string;
export type WorkspaceId = ID;
export type ConversationId = ID;
export type RunId = ID;

export interface ContractEnvelope {
  schemaVersion: "hark.ui.v1";
  requestId: ID;
}

export type ServicePermission = "disabled" | "enabled" | "unavailable";

export type WorkspaceLifecycle = "active" | "archived" | "unavailable";
export type AgentStatus = "idle" | "reading" | "analyzing" | "responding" | "error";
export type OverviewFreshness = "fresh" | "stale" | "unknown";

export interface WorkspaceSummary {
  id: WorkspaceId;
  name: string;
  rootDisplayPath: string; // 仅显示值，不授予文件访问能力
  lifecycle: WorkspaceLifecycle;
  agentStatus: AgentStatus;
  currentConversationId?: ConversationId;
  lastObservedAt?: ISODateTime;
  overviewFreshness: OverviewFreshness;
  modelPermission: ServicePermission;
  searchPermission: ServicePermission;
  observerState: "active" | "paused" | "unauthorized" | "unavailable";
}

export interface MemoryFoldEntry {
  id: ID;
  workspaceId: WorkspaceId;
  statement: string;
  contextExcerpt: string;
  recordedAt: ISODateTime;
  sourceRefId: ID;
  sourceTitle: string;
  validStatus: "active" | "superseded" | "review_needed";
}

export interface WorkspaceDetail {
  summary: WorkspaceSummary;
  excludedPaths: string[];
  readOnlyPaths: string[];
  parentWorkspaceId?: WorkspaceId;
  narrative: NarrativeState;
  memoryFold?: MemoryFoldEntry;
  activeOnboardingRunId?: RunId;
  /** Display-only root binding from Native. Not an authorization input. */
  rootId?: string;
  directoryStatus?: "active" | "paused" | "revoked";
}

export interface RootCandidate {
  candidateId: ID;
  relativePath: string;
  suggestedName: string;
  classification: "single_project" | "independent_project" | "module" | "uncertain";
  reasons: string[];
  selectable: boolean;
}

export interface RootPreview {
  previewId: ID; // 临时结果；不是持久 Workspace
  displayPath: string;
  scanStatus: "in_progress" | "ready" | "partial" | "failed";
  candidates: RootCandidate[];
  uncoveredReasons: string[];
  recommendedMode: "single" | "select_candidates" | "review_needed";
  defaultExcludedPaths: string[];
  readOnlyBoundaryNote: string;
}

export type OnboardingStage =
  | "boundary_review"
  | "reading"
  | "analyzing"
  | "waiting_for_model_auth"
  | "message_ready"
  | "completed"
  | "paused"
  | "cancelled"
  | "failed";

export interface OnboardingRun {
  id: RunId;
  workspaceId: WorkspaceId;
  stage: OnboardingStage;
  progressText: string; // 文案可见，但不能伪装为真实文件计数
  scanReadCount?: number;
  scanTotalEstimate?: number;
  latestErrorCode?: string;
  localScanCardMessageId?: ID;
  openingMessageId?: ID;
  lastUpdatedAt: ISODateTime;
}

export type MessageRole = "user" | "assistant" | "system_notice";
export type MessageKind =
  | "text"
  | "local_scan_card"
  | "agent_opening_message"
  | "opinion_card"
  | "memory_receipt"
  | "tool_status";

export interface MemoryReceiptData {
  operationId: ID;
  workspaceId: WorkspaceId;
  decisionTitle: string;
  decisionSummary: string;
  committedAt: ISODateTime;
  revision: number;
  reverted?: boolean;
  sourceMessageId?: ID;
}

export interface LocalScanSummaryData {
  scannedFilesCount: number;
  detectedLanguages: string[];
  keyManifests: string[];
  unverifiedAreas: string[];
  modelAuthRequired: boolean;
}

export interface OpeningStructuredData {
  projectUnderstanding: string;
  confirmedFacts: string[];
  unknownsAndUnverified: string[];
  guidingQuestion: string;
  foldedLocalScanId?: ID;
}

export interface ConversationMessage {
  id: ID;
  workspaceId: WorkspaceId;
  conversationId: ConversationId;
  role: MessageRole;
  kind: MessageKind;
  content: string;
  persistedAt: ISODateTime;
  status: "persisted" | "cancelled" | "incomplete";
  runId?: RunId;
  sourceRefs?: ID[];
  opinionId?: ID;
  memoryOperationId?: ID;
  memoryReceipt?: MemoryReceiptData;
  localScanData?: LocalScanSummaryData;
  openingData?: OpeningStructuredData;
  toolStageLabel?: string;
}

export type EvidenceKind =
  | "file_read"
  | "git_observation"
  | "web_snippet"
  | "web_fulltext"
  | "user_decision"
  | "conversation"
  | "external_document";

export type EvidenceAvailability = "available" | "stale" | "restricted" | "unreadable";
export type VerificationLevel = "metadata" | "snippet" | "partial_text" | "full_text";

export interface EvidenceRef {
  id: ID;
  workspaceId: WorkspaceId;
  kind: EvidenceKind;
  title: string;
  displayLocation: string;
  observedAt?: ISODateTime;
  availability: EvidenceAvailability;
  verificationLevel: VerificationLevel;
  removedFromCurrentScope?: boolean;
}

export interface EvidenceDetail extends EvidenceRef {
  excerpt: string;
  lineRange?: string;
  commitRef?: string;
  unreadableReason?: string;
  staleReason?: string;
  relatedOpinionIds?: ID[];
}

export type OpinionStatus = "active" | "shelved" | "disputed" | "superseded" | "stale" | "pending_revision" | "retracted";
export type OpinionFeedbackAction = "helpful" | "rebut" | "shelve" | "revise";

export interface OpinionRevisionEntry {
  revision: number;
  status: OpinionStatus;
  note: string;
  updatedAt: ISODateTime;
}

export interface OpinionView {
  id: ID;
  workspaceId: WorkspaceId;
  title: string;
  revision: number;
  summary: string;
  rationale: string;
  evidenceRefs: ID[];
  counterArguments: string[];
  uncertainties: string[];
  suggestedNextStep?: string;
  status: OpinionStatus;
  lastUpdatedAt: ISODateTime;
  userFeedbackNote?: string;
  history: OpinionRevisionEntry[];
}

export type FlameStage = "neutral" | "ember" | "gentle" | "bright" | "milestone";

export interface NarrativeState {
  availability: "known" | "unknown";
  flame: FlameStage;
  stageLabel: string;
  narrativeReason: string;
  basisRefs: ID[];
  observedAt?: ISODateTime;
  stale: boolean;
}

export type HarkErrorCode =
  | "WORKSPACE_NOT_FOUND"
  | "SCOPE_DENIED"
  | "MODEL_NOT_CONFIGURED"
  | "MODEL_PERMISSION_REQUIRED"
  | "SEARCH_PERMISSION_REQUIRED"
  | "ONBOARDING_WAITING"
  | "RUN_ALREADY_ACTIVE"
  | "SOURCE_STALE"
  | "SOURCE_UNREADABLE"
  | "CONFLICT_REVISION"
  | "SIDECAR_UNAVAILABLE"
  | "OPERATION_CANCELLED"
  | "CONNECTION_LOST"
  | "FEATURE_UNAVAILABLE";

export interface HarkUIError {
  code: HarkErrorCode;
  message: string;
  requestId?: ID;
  retryable: boolean;
  recoveryActionLabel?: string;
  details?: Record<string, unknown>;
}

export interface ConfirmImportInput {
  requestId: ID;
  previewId: ID;
  selectedCandidateIds: ID[];
  importMode: "single" | "multiple";
  enableModelInitialRead: boolean;
  enableWebSearch: boolean;
  customExcludedPaths?: string[];
  /** Native confirm only. Absent means the Tauri bridge must refuse, not guess. */
  nativeSelection?: "single" | "selected";
}

export interface ConfirmImportResult {
  workspaceIds: WorkspaceId[];
  focusedWorkspaceId: WorkspaceId;
  onboardingRunId: RunId;
}

export interface CreateChildWorkspaceInput {
  requestId: ID;
  parentWorkspaceId: WorkspaceId;
  relativeSubPath: string;
  suggestedName: string;
  excludeFromParent: boolean;
  retainParentHistoryRef: boolean;
}

export interface CreateChildWorkspaceResult {
  childWorkspace: WorkspaceSummary;
  updatedParentExcludedPaths: string[];
  onboardingRunId: RunId;
}

export interface MessagePage {
  workspaceId: WorkspaceId;
  conversationId: ConversationId;
  messages: ConversationMessage[];
  nextCursor?: string;
}

export interface StartAgentTurnInput {
  requestId: ID;
  workspaceId: WorkspaceId;
  conversationId: ConversationId;
  userPrompt: string;
}

export interface StartAgentTurnResult {
  runId: RunId;
  acceptedUserMessage: ConversationMessage;
}

export interface RunStatus {
  runId: RunId;
  workspaceId: WorkspaceId;
  conversationId: ConversationId;
  state: "running" | "completed" | "cancelled" | "failed" | "persistence_unknown";
  persistedAssistantMessageId?: ID;
  latestError?: HarkUIError;
}

export interface OpinionFeedbackInput {
  requestId: ID;
  workspaceId: WorkspaceId;
  opinionId: ID;
  expectedRevision: number;
  action: OpinionFeedbackAction;
  userComment?: string;
}

export type MemoryRecordKind = "decision" | "opinion" | "conversation_milestone" | "local_fact" | "identity" | "experience";

export interface MemorySearchItem {
  id: ID;
  workspaceId: WorkspaceId;
  kind: MemoryRecordKind;
  title: string;
  snippet: string;
  recordedAt: ISODateTime;
  statusLabel: string;
  sourceRefId?: ID;
  opinionId?: ID;
  conversationId?: ConversationId;
}

export interface MemorySearchInput {
  workspaceId: WorkspaceId;
  query: string;
  kinds?: MemoryRecordKind[];
  cursor?: string;
}

export interface MemorySearchPage {
  workspaceId: WorkspaceId;
  items: MemorySearchItem[];
  nextCursor?: string;
}

export interface WorkspacePermissions {
  workspaceId: WorkspaceId;
  revision: number;
  readOnlyPaths: string[];
  excludedPaths: string[];
  modelPermission: ServicePermission;
  searchPermission: ServicePermission;
  observerState: "active" | "paused" | "unauthorized" | "unavailable";
}

export interface WorkspacePermissionsUpdate {
  requestId: ID;
  workspaceId: WorkspaceId;
  expectedRevision: number;
  modelPermission?: ServicePermission;
  searchPermission?: ServicePermission;
  observerState?: "active" | "paused";
  excludedPaths?: string[];
}

export interface RuntimeStatus {
  bridgeMode: "dev_preview_synthetic" | "tauri_ipc";
  rustCoreStatus: "healthy" | "degraded" | "unreachable";
  piSidecarStatus: "ready" | "starting" | "unavailable";
  stepFunConfigured: boolean;
  modelTransportAvailable?: boolean;
  credentialError?: string | null;
  credentialPersistenceAvailable?: boolean;
  mcpSearchConfigured: boolean;
  windowBehaviorOnClose: "hide_to_tray" | "quit_app";
  launchAtLogin: boolean;
  notificationsEnabled: boolean;
  activeError?: HarkUIError;
}

export interface AttentionItem {
  id: ID;
  workspaceId: WorkspaceId;
  workspaceName: string;
  conversationId: ConversationId;
  headline: string;
  whyNow: string;
  targetOpinionId?: ID;
  targetEvidenceId?: ID;
  createdAt: ISODateTime;
  dismissed?: boolean;
}

export interface AppSnapshot {
  schemaVersion: "hark.ui.v1";
  appVersion: string;
  workspaces: WorkspaceSummary[];
  currentWorkspaceId?: WorkspaceId;
  runtime: RuntimeStatus;
  attentionItems: AttentionItem[];
}

export type RunStreamEventType =
  | "run_started"
  | "text_delta"
  | "tool_started"
  | "tool_completed"
  | "memory_committed"
  | "run_completed"
  | "run_cancelled"
  | "run_failed";

export interface RunStreamEvent {
  schemaVersion: "hark.ui.v1";
  workspaceId: WorkspaceId;
  conversationId: ConversationId;
  runId: RunId;
  seq: number; // 单 run 单调递增
  type: RunStreamEventType;
  payload: {
    delta?: string;
    toolName?: string;
    toolStageLabel?: string;
    persistedMessageId?: ID;
    memoryReceipt?: MemoryReceiptData;
    opinionCreatedId?: ID;
    persistenceVerified?: boolean;
    error?: HarkUIError;
  };
}

export interface AppEvent {
  type:
    | "workspace_updated"
    | "permissions_changed"
    | "onboarding_progress"
    | "attention_triggered"
    | "runtime_status_changed";
  workspaceId?: WorkspaceId;
  runId?: RunId;
  timestamp: ISODateTime;
}

export interface HarkBridge {
  getAppSnapshot(): Promise<AppSnapshot>;
  previewRoot(path: string): Promise<RootPreview>;
  confirmImport(input: ConfirmImportInput): Promise<ConfirmImportResult>;
  createChildWorkspace(input: CreateChildWorkspaceInput): Promise<CreateChildWorkspaceResult>;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  getWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceDetail>;
  updateWorkspaceState(workspaceId: WorkspaceId, observerState: "active" | "paused"): Promise<WorkspaceSummary>;
  getOnboardingRun(runId: RunId): Promise<OnboardingRun>;
  advanceOnboardingForPreview?(runId: RunId): Promise<OnboardingRun>;
  getConversation(conversationId: ConversationId, cursor?: string): Promise<MessagePage>;
  startAgentTurn(
    input: StartAgentTurnInput,
    onEvent: (event: RunStreamEvent) => void
  ): Promise<StartAgentTurnResult>;
  getRunStatus(runId: RunId): Promise<RunStatus>;
  getRunStatusByRequest?(workspaceId: WorkspaceId, conversationId: ConversationId, requestId: ID): Promise<RunStatus | null>;
  cancelAgentTurn(runId: RunId): Promise<RunStatus>;
  getOpinion(opinionId: ID): Promise<OpinionView>;
  listWorkspaceOpinions(workspaceId: WorkspaceId): Promise<OpinionView[]>;
  submitOpinionFeedback(input: OpinionFeedbackInput): Promise<OpinionView>;
  revertMemoryOperation(workspaceId: WorkspaceId, operationId: ID): Promise<MemoryReceiptData>;
  getEvidence(evidenceId: ID): Promise<EvidenceDetail>;
  listWorkspaceEvidence(workspaceId: WorkspaceId): Promise<EvidenceRef[]>;
  searchWorkspaceMemory(input: MemorySearchInput): Promise<MemorySearchPage>;
  getWorkspacePermissions(id: WorkspaceId): Promise<WorkspacePermissions>;
  setWorkspacePermissions(input: WorkspacePermissionsUpdate): Promise<WorkspacePermissions>;
  getNarrativeState(id: WorkspaceId): Promise<NarrativeState>;
  getRuntimeStatus(): Promise<RuntimeStatus>;
  updateRuntimePreference(patch: Partial<Pick<RuntimeStatus, "windowBehaviorOnClose" | "launchAtLogin" | "notificationsEnabled" | "stepFunConfigured" | "piSidecarStatus">>): Promise<RuntimeStatus>;
  subscribeAppEvents(onEvent: (event: AppEvent) => void): Promise<() => void>;
  /** Native picker token flow. Dev preview does not implement this. */
  pickAndScan?(): Promise<RootPreview>;
  continueLocalRecognition?(workspaceId: WorkspaceId): Promise<void>;
  hideWindow?(): Promise<void>;
  quitApp?(): Promise<void>;
  pauseDirectory?(rootId: string): Promise<void>;
  resumeDirectory?(rootId: string): Promise<void>;
  revokeDirectory?(rootId: string): Promise<void>;
  /** Run-only key. Saving does not call the model or authorize workspaces. */
  configureStepFunSession?(apiKey: string): Promise<StepFunSessionStatus>;
  clearStepFunSession?(): Promise<StepFunSessionStatus>;
  stepFunSessionStatus?(): Promise<StepFunSessionStatus>;
  /** Existing opening entry. Only after the user explicitly asks for a first read. */
  startConfiguredOpening?(workspaceId: WorkspaceId): Promise<void>;
}

export interface StepFunSessionStatus {
  configured: boolean;
  authenticated: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  wire: string;
  devOnly: boolean;
  packaging: string;
  sidecarConnected: boolean;
  restartRequiresKey: boolean;
  credentialError?: string | null;
}
