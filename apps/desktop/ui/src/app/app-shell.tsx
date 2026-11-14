import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Sparkles, ArrowDown, Compass, Globe } from "lucide-react";
import {
  AttentionItem,
  ConfirmImportInput,
  ConversationMessage,
  CreateChildWorkspaceInput,
  EvidenceDetail,
  EvidenceRef,
  HarkUIError,
  ID,
  MemoryRecordKind,
  MemorySearchItem,
  OnboardingRun,
  OpinionFeedbackAction,
  OpinionView,
  OutboundReviewSnapshot,
  RunStreamEvent,
  RuntimeStatus,
  WorkspaceDetail,
  WorkspaceId,
  WorkspacePermissionsUpdate,
  WorkspaceSummary,
} from "../bridge/HarkBridge";
import { getHarkBridge } from "../bridge/tauri-bridge";
import { toUiError as asUiError } from "../bridge/native-adapter";
import {
  applyRunStreamEvents,
  createInitialStreamState,
  describeFlameVisual,
  DraftStore,
  getWorkspaceDraft,
  setWorkspaceDraft,
  StreamAccumulatorState,
  reconcileStalledTurn,
} from "../bridge/schemas";
import { FlameAtmosphere } from "../components/hearth/FlameAtmosphere";
import { HomeHeader } from "../components/hearth/HomeHeader";
import { ProjectOverviewSheet } from "../components/hearth/ProjectOverviewSheet";
import { MemoryFold } from "../components/hearth/MemoryFold";
import { AttentionNotice } from "../components/hearth/AttentionNotice";
import { TrayCompanionBar } from "../components/hearth/TrayCompanionBar";
import { OfflineErrorBanner } from "../components/feedback/OfflineErrorBanner";
import { FolderOnboarding } from "../features/onboarding/FolderOnboarding";
import { OnboardingProgress } from "../features/onboarding/OnboardingProgress";
import { ConversationTimeline } from "../features/conversation/ConversationTimeline";
import { Composer } from "../features/conversation/Composer";
import { OutboundReviewDialog } from "../features/conversation/OutboundReviewDialog";
import { EvidenceInspector } from "../features/evidence/EvidenceInspector";
import { WorkspacePicker } from "../features/workspace/WorkspacePicker";
import { HistorySearch } from "../features/memory/HistorySearch";
import { WorkspaceSettings } from "../features/settings/WorkspaceSettings";
import { AppSettings, ThemePreference } from "../features/settings/AppSettings";

interface InFlightTurn {
  workspaceId: WorkspaceId;
  conversationId: string;
  requestId: string;
  runId?: string;
  phase: "starting" | "running" | "uncertain";
  finished: boolean;
  reconciling: boolean;
  acceptTimer?: ReturnType<typeof setTimeout>;
  watchdog?: ReturnType<typeof setTimeout>;
  reviewTimer?: ReturnType<typeof setTimeout>;
  reconcile?: (cancelRunning: boolean) => Promise<void>;
  abandon?: () => void;
}

/**
 * FE-01 · AppShell / HearthCanvas
 * PRD §0, §3.1, §3.2, §3.3:
 * - 一个主窗口、一个主要对话面、一个背景火光；默认不常驻左侧导航和右侧详情栏。
 * - Quiet Header：Workspace Switcher、Context Status、More Menu。
 * - Conversation Hearth：Fire Atmosphere、Conversation Timeline、Inline Artifacts、Composer。
 */
export const AppShell: React.FC = () => {
  const [bridgeMode, setBridgeMode] = useState<"dev_preview_synthetic" | "strict_tauri_ipc">(
    "strict_tauri_ipc"
  );
  // selectBridge 在 Tauri 可用时每次 new bridge；绑定 bridgeMode，避免 cache.runs 跨 render 丢失。
  const bridge = useMemo(() => getHarkBridge(bridgeMode), [bridgeMode]);

  // 主题与动效状态
  const [themePref, setThemePref] = useState<ThemePreference>("light");
  const [pauseMotion, setPauseMotion] = useState(false);
  const [isWindowHiddenToTray, setIsWindowHiddenToTray] = useState(false);
  const [isAppQuit, setIsAppQuit] = useState(false);

  // 应用核心业务状态（源自后端 HarkBridge）
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<WorkspaceId | undefined>(undefined);
  const [currentWorkspaceDetail, setCurrentWorkspaceDetail] = useState<WorkspaceDetail | null>(
    null
  );
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [opinionsMap, setOpinionsMap] = useState<Record<ID, OpinionView>>({});
  const [evidenceMap, setEvidenceMap] = useState<Record<ID, EvidenceRef>>({});
  const [onboardingRun, setOnboardingRun] = useState<OnboardingRun | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus>({
    bridgeMode: "tauri_ipc",
    rustCoreStatus: "degraded",
    piSidecarStatus: "unavailable",
    stepFunConfigured: false,
    mcpSearchConfigured: false,
    windowBehaviorOnClose: "hide_to_tray",
    launchAtLogin: false,
    notificationsEnabled: false,
  });
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [activeError, setActiveError] = useState<HarkUIError | null>(null);
  const [pendingReview, setPendingReview] = useState<OutboundReviewSnapshot | null>(null);
  const pendingReviewIdRef = useRef<string | null>(null);

  // 本地 UI 状态（按 Workspace 隔离的草稿、流式临时状态、按需抽屉/弹窗）
  const [draftStore, setDraftStore] = useState<DraftStore>({});
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [transientSpreadKey, setTransientSpreadKey] = useState(0);
  const [streamState, setStreamState] = useState<StreamAccumulatorState | null>(null);
  const activeStreamWorkspaceRef = useRef<WorkspaceId | undefined>(undefined);
  const workspaceLoadVersionRef = useRef(0);
  const flightRef = useRef<InFlightTurn | null>(null);
  const [flightView, setFlightView] = useState<Pick<InFlightTurn, "workspaceId" | "phase" | "runId"> | null>(null);
  const runtimeRef = useRef<RuntimeStatus>(runtime);
  const openingInFlightRef = useRef<Set<string>>(new Set());
  const openingAttemptedRef = useRef<Set<string>>(new Set());
  const lastObservedAtRef = useRef<Map<string, number>>(new Map());
  const observeInFlightRef = useRef<Set<string>>(new Set());

  // 按需打开的辅助面板（On-demand Surfaces）
  const [showOnboardingFlow, setShowOnboardingFlow] = useState(false);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [showHistorySearch, setShowHistorySearch] = useState(false);
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);
  const [inspectedEvidence, setInspectedEvidence] = useState<EvidenceDetail | null>(null);
  const [showProjectOverview, setShowProjectOverview] = useState(false);

  // 视口平滑跟随与自动置底逻辑（解决流式生成时不自动滚动的体验痛点）
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const scrollToBottom = useCallback((smooth = true) => {
    const doScroll = () => {
      bottomAnchorRef.current?.scrollIntoView?.({
        behavior: smooth ? "smooth" : "auto",
        block: "end",
      });
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(doScroll);
    } else {
      doScroll();
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
      const scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop;
      const clientHeight = window.innerHeight || document.documentElement.clientHeight;
      const distance = scrollHeight - (scrollTop + clientHeight);
      // 只有当用户向上滑动超过 260px 时才展示回到底部按钮；在底部或正常阅读最新消息时严禁遮挡
      setUserScrolledUp(distance > 260);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!userScrolledUp) {
      scrollToBottom(false);
    }
  }, [messages, streamState?.streamingText, streamState?.activeToolLabel, streamState?.status, userScrolledUp, scrollToBottom]);

  // 1. 昼夜环境光同步（PRD §6.4 + Dual-Theme 规范）
  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  useEffect(() => {
    openingAttemptedRef.current.clear();
    lastObservedAtRef.current.clear();
  }, [bridge]);

  useEffect(() => {
    const computeIsDark = () => {
      if (themePref === "dark") return true;
      if (themePref === "light") return false;
      const hour = new Date().getHours();
      return hour >= 19 || hour < 7;
    };
    const isDark = computeIsDark();
    const rootEl = document.documentElement;
    if (isDark) {
      rootEl.classList.add("dark");
    } else {
      rootEl.classList.remove("dark");
    }
  }, [themePref]);

  useEffect(() => {
    const rootEl = document.documentElement;
    if (pauseMotion) {
      rootEl.classList.add("pause-motion");
    } else {
      rootEl.classList.remove("pause-motion");
    }
  }, [pauseMotion]);

  const OBSERVE_THROTTLE_MS = 15_000;

  const triggerWorkspaceObservation = useCallback(
    (wsId: WorkspaceId) => {
      if (bridgeMode !== "strict_tauri_ipc" || !bridge.observeWorkspace) return;
      if (observeInFlightRef.current.has(wsId)) return;
      const now = Date.now();
      const last = lastObservedAtRef.current.get(wsId) ?? 0;
      if (now - last < OBSERVE_THROTTLE_MS) return;
      observeInFlightRef.current.add(wsId);
      lastObservedAtRef.current.set(wsId, now);
      void bridge
        .observeWorkspace(wsId)
        .catch(() => {})
        .finally(() => {
          observeInFlightRef.current.delete(wsId);
        });
    },
    [bridge, bridgeMode]
  );

  const maybeStartConfiguredOpening = useCallback(
    async (
      wsId: WorkspaceId,
      detail: WorkspaceDetail,
      run: OnboardingRun | null,
      rt: RuntimeStatus
    ) => {
      if (
        bridgeMode !== "strict_tauri_ipc" ||
        !bridge.startConfiguredOpening ||
        !rt.stepFunConfigured ||
        rt.piSidecarStatus !== "ready" ||
        rt.modelTransportAvailable === false ||
        detail.summary.modelPermission !== "enabled" ||
        detail.directoryStatus === "paused" ||
        detail.directoryStatus === "revoked" ||
        !run ||
        run.stage === "completed" ||
        run.stage === "cancelled" ||
        run.stage === "failed" ||
        openingInFlightRef.current.has(wsId) ||
        openingAttemptedRef.current.has(wsId)
      ) {
        return;
      }

      openingInFlightRef.current.add(wsId);
      openingAttemptedRef.current.add(wsId);
      try {
        await bridge.startConfiguredOpening(wsId);
        const updatedDetail = await bridge.getWorkspace(wsId);
        const [evList, opList, convPage, updatedRun, updatedWorkspaces] = await Promise.all([
          bridge.listWorkspaceEvidence(wsId),
          bridge.listWorkspaceOpinions(wsId),
          updatedDetail.summary.currentConversationId
            ? bridge.getConversation(updatedDetail.summary.currentConversationId)
            : Promise.resolve(null),
          updatedDetail.activeOnboardingRunId
            ? bridge.getOnboardingRun(updatedDetail.activeOnboardingRunId)
            : Promise.resolve(null),
          bridge.listWorkspaces(),
        ]);
        setWorkspaces(updatedWorkspaces);
        if (activeStreamWorkspaceRef.current !== wsId) return;
        setCurrentWorkspaceDetail(updatedDetail);
        const nextEvMap: Record<ID, EvidenceRef> = {};
        for (const ev of evList) nextEvMap[ev.id] = ev;
        setEvidenceMap(nextEvMap);
        const nextOpMap: Record<ID, OpinionView> = {};
        for (const op of opList) nextOpMap[op.id] = op;
        setOpinionsMap(nextOpMap);
        if (convPage) setMessages(convPage.messages);
        setOnboardingRun(updatedRun);
        setTransientSpreadKey((k) => k + 1);
      } catch (err) {
        if (activeStreamWorkspaceRef.current === wsId) {
          setActiveError(asUiError(err));
        }
      } finally {
        openingInFlightRef.current.delete(wsId);
      }
    },
    [bridge, bridgeMode]
  );

  // 2. 加载指定 Workspace 的完整快照（严格按 WorkspaceId 隔离）
  const loadWorkspaceContext = useCallback(
    async (wsId: WorkspaceId, runtimeOverride?: RuntimeStatus) => {
      const version = ++workspaceLoadVersionRef.current;
      activeStreamWorkspaceRef.current = wsId;
      const current = () => workspaceLoadVersionRef.current === version && activeStreamWorkspaceRef.current === wsId;
      try {
        setActiveError(null);
        const detail = await bridge.getWorkspace(wsId);
        if (!current()) return;

        setCurrentWorkspaceDetail(detail);

        const [evList, opList] = await Promise.all([
          bridge.listWorkspaceEvidence(wsId),
          bridge.listWorkspaceOpinions(wsId),
        ]);
        if (!current()) return;

        const nextEvMap: Record<ID, EvidenceRef> = {};
        for (const ev of evList) nextEvMap[ev.id] = ev;
        setEvidenceMap(nextEvMap);

        const nextOpMap: Record<ID, OpinionView> = {};
        for (const op of opList) nextOpMap[op.id] = op;
        setOpinionsMap(nextOpMap);

        if (detail.summary.currentConversationId) {
          const convPage = await bridge.getConversation(detail.summary.currentConversationId);
          if (!current()) return;
          setMessages(convPage.messages);
        } else {
          setMessages([]);
        }

        let run: OnboardingRun | null = null;
        if (detail.activeOnboardingRunId) {
          run = await bridge.getOnboardingRun(detail.activeOnboardingRunId);
          if (!current()) return;
          setOnboardingRun(run);
        } else {
          setOnboardingRun(null);
        }

        if (
          detail.directoryStatus !== "paused" &&
          detail.directoryStatus !== "revoked" &&
          detail.summary.observerState !== "paused"
        ) {
          triggerWorkspaceObservation(wsId);
        }

        await maybeStartConfiguredOpening(
          wsId,
          detail,
          run,
          runtimeOverride ?? runtimeRef.current
        );
      } catch (err) {
        if (current()) setActiveError(asUiError(err));
      }
    },
    [bridge, maybeStartConfiguredOpening, triggerWorkspaceObservation]
  );

  // 3. 初始化应用基线快照（AppSnapshot）
  const syncAppSnapshot = useCallback(
    async (preferredWorkspaceId?: WorkspaceId) => {
      try {
        setActiveError(null);
        const snap = await bridge.getAppSnapshot();
        setWorkspaces(snap.workspaces);
        runtimeRef.current = snap.runtime;
        setRuntime(snap.runtime);
        setAttentionItems(snap.attentionItems);
        if (snap.runtime.activeError) {
          setActiveError(snap.runtime.activeError);
        }

        const targetWsId =
          preferredWorkspaceId || currentWorkspaceId || snap.currentWorkspaceId;
        if (targetWsId) {
          setCurrentWorkspaceId(targetWsId);
          await loadWorkspaceContext(targetWsId, snap.runtime);
        } else {
          setShowOnboardingFlow(true);
        }
      } catch (err) {
        setActiveError(asUiError(err));
      }
    },
    [bridge, currentWorkspaceId, loadWorkspaceContext]
  );

  useEffect(() => {
    syncAppSnapshot();
  }, [bridgeMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void bridge
      .subscribeAppEvents((ev) => {
        if (disposed) return;
        if (
          ev.type !== "attention_triggered" &&
          ev.type !== "workspace_updated" &&
          ev.type !== "permissions_changed"
        ) {
          return;
        }
        void bridge
          .getAppSnapshot()
          .then((snap) => {
            if (disposed) return;
            setWorkspaces(snap.workspaces);
            runtimeRef.current = snap.runtime;
            setRuntime(snap.runtime);
            setAttentionItems(snap.attentionItems);
          })
          .catch(() => {});

        const activeWsId = activeStreamWorkspaceRef.current;
        if (activeWsId && (!ev.workspaceId || ev.workspaceId === activeWsId)) {
          void Promise.all([
            bridge.getWorkspace(activeWsId),
            bridge.listWorkspaceEvidence(activeWsId),
            bridge.listWorkspaceOpinions(activeWsId),
          ])
            .then(([detail, evList, opList]) => {
              if (disposed || activeStreamWorkspaceRef.current !== activeWsId) return;
              setCurrentWorkspaceDetail(detail);
              const nextEvMap: Record<ID, EvidenceRef> = {};
              for (const item of evList) nextEvMap[item.id] = item;
              setEvidenceMap(nextEvMap);
              const nextOpMap: Record<ID, OpinionView> = {};
              for (const op of opList) nextOpMap[op.id] = op;
              setOpinionsMap(nextOpMap);
              setTransientSpreadKey((k) => k + 1);
            })
            .catch(() => {});
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [bridge]);

  useEffect(() => {
    if (bridgeMode !== "strict_tauri_ipc") return;
    const handleFocus = () => {
      if (
        currentWorkspaceId &&
        currentWorkspaceDetail?.directoryStatus !== "paused" &&
        currentWorkspaceDetail?.directoryStatus !== "revoked" &&
        currentWorkspaceDetail?.summary.observerState !== "paused"
      ) {
        triggerWorkspaceObservation(currentWorkspaceId);
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [bridgeMode, currentWorkspaceId, currentWorkspaceDetail?.directoryStatus, currentWorkspaceDetail?.summary.observerState, triggerWorkspaceObservation]);

  // 4. 切换 Workspace（PRD §4.5 & §6.3: 柔和过渡，解除旧工作空间的 UI Stream 展示）
  const handleSelectWorkspace = async (wsId: WorkspaceId) => {
    setShowOnboardingFlow(false);
    setInspectedEvidence(null);
    setStreamState((prev) => (prev && prev.workspaceId !== wsId ? null : prev));
    setCurrentWorkspaceId(wsId);
    activeStreamWorkspaceRef.current = wsId;
    await loadWorkspaceContext(wsId);
  };

  // 5. 打开证据详情 Inspector
  const handleInspectEvidence = async (evidenceId: ID) => {
    try {
      const detail = await bridge.getEvidence(evidenceId);
      setInspectedEvidence(detail);
    } catch (err) {
      setActiveError(asUiError(err));
    }
  };

  const explainModelWait = () => {
    setActiveError({
      code: "MODEL_NOT_CONFIGURED",
      message: "模型未配置。请在设置里填写本次运行的 Key，并在工作空间里单独启用模型。不会读取全局凭据。",
      retryable: false,
    });
  };

  const handleHideWindow = async () => {
    if (bridgeMode === "strict_tauri_ipc") {
      try {
        if (!bridge.hideWindow) {
          throw asUiError(new Error("hide_window 未接线"));
        }
        await bridge.hideWindow();
      } catch (err) {
        setActiveError(asUiError(err));
      }
      return;
    }
    setIsWindowHiddenToTray(true);
  };

  const handleQuitApp = async () => {
    if (bridgeMode === "strict_tauri_ipc") {
      try {
        if (!bridge.quitApp) {
          throw asUiError(new Error("quit_app 未接线"));
        }
        await bridge.quitApp();
      } catch (err) {
        setActiveError(asUiError(err));
      }
      return;
    }
    setIsAppQuit(true);
  };

  const reloadDirectory = async (action: (rootId: string) => Promise<void>, rootId: string) => {
    try {
      await action(rootId);
      if (currentWorkspaceId) await loadWorkspaceContext(currentWorkspaceId);
    } catch (err) {
      setActiveError(asUiError(err));
    }
  };

  // 6. 导入文件夹确认
  const handleConfirmImport = async (input: ConfirmImportInput) => {
    try {
      const res = await bridge.confirmImport(input);
      setShowOnboardingFlow(false);
      setCurrentWorkspaceId(res.focusedWorkspaceId);
      if (bridgeMode === "strict_tauri_ipc") {
        if (!bridge.continueLocalRecognition) {
          throw asUiError(new Error("选择性读取未接线"));
        }
        await bridge.continueLocalRecognition(res.focusedWorkspaceId);
        if (input.enableModelInitialRead) {
          await bridge.setWorkspacePermissions({
            requestId: `req-open-${Date.now()}`,
            workspaceId: res.focusedWorkspaceId,
            expectedRevision: 1,
            modelPermission: "enabled",
          });
        }
      }
      const list = await bridge.listWorkspaces();
      setWorkspaces(list);
      await loadWorkspaceContext(res.focusedWorkspaceId);
      setTransientSpreadKey((k) => k + 1);
    } catch (err) {
      setActiveError(asUiError(err));
      if (currentWorkspaceId) {
        await loadWorkspaceContext(currentWorkspaceId);
      }
    }
  };

  // 7. 推进 Onboarding 初读进度
  const handleAdvanceOnboarding = async (runId: string) => {
    if (!bridge.advanceOnboardingForPreview || !currentWorkspaceId) return;
    try {
      await bridge.advanceOnboardingForPreview(runId);
      const list = await bridge.listWorkspaces();
      setWorkspaces(list);
      await loadWorkspaceContext(currentWorkspaceId);
      setTransientSpreadKey((k) => k + 1);
    } catch (err) {
      setActiveError(err as HarkUIError);
    }
  };

  // 8. 创建子目录 Workspace（原子排除父空间路径）
  const handleCreateChildWorkspace = async (input: CreateChildWorkspaceInput) => {
    try {
      const res = await bridge.createChildWorkspace(input);
      const list = await bridge.listWorkspaces();
      setWorkspaces(list);
      setCurrentWorkspaceId(res.childWorkspace.id);
      await loadWorkspaceContext(res.childWorkspace.id);
      setTransientSpreadKey((k) => k + 1);
    } catch (err) {
      setActiveError(err as HarkUIError);
    }
  };

  // 9. 发起一次真实流式 Agent 对话轮次（PRD §4.2 & §7.6）
  const handleSendMessage = async (directText?: string) => {
    if (flightRef.current || !currentWorkspaceId || !currentWorkspaceDetail?.summary.currentConversationId) return;
    const prompt = (directText ?? getWorkspaceDraft(draftStore, currentWorkspaceId)).trim();
    if (!prompt) return;
    setUserScrolledUp(false);
    scrollToBottom(false);
    if (directText) {
      setDraftStore((prev) => setWorkspaceDraft(prev, currentWorkspaceId, ""));
    }

    const convId = currentWorkspaceDetail.summary.currentConversationId;
    const targetWsId = currentWorkspaceId;

    const requestSuffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const flight: InFlightTurn = { workspaceId: targetWsId, conversationId: convId, requestId: `req-turn-${requestSuffix}`, phase: "starting", finished: false, reconciling: false };
    flightRef.current = flight;
    setFlightView({ workspaceId: targetWsId, phase: "starting" });
    activeStreamWorkspaceRef.current = targetWsId;
    const bufferedEvents: RunStreamEvent[] = [];
    let resolvedRunId: string | null = null;
    let accumulated: StreamAccumulatorState | null = null;
    let reviewAwaiting = false;
    let reviewGeneration = 0;
    const visible = () => activeStreamWorkspaceRef.current === targetWsId;
    const ownsFlight = () => flightRef.current === flight && !flight.finished;
    const showPhase = (phase: InFlightTurn["phase"]) => {
      if (!ownsFlight()) return;
      flight.phase = phase;
      setFlightView({ workspaceId: targetWsId, phase, runId: flight.runId });
    };
    const release = () => {
      if (flight.acceptTimer) clearTimeout(flight.acceptTimer);
      if (flight.watchdog) clearTimeout(flight.watchdog);
      if (flight.reviewTimer) clearTimeout(flight.reviewTimer);
      flight.finished = true;
      reviewGeneration += 1;
      pendingReviewIdRef.current = null;
      setPendingReview((review) => review?.runId === flight.runId ? null : review);
      if (flightRef.current === flight) { flightRef.current = null; setFlightView(null); }
    };
    const markUncertain = () => {
      if (!ownsFlight()) return;
      showPhase("uncertain");
      if (visible()) {
        setStreamState((prev) => prev?.runId === flight.runId ? null : prev);
        setActiveError({ code: "CONNECTION_LOST", message: "暂时无法确认这条消息的处理状态。请先检查对话记录，避免重复发送。", retryable: false });
      }
    };
    flight.acceptTimer = setTimeout(() => { if (!resolvedRunId) markUncertain(); }, 35_000);

    const refreshStoredArtifacts = (clearStream: boolean) => {
      Promise.all([
        bridge.getConversation(convId), bridge.listWorkspaceOpinions(targetWsId),
        bridge.listWorkspaceEvidence(targetWsId),
      ]).then(([page, opinions, evidence]) => {
        if (activeStreamWorkspaceRef.current !== targetWsId || (flightRef.current && flightRef.current !== flight)) return;
        setMessages(page.messages);
        setOpinionsMap(Object.fromEntries(opinions.map((opinion) => [opinion.id, opinion])));
        setEvidenceMap(Object.fromEntries(evidence.map((item) => [item.id, item])));
        if (clearStream) setStreamState((prev) => prev?.runId === flight.runId ? null : prev);
        setTransientSpreadKey((k) => k + 1);
      }).catch((err) => {
        if (activeStreamWorkspaceRef.current === targetWsId) setActiveError(asUiError(err));
      });
    };

    const refreshPersistedConversation = (
      wsId: WorkspaceId,
      conversationId: string,
      persistedMessageId: string | undefined,
      verified: boolean,
    ) => {
      // 缺 id 或未核验不当已保存，也不把候选写入时间线。
      if (!verified || !persistedMessageId) return;
      if (wsId !== targetWsId || conversationId !== convId) return;
      refreshStoredArtifacts(true);
    };

    flight.abandon = () => {
      if (!ownsFlight() || flight.runId) return;
      refreshStoredArtifacts(false);
      release();
      if (visible()) setActiveError({ code: "CONNECTION_LOST", message: "已结束等待。之前的消息可能仍在处理，请先查看对话记录再决定是否重发。", retryable: false });
    };

    flight.reconcile = async (cancelRunning) => {
      if (!ownsFlight() || flight.reconciling) return;
      flight.reconciling = true;
      try {
        if (!flight.runId && bridge.getRunStatusByRequest) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const status = await Promise.race([
            bridge.getRunStatusByRequest(targetWsId, convId, flight.requestId),
            new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 5_000); }),
          ]).finally(() => { if (timer) clearTimeout(timer); });
          if (!ownsFlight()) return;
          if (status && status.workspaceId === targetWsId && status.conversationId === convId) {
            flight.runId = status.runId;
            resolvedRunId = status.runId;
            accumulated ||= createInitialStreamState(targetWsId, status.runId);
            setDraftStore((prev) => getWorkspaceDraft(prev, targetWsId).trim() === prompt ? setWorkspaceDraft(prev, targetWsId, "") : prev);
            refreshStoredArtifacts(false);
          }
        }
        if (!flight.runId) { markUncertain(); return; }
        const status = await reconcileStalledTurn(bridge, { runId: flight.runId, workspaceId: targetWsId, conversationId: convId }, 5_000, cancelRunning);
        if (!ownsFlight()) return;
        if (status?.state === "running" && !cancelRunning) {
          showPhase("running");
          if (visible()) { setActiveError(null); setStreamState(accumulated); }
          if (flight.watchdog) clearTimeout(flight.watchdog);
          flight.watchdog = setTimeout(() => void flight.reconcile?.(true), 65_000);
        } else if (status?.state === "completed" && status.persistedAssistantMessageId) {
          refreshStoredArtifacts(true); release();
        } else if (status?.state === "cancelled" || status?.state === "failed") {
          if (visible()) {
            setStreamState(null);
            if (status.state === "failed") setActiveError(status.latestError || { code: "CONNECTION_LOST", message: "消息处理失败，请检查连接后重试。", retryable: true });
          }
          refreshStoredArtifacts(false); release();
        } else markUncertain();
      } catch {
        if (ownsFlight()) markUncertain();
      } finally {
        flight.reconciling = false;
      }
    };

    const handleStreamEvent = (ev: RunStreamEvent) => {
      if (!ownsFlight() || ev.workspaceId !== targetWsId || ev.conversationId !== convId) return;
      if (!resolvedRunId) {
        bufferedEvents.push(ev);
        return;
      }
      if (ev.runId !== resolvedRunId) return;
      const previous = accumulated || createInitialStreamState(targetWsId, resolvedRunId);
      accumulated = applyRunStreamEvents(previous, [ev]);
      if (previous.seenSeqs.includes(ev.seq) || !accumulated.seenSeqs.includes(ev.seq)) return;
      if (visible()) setStreamState(accumulated);

      if (ev.type === "outbound_review_requested") {
        const reviewId = ev.payload.reviewId;
        if (!reviewId || !bridge.getOutboundReview || !bridge.decideOutboundReview) {
          if (visible()) setActiveError({ code: "CONNECTION_LOST", message: "无法打开请求审阅，请停止当前请求后重试。", retryable: false });
          return;
        }
        reviewAwaiting = true;
        const generation = ++reviewGeneration;
        pendingReviewIdRef.current = reviewId;
        setPendingReview(null);
        if (flight.watchdog) clearTimeout(flight.watchdog);
        if (flight.reviewTimer) clearTimeout(flight.reviewTimer);
        flight.reviewTimer = setTimeout(() => {
          if (!ownsFlight() || reviewGeneration !== generation) return;
          pendingReviewIdRef.current = null;
          setPendingReview((current) => current?.reviewId === reviewId ? null : current);
          if (visible()) setActiveError({ code: "CONNECTION_LOST", message: "请求审阅已超时，正在结束本次请求。", retryable: false });
          void flight.reconcile?.(true);
        }, 120_000);
        void bridge.getOutboundReview({ workspaceId: targetWsId, runId: resolvedRunId, reviewId }).then((review) => {
          if (ownsFlight() && flight.runId === review.runId && reviewGeneration === generation) setPendingReview(review);
        }).catch((error) => {
          if (!ownsFlight() || reviewGeneration !== generation) return;
          reviewAwaiting = false;
          pendingReviewIdRef.current = null;
          if (flight.reviewTimer) clearTimeout(flight.reviewTimer);
          flight.watchdog = setTimeout(() => void flight.reconcile?.(true), 65_000);
          if (visible()) setActiveError(asUiError(error));
        });
      }

      if (ev.type === "run_failed" || ev.type === "run_cancelled") {
        if (visible() && ev.type === "run_failed") setActiveError(ev.payload.error || { code: "CONNECTION_LOST", message: "消息处理失败，请检查连接后重试。", retryable: true });
        // A memory tool may have committed before the subsequent model request failed.
        refreshStoredArtifacts(false);
        release();
      }
      if (ev.type === "run_completed") {
        refreshPersistedConversation(
          targetWsId,
          convId,
          ev.payload.persistedMessageId,
          ev.payload.persistenceVerified === true,
        );
        if (ev.payload.persistenceVerified === true && ev.payload.persistedMessageId) release();
        else markUncertain();
      }
    };

    try {
      setActiveError(null);
      const result = await bridge.startAgentTurn(
        {
          requestId: flight.requestId,
          workspaceId: targetWsId,
          conversationId: convId,
          userPrompt: prompt,
        },
        handleStreamEvent
      );

      resolvedRunId = result.runId;
      if (!ownsFlight()) return;
      flight.runId = result.runId;
      if (flight.acceptTimer) clearTimeout(flight.acceptTimer);
      showPhase("running");
      setDraftStore((prev) => getWorkspaceDraft(prev, targetWsId).trim() === prompt ? setWorkspaceDraft(prev, targetWsId, "") : prev);
      if (visible()) {
        setMessages((prev) => prev.some((msg) => msg.id === result.acceptedUserMessage.id) ? prev : [...prev, result.acceptedUserMessage]);
      }
      accumulated ||= createInitialStreamState(targetWsId, result.runId);
      if (visible()) setStreamState(accumulated);
      bufferedEvents.sort((a, b) => a.seq - b.seq).forEach(handleStreamEvent);
      if (ownsFlight() && !reviewAwaiting) flight.watchdog = setTimeout(() => void flight.reconcile?.(true), 65_000);
    } catch (err) {
      if (!ownsFlight()) return;
      const error = asUiError(err);
      const preflightRejected = ["sidecar_not_connected", "sidecar_not_configured", "model_not_configured", "session_key_rejected"].includes(String(error.details?.nativeCode ?? ""));
      if (!preflightRejected && (error.code === "CONNECTION_LOST" || error.code === "SIDECAR_UNAVAILABLE")) markUncertain();
      else { if (visible()) setActiveError(error); release(); }
    }
  };

  // 10. 停止当前模型生成
  const handleCancelRun = async () => {
    const flight = flightRef.current;
    if (flight && flight.workspaceId === currentWorkspaceId) await flight.reconcile?.(true);
  };

  // 11. 提交观点反馈
  const handleOpinionFeedback = async (
    opinionId: ID,
    expectedRevision: number,
    action: OpinionFeedbackAction,
    comment?: string
  ) => {
    if (!currentWorkspaceId) return;
    try {
      const updated = await bridge.submitOpinionFeedback({
        requestId: `req-op-${Date.now()}`,
        workspaceId: currentWorkspaceId,
        opinionId,
        expectedRevision,
        action,
        userComment: comment,
      });
      setOpinionsMap((prev) => ({
        ...prev,
        [updated.id]: updated,
      }));
      setTransientSpreadKey((k) => k + 1);
    } catch (err) {
      setActiveError(err as HarkUIError);
    }
  };

  // 12. 撤销记忆写入
  const handleRevertMemory = async (operationId: ID) => {
    if (!currentWorkspaceId || !currentWorkspaceDetail?.summary.currentConversationId) return;
    try {
      await bridge.revertMemoryOperation(currentWorkspaceId, operationId);
      const page = await bridge.getConversation(
        currentWorkspaceDetail.summary.currentConversationId
      );
      setMessages(page.messages);
    } catch (err) {
      setActiveError(err as HarkUIError);
    }
  };

  // 13. 更新当前 Workspace 权限
  const handleUpdateWorkspacePermissions = async (
    patch: Omit<WorkspacePermissionsUpdate, "requestId" | "workspaceId" | "expectedRevision">
  ) => {
    if (!currentWorkspaceId) return;
    try {
      await bridge.setWorkspacePermissions({
        requestId: `req-perm-${Date.now()}`,
        workspaceId: currentWorkspaceId,
        expectedRevision: 1,
        ...patch,
      });
      const list = await bridge.listWorkspaces();
      setWorkspaces(list);
      await loadWorkspaceContext(currentWorkspaceId);
    } catch (err) {
      setActiveError(asUiError(err));
    }
  };

  // 14. 更新运行环境设置 / 故障模拟
  const handleUpdateRuntime = async (
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
  ) => {
    try {
      const nextRuntime = await bridge.updateRuntimePreference(patch);
      runtimeRef.current = nextRuntime;
      setRuntime(nextRuntime);
      setActiveError(nextRuntime.activeError || null);
    } catch (err) {
      setActiveError(err as HarkUIError);
    }
  };

  // 15. 点击通知跳转到对应 Workspace、对话与观点/证据
  const handleJumpToAttention = async (item: AttentionItem) => {
    setIsWindowHiddenToTray(false);
    if (item.workspaceId !== currentWorkspaceId) {
      await handleSelectWorkspace(item.workspaceId);
    }
    if (item.targetEvidenceId) {
      await handleInspectEvidence(item.targetEvidenceId);
    }
    setAttentionItems((prev) => prev.filter((i) => i.id !== item.id));
  };

  const currentSummary = currentWorkspaceDetail?.summary;
  const narrativeState = currentWorkspaceDetail?.narrative;
  const flameVisual = describeFlameVisual(narrativeState);
  const currentDraft = getWorkspaceDraft(draftStore, currentWorkspaceId);

  const getHeaderContextStatus = () => {
    if (!runtime.stepFunConfigured) return "尚未配置模型 · 可查看本地资料";
    if (runtime.piSidecarStatus === "unavailable") return "模型连接暂不可用";
    if (!currentSummary) {
      return "等待绑定项目文件夹";
    }
    if (currentSummary.observerState === "paused") {
      return "文件观察已暂停 (paused)";
    }
    if (onboardingRun && ["reading", "analyzing"].includes(onboardingRun.stage)) {
      return "正在认识项目…";
    }
    if (streamState && streamState.status === "streaming") {
      return "正在生成回复…";
    }
    return "项目已就绪";
  };

  return (
    <div
      data-testid="hark-app-shell"
      className="relative min-h-screen flex flex-col bg-[var(--canvas)] text-[var(--text-primary)] selection:bg-[#e88e47]/25"
    >
      {/* FE-07 · 背景磨砂玻璃后的受控火光层 */}
      <FlameAtmosphere
        narrative={narrativeState}
        isComposerFocused={isComposerFocused}
        isStreaming={Boolean(streamState && streamState.status === "streaming")}
        transientSpreadKey={transientSpreadKey}
        pauseMotion={pauseMotion}
        isWindowHidden={isWindowHiddenToTray}
        observerState={currentSummary?.observerState}
      />

      {/* Native Desktop Layer · 托盘隐藏与完全退出层 */}
      <TrayCompanionBar
        isWindowHiddenToTray={isWindowHiddenToTray}
        currentWorkspace={currentSummary}
        pendingAttention={attentionItems[0]}
        onRestoreWindow={() => setIsWindowHiddenToTray(false)}
        onToggleObserver={() => {
          if (currentSummary) {
            handleUpdateWorkspacePermissions({
              observerState: currentSummary.observerState === "active" ? "paused" : "active",
            });
          }
        }}
        onJumpToNotification={handleJumpToAttention}
        onQuitApp={() => {
          void handleQuitApp();
        }}
        isAppQuit={isAppQuit}
        onRelaunchApp={() => {
          setIsAppQuit(false);
          setIsWindowHiddenToTray(false);
          syncAppSnapshot(currentWorkspaceId);
        }}
      />

      <HomeHeader
        projectName={currentSummary?.name}
        status={getHeaderContextStatus()}
        busy={Boolean(streamState?.status === "streaming" || onboardingRun?.stage === "reading" || onboardingRun?.stage === "analyzing")}
        synthetic={bridgeMode === "dev_preview_synthetic"}
        flameStage={flameVisual.stage}
        flameLabel={flameVisual.badgeText}
        flameReason={flameVisual.description}
        onChooseProject={() => setShowWorkspacePicker(true)}
        onOverview={() => setShowProjectOverview(true)}
        onSearch={() => setShowHistorySearch(true)}
        onProjectSettings={() => setShowWorkspaceSettings(true)}
        onAppSettings={() => setShowAppSettings(true)}
        onAddProject={() => setShowOnboardingFlow(true)}
        onHide={() => { void handleHideWindow(); }}
        onQuit={() => { void handleQuitApp(); }}
      />

      {/* Conversation Hearth · 中央单页对话炉心（最大可读宽度 800px，打开 Inspector 时平滑让位且绝不遮挡） */}
      <main className="relative z-10 flex-1 flex flex-col transition-all duration-200">
        <div
          className={`flex-1 w-full max-w-[800px] px-4 sm:px-6 pt-7 transition-all duration-200 ${
            inspectedEvidence
              ? "mx-auto xl:ml-auto xl:mr-[430px] lg:ml-6 lg:mr-[420px]"
              : "mx-auto"
          }`}
        >
          {/* FE-15 · 错误与离线/失联恢复横幅 */}
          <OfflineErrorBanner
            error={activeError}
            onRetry={() => {
              if (bridgeMode === "strict_tauri_ipc") {
                void syncAppSnapshot(currentWorkspaceId);
                return;
              }
              if (activeError?.code === "SIDECAR_UNAVAILABLE") {
                void handleUpdateRuntime({ piSidecarStatus: "ready" });
              } else if (activeError?.code === "MODEL_NOT_CONFIGURED") {
                void handleUpdateRuntime({ stepFunConfigured: true });
              } else if (activeError?.code === "MODEL_PERMISSION_REQUIRED") {
                void handleUpdateWorkspacePermissions({ modelPermission: "enabled" });
              } else {
                void syncAppSnapshot(currentWorkspaceId);
              }
            }}
            onOpenAppSettings={() => setShowAppSettings(true)}
            onDismiss={() => setActiveError(null)}
          />

          {/* 若处于添加新文件夹 / 首次启动流程，显示 FE-03 FolderOnboarding */}
          {showOnboardingFlow || !currentSummary ? (
            <FolderOnboarding
              existingWorkspaces={workspaces}
              stepFunConfigured={runtime.stepFunConfigured}
              credentialPersistenceAvailable={runtime.credentialPersistenceAvailable}
              modelTransportAvailable={bridgeMode !== "strict_tauri_ipc" || runtime.modelTransportAvailable === true}
              bridgeMode={bridgeMode}
              onPreviewPath={(path) => bridge.previewRoot(path)}
              onPickNative={() => {
                if (!bridge.pickAndScan) {
                  return Promise.reject(asUiError(new Error("Native 选择器未接线")));
                }
                return bridge.pickAndScan();
              }}
              onSaveStepFunKey={
                bridge.configureStepFunSession
                  ? async (apiKey) => {
                      const status = await bridge.configureStepFunSession!(apiKey);
                      if (!status.configured || status.restartRequiresKey) throw new Error("模型配置未保存");
                      const nextRuntime = await bridge.getRuntimeStatus();
                      runtimeRef.current = nextRuntime;
                      setRuntime(nextRuntime);
                    }
                  : undefined
              }
              onConfirmImport={handleConfirmImport}
              onSelectExistingWorkspace={handleSelectWorkspace}
              onCancel={
                currentSummary ? () => setShowOnboardingFlow(false) : undefined
              }
              onError={(err) => setActiveError(asUiError(err))}
            />
          ) : (
            <div key={currentSummary.id} className="animate-hearth-fade-up">
              {/* FE-14 · 值得关注的低打扰发现 */}
              <AttentionNotice
                items={attentionItems}
                currentWorkspaceId={currentWorkspaceId}
                onJumpToAttention={handleJumpToAttention}
                onDismiss={(id) => {
                  const target = attentionItems.find((item) => item.id === id);
                  setAttentionItems((prev) => prev.filter((item) => item.id !== id));
                  if (target) {
                    void bridge.dismissAttentionItem?.(target.workspaceId, target.id).catch(() => {});
                  }
                }}
              />

              <ProjectOverviewSheet open={showProjectOverview} onClose={() => setShowProjectOverview(false)}>
                <p className="mb-4 text-sm text-[var(--text-muted)]">{getHeaderContextStatus()}</p>
                <OnboardingProgress
                  run={onboardingRun}
                  onAdvanceStage={bridgeMode === "dev_preview_synthetic" ? handleAdvanceOnboarding : undefined}
                  onEnableModelAuth={() => {
                    setShowProjectOverview(false);
                    setShowWorkspaceSettings(true);
                  }}
                />
                {/* FE-10 · 记忆折页，按需查看 */}
                <MemoryFold
                  fold={currentWorkspaceDetail?.memoryFold}
                  onInspectEvidence={(id) => { setShowProjectOverview(false); void handleInspectEvidence(id); }}
                />
                <details className="mt-4 text-xs text-[var(--text-muted)]">
                  <summary className="cursor-pointer py-2">界面状态说明</summary>
                  <p className="pt-2 leading-relaxed">{flameVisual.description}</p>
                  <p className="pt-2 leading-relaxed">火光不按聊天次数或点击次数增长，未有项目依据时保持中性。</p>
                </details>
                <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)]">想要获取项目架构与演进思路？</span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowProjectOverview(false);
                      const prompt = `请全面结合当前项目的本地文件（README、配置清单及关键入口源码），像 hark.com 一样主动发掘「${currentSummary?.name || "当前项目"}」的不足、代码硬伤与性能隐患，并分条给出笃定的重构改进意见与演进方案。`;
                      void handleSendMessage(prompt);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#c27537] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#b0672c] transition-all"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>深度分析项目演进</span>
                  </button>
                </div>
              </ProjectOverviewSheet>

              {/* FE-05 · 中央对话时间线（含首条主动开场、观点卡、记忆回执、分级证据引用） */}
              <ConversationTimeline
                workspaceId={currentSummary.id}
                workspaceName={currentSummary.name}
                messages={messages}
                opinionsMap={opinionsMap}
                evidenceMap={evidenceMap}
                streamState={
                  streamState && streamState.workspaceId === currentWorkspaceId
                    ? streamState
                    : null
                }
                onInspectEvidence={handleInspectEvidence}
                onSubmitOpinionFeedback={handleOpinionFeedback}
                onRevertMemory={handleRevertMemory}
                onPrefillCorrection={(text) => {
                  if (currentWorkspaceId) {
                    setDraftStore((prev) =>
                      setWorkspaceDraft(prev, currentWorkspaceId, text)
                    );
                  }
                }}
                onTriggerAnalysis={(prompt) => void handleSendMessage(prompt)}
                onEnableModelAuth={() => setShowWorkspaceSettings(true)}
              />
              {/* 底部缓冲留白与智能吸附锚点：预留 240px 留白空间，彻底避免最后一条消息被粘性停靠的 Composer 和快捷按钮遮挡 */}
              <div className="h-60 w-full pointer-events-none" aria-hidden="true" />
              <div ref={bottomAnchorRef} data-testid="timeline-bottom-anchor" className="h-2 w-full pointer-events-none" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* FE-06 · 底部稳定停靠的 Composer */}
        {!showOnboardingFlow && currentSummary && (
          <div
            className={`sticky bottom-0 z-20 w-full max-w-[800px] px-4 sm:px-6 transition-all duration-200 ${
              inspectedEvidence
                ? "mx-auto xl:ml-auto xl:mr-[430px] lg:ml-6 lg:mr-[420px]"
                : "mx-auto"
            }`}
          >
            {userScrolledUp && (
              <div className="flex justify-center -mb-2 relative z-30 pointer-events-auto">
                <button
                  type="button"
                  data-testid="scroll-to-bottom-button"
                  onClick={() => {
                    scrollToBottom(true);
                    setUserScrolledUp(false);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-[var(--surface-elevated)] backdrop-blur-md text-[var(--text-primary)] border border-[var(--border-strong)] shadow-lg hover:border-[#c27537] hover:text-[#c27537] active:scale-95 transition-all cursor-pointer animate-hearth-pop"
                >
                  <ArrowDown className="w-3.5 h-3.5 text-[#c27537]" />
                  <span>滚动至最新</span>
                </button>
              </div>
            )}
            <Composer
              workspaceName={currentSummary.name}
              draft={currentDraft}
              onDraftChange={(val) => {
                if (currentWorkspaceId) {
                  setDraftStore((prev) =>
                    setWorkspaceDraft(prev, currentWorkspaceId, val)
                  );
                }
              }}
              onSend={handleSendMessage}
              onCancelRun={handleCancelRun}
              isRunning={Boolean(
                flightView && flightView.workspaceId === currentWorkspaceId && flightView.phase === "running" && flightView.runId
              )}
              sendBlocked={flightView !== null}
              sendStatus={flightView ? (flightView.phase === "uncertain" ? (flightView.runId ? "消息状态待确认，请先检查状态。" : "消息可能仍在处理，结束等待后重发可能重复。") : flightView.phase === "starting" ? "正在发送…" : flightView.workspaceId !== currentWorkspaceId ? "另一项目的消息正在处理。" : undefined) : undefined}
              onCheckSendStatus={flightView?.phase === "uncertain" ? () => void flightRef.current?.reconcile?.(false) : undefined}
              onEndUnknownSend={flightView?.phase === "uncertain" && !flightView.runId ? () => flightRef.current?.abandon?.() : undefined}
              modelPermission={currentSummary.modelPermission}
              stepFunConfigured={runtime.stepFunConfigured}
              sidecarAvailable={runtime.piSidecarStatus === "ready"}
              modelTransportAvailable={bridgeMode !== "strict_tauri_ipc" || runtime.modelTransportAvailable === true}
              onOpenPermissions={() => {
                if (!runtime.stepFunConfigured || runtime.piSidecarStatus !== "ready") {
                  setShowAppSettings(true);
                } else {
                  setShowWorkspaceSettings(true);
                }
              }}
              onOpenSearch={() => setShowHistorySearch(true)}
              onFocusChange={setIsComposerFocused}
              onQuickAction={(prompt) => void handleSendMessage(prompt)}
            />
          </div>
        )}
      </main>

      {/* FE-09 · 右侧按需打开的证据详情 Inspector Sheet */}
      <EvidenceInspector
        evidence={inspectedEvidence}
        onClose={() => setInspectedEvidence(null)}
        onMarkReverify={async (evId) => {
          const detail = await bridge.getEvidence(evId);
          setInspectedEvidence({
            ...detail,
            availability: "available",
            observedAt: new Date().toISOString(),
            staleReason: undefined,
          });
        }}
      />

      {pendingReview && pendingReview.workspaceId === currentWorkspaceId && bridge.decideOutboundReview && (
        <OutboundReviewDialog
          key={pendingReview.reviewId}
          request={pendingReview}
          onApprove={async () => {
            const ref = { workspaceId: pendingReview.workspaceId, runId: pendingReview.runId, reviewId: pendingReview.reviewId };
            const active = flightRef.current;
            if (!active || active.finished || active.runId !== ref.runId || pendingReviewIdRef.current !== ref.reviewId || activeStreamWorkspaceRef.current !== ref.workspaceId) throw new Error("review expired");
            await bridge.decideOutboundReview!(ref, "approve");
            if (pendingReviewIdRef.current !== ref.reviewId) return;
            pendingReviewIdRef.current = null;
            if (active.reviewTimer) clearTimeout(active.reviewTimer);
            setPendingReview((current) => current?.reviewId === ref.reviewId ? null : current);
            const flight = flightRef.current;
            if (flight && !flight.finished && flight.runId === ref.runId) flight.watchdog = setTimeout(() => void flight.reconcile?.(true), 65_000);
          }}
          onReject={async () => {
            const ref = { workspaceId: pendingReview.workspaceId, runId: pendingReview.runId, reviewId: pendingReview.reviewId };
            const active = flightRef.current;
            if (!active || active.finished || active.runId !== ref.runId || pendingReviewIdRef.current !== ref.reviewId || activeStreamWorkspaceRef.current !== ref.workspaceId) throw new Error("review expired");
            await bridge.decideOutboundReview!(ref, "reject");
            if (pendingReviewIdRef.current !== ref.reviewId) return;
            pendingReviewIdRef.current = null;
            if (active.reviewTimer) clearTimeout(active.reviewTimer);
            setPendingReview((current) => current?.reviewId === ref.reviewId ? null : current);
            const flight = flightRef.current;
            if (flight && !flight.finished && flight.runId === ref.runId) flight.watchdog = setTimeout(() => void flight.reconcile?.(true), 65_000);
          }}
        />
      )}

      {/* FE-02 · WorkspacePicker 弹窗 */}
      <WorkspacePicker
        isOpen={showWorkspacePicker}
        workspaces={workspaces}
        currentWorkspaceId={currentWorkspaceId}
        onSelectWorkspace={handleSelectWorkspace}
        onStartAddFolder={() => setShowOnboardingFlow(true)}
        onCreateChildWorkspace={handleCreateChildWorkspace}
        onClose={() => setShowWorkspacePicker(false)}
      />

      {/* FE-11 · HistorySearch 记忆与历史检索 */}
      {currentSummary && (
        <HistorySearch
          isOpen={showHistorySearch}
          workspaceId={currentSummary.id}
          workspaceName={currentSummary.name}
          onSearch={async (q: string, kinds?: MemoryRecordKind[]) => {
            const page = await bridge.searchWorkspaceMemory({
              workspaceId: currentSummary.id,
              query: q,
              kinds,
            });
            return page.items;
          }}
          onSelectResult={(item: MemorySearchItem) => {
            if (item.sourceRefId) {
              handleInspectEvidence(item.sourceRefId);
            }
          }}
          onQuoteResult={(item: MemorySearchItem) => {
            if (currentWorkspaceId) {
              const prev = getWorkspaceDraft(draftStore, currentWorkspaceId);
              const quote = `【参考项目记忆/依据 · ${item.title}】\n${item.snippet}\n`;
              setDraftStore((d) => setWorkspaceDraft(d, currentWorkspaceId, prev ? `${prev}\n${quote}` : quote));
            }
          }}
          onClose={() => setShowHistorySearch(false)}
        />
      )}

      {/* FE-12 · WorkspaceSettings 工作空间权限与只读范围 */}
      <WorkspaceSettings
        isOpen={showWorkspaceSettings}
        workspace={currentWorkspaceDetail}
        onUpdatePermissions={handleUpdateWorkspacePermissions}
        onPauseDirectory={bridge.pauseDirectory && (async (rootId) => {
          await bridge.pauseDirectory!(rootId);
          await syncAppSnapshot(currentWorkspaceId);
        })}
        onResumeDirectory={bridge.resumeDirectory && (async (rootId) => {
          await bridge.resumeDirectory!(rootId);
          await syncAppSnapshot(currentWorkspaceId);
        })}
        onRevokeDirectory={bridge.revokeDirectory && (async (rootId) => {
          await bridge.revokeDirectory!(rootId);
          await syncAppSnapshot(currentWorkspaceId);
        })}
        onClose={() => setShowWorkspaceSettings(false)}
        nativeLocked={bridgeMode === "strict_tauri_ipc"}
      />

      {/* FE-13 · AppSettings 应用设置与运行状态 */}
      <AppSettings
        isOpen={showAppSettings}
        runtime={runtime}
        themePref={themePref}
        onThemePrefChange={setThemePref}
        pauseMotion={pauseMotion}
        onPauseMotionChange={setPauseMotion}
        bridgeMode={bridgeMode}
        onBridgeModeChange={setBridgeMode}
        onUpdateRuntime={handleUpdateRuntime}
        onSimulateTrayMinimize={() => {
          void handleHideWindow();
        }}
        nativeLocked={bridgeMode === "strict_tauri_ipc"}
        onLoadSearchConfig={bridge.getSearchConfig ? () => bridge.getSearchConfig!() : undefined}
        onSaveSearchConfig={bridge.saveSearchConfig ? (cfg) => bridge.saveSearchConfig!(cfg) : undefined}
        onTestSearchConnection={bridge.testSearchConnection ? (provider, apiKey, endpoint) => bridge.testSearchConnection!(provider, apiKey, endpoint) : undefined}
        onSaveStepFunKey={
          bridge.configureStepFunSession
            ? async (apiKey) => {
                const status = await bridge.configureStepFunSession!(apiKey);
                if (!status.configured || status.restartRequiresKey) throw new Error("模型配置未保存");
                const nextRuntime = await bridge.getRuntimeStatus();
                runtimeRef.current = nextRuntime;
                setRuntime(nextRuntime);
                if (currentWorkspaceId && !showOnboardingFlow) {
                  await loadWorkspaceContext(currentWorkspaceId, nextRuntime);
                }
              }
            : undefined
        }
        onClearStepFunKey={
          bridge.clearStepFunSession
            ? async () => {
                try {
                  const status = await bridge.clearStepFunSession!();
                  if (status.configured) throw new Error("模型配置未移除");
                  const nextRuntime: RuntimeStatus = {
                    ...runtimeRef.current,
                    stepFunConfigured: false,
                    piSidecarStatus: "unavailable",
                    modelTransportAvailable: false,
                    credentialError: status.credentialError,
                  };
                  runtimeRef.current = nextRuntime;
                  setRuntime(nextRuntime);
                } catch (error) {
                  await syncAppSnapshot(currentWorkspaceId);
                  throw error;
                }
              }
            : undefined
        }
        onClose={() => setShowAppSettings(false)}
      />
    </div>
  );
};
