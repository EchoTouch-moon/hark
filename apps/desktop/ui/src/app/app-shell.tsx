import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
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
import { EvidenceInspector } from "../features/evidence/EvidenceInspector";
import { WorkspacePicker } from "../features/workspace/WorkspacePicker";
import { HistorySearch } from "../features/memory/HistorySearch";
import { WorkspaceSettings } from "../features/settings/WorkspaceSettings";
import { AppSettings, ThemePreference } from "../features/settings/AppSettings";

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

  // 本地 UI 状态（按 Workspace 隔离的草稿、流式临时状态、按需抽屉/弹窗）
  const [draftStore, setDraftStore] = useState<DraftStore>({});
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [transientSpreadKey, setTransientSpreadKey] = useState(0);
  const [streamState, setStreamState] = useState<StreamAccumulatorState | null>(null);
  const activeStreamWorkspaceRef = useRef<WorkspaceId | undefined>(undefined);

  // 按需打开的辅助面板（On-demand Surfaces）
  const [showOnboardingFlow, setShowOnboardingFlow] = useState(false);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [showHistorySearch, setShowHistorySearch] = useState(false);
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);
  const [inspectedEvidence, setInspectedEvidence] = useState<EvidenceDetail | null>(null);
  const [showProjectOverview, setShowProjectOverview] = useState(false);

  // 1. 昼夜环境光同步（PRD §6.4 + Dual-Theme 规范）
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

  // 2. 加载指定 Workspace 的完整快照（严格按 WorkspaceId 隔离）
  const loadWorkspaceContext = useCallback(
    async (wsId: WorkspaceId) => {
      try {
        setActiveError(null);
        const detail = await bridge.getWorkspace(wsId);
        setCurrentWorkspaceDetail(detail);
        activeStreamWorkspaceRef.current = wsId;

        const [evList, opList] = await Promise.all([
          bridge.listWorkspaceEvidence(wsId),
          bridge.listWorkspaceOpinions(wsId),
        ]);

        const nextEvMap: Record<ID, EvidenceRef> = {};
        for (const ev of evList) nextEvMap[ev.id] = ev;
        setEvidenceMap(nextEvMap);

        const nextOpMap: Record<ID, OpinionView> = {};
        for (const op of opList) nextOpMap[op.id] = op;
        setOpinionsMap(nextOpMap);

        if (detail.summary.currentConversationId) {
          const convPage = await bridge.getConversation(detail.summary.currentConversationId);
          setMessages(convPage.messages);
        } else {
          setMessages([]);
        }

        if (detail.activeOnboardingRunId) {
          const run = await bridge.getOnboardingRun(detail.activeOnboardingRunId);
          setOnboardingRun(run);
        } else {
          setOnboardingRun(null);
        }
      } catch (err) {
        setActiveError(asUiError(err));
      }
    },
    [bridge]
  );

  // 3. 初始化应用基线快照（AppSnapshot）
  const syncAppSnapshot = useCallback(
    async (preferredWorkspaceId?: WorkspaceId) => {
      try {
        setActiveError(null);
        const snap = await bridge.getAppSnapshot();
        setWorkspaces(snap.workspaces);
        setRuntime(snap.runtime);
        setAttentionItems(snap.attentionItems);
        if (snap.runtime.activeError) {
          setActiveError(snap.runtime.activeError);
        }

        const targetWsId =
          preferredWorkspaceId || currentWorkspaceId || snap.currentWorkspaceId;
        if (targetWsId) {
          setCurrentWorkspaceId(targetWsId);
          await loadWorkspaceContext(targetWsId);
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

  // 4. 切换 Workspace（PRD §4.5 & §6.3: 柔和过渡，解除旧工作空间的 UI Stream 展示）
  const handleSelectWorkspace = async (wsId: WorkspaceId) => {
    setShowOnboardingFlow(false);
    setInspectedEvidence(null);
    setStreamState((prev) => (prev && prev.workspaceId !== wsId ? null : prev));
    setCurrentWorkspaceId(wsId);
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
        if (input.enableModelInitialRead && bridge.startConfiguredOpening) {
          await bridge.setWorkspacePermissions({
            requestId: `req-open-${Date.now()}`,
            workspaceId: res.focusedWorkspaceId,
            expectedRevision: 1,
            modelPermission: "enabled",
          });
          await bridge.startConfiguredOpening(res.focusedWorkspaceId);
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
  const handleSendMessage = async () => {
    if (!currentWorkspaceId || !currentWorkspaceDetail?.summary.currentConversationId) return;
    const prompt = getWorkspaceDraft(draftStore, currentWorkspaceId).trim();
    if (!prompt) return;

    const convId = currentWorkspaceDetail.summary.currentConversationId;
    const targetWsId = currentWorkspaceId;

    setDraftStore((prev) => setWorkspaceDraft(prev, targetWsId, ""));

    const bufferedEvents: RunStreamEvent[] = [];
    let resolvedRunId: string | null = null;

    const refreshStoredArtifacts = (clearStream: boolean) => {
      Promise.all([
        bridge.getConversation(convId), bridge.listWorkspaceOpinions(targetWsId),
        bridge.listWorkspaceEvidence(targetWsId),
      ]).then(([page, opinions, evidence]) => {
        if (activeStreamWorkspaceRef.current !== targetWsId) return;
        setMessages(page.messages);
        setOpinionsMap(Object.fromEntries(opinions.map((opinion) => [opinion.id, opinion])));
        setEvidenceMap(Object.fromEntries(evidence.map((item) => [item.id, item])));
        if (clearStream) setStreamState(null);
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

    const handleStreamEvent = (ev: RunStreamEvent) => {
      if (activeStreamWorkspaceRef.current !== ev.workspaceId) {
        return;
      }
      if (!resolvedRunId) {
        bufferedEvents.push(ev);
        return;
      }
      setStreamState((prev) => {
        const base = prev || createInitialStreamState(ev.workspaceId, ev.runId);
        return applyRunStreamEvents(base, [ev]);
      });

      if (ev.type === "run_failed" || ev.type === "run_cancelled") {
        if (ev.payload.error) setActiveError(ev.payload.error);
        // A memory tool may have committed before the subsequent model request failed.
        refreshStoredArtifacts(false);
      }
      if (ev.type === "run_completed") {
        refreshPersistedConversation(
          targetWsId,
          convId,
          ev.payload.persistedMessageId,
          ev.payload.persistenceVerified === true,
        );
      }
    };

    try {
      setActiveError(null);
      const result = await bridge.startAgentTurn(
        {
          requestId: `req-turn-${Date.now()}`,
          workspaceId: targetWsId,
          conversationId: convId,
          userPrompt: prompt,
        },
        handleStreamEvent
      );

      resolvedRunId = result.runId;
      if (activeStreamWorkspaceRef.current === targetWsId) {
        setMessages((prev) => [...prev, result.acceptedUserMessage]);
      }

      const nextStream = applyRunStreamEvents(
        createInitialStreamState(targetWsId, result.runId),
        bufferedEvents,
      );
      if (activeStreamWorkspaceRef.current !== targetWsId) return;
      setStreamState(nextStream);
      if (nextStream.status === "failed" || nextStream.status === "cancelled") {
        if (nextStream.latestError) setActiveError(nextStream.latestError);
        refreshStoredArtifacts(false);
      }
      if (nextStream.status === "completed_verified" && nextStream.persistedMessageId) {
        refreshPersistedConversation(targetWsId, convId, nextStream.persistedMessageId, true);
      }
    } catch (err) {
      setDraftStore((prev) => setWorkspaceDraft(prev, targetWsId, prompt));
      setActiveError(err as HarkUIError);
    }
  };

  // 10. 停止当前模型生成
  const handleCancelRun = async () => {
    if (!streamState || !currentWorkspaceDetail?.summary.currentConversationId) return;
    try {
      await bridge.cancelAgentTurn(streamState.runId);
      setStreamState(null);
      const page = await bridge.getConversation(
        currentWorkspaceDetail.summary.currentConversationId
      );
      setMessages(page.messages);
    } catch (err) {
      setActiveError(err as HarkUIError);
    }
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
      setActiveError(err as HarkUIError);
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
                      if (!status.configured) throw new Error("模型配置未保存");
                      setRuntime((prev) => ({
                        ...prev,
                        stepFunConfigured: status.configured,
                        piSidecarStatus: status.sidecarConnected ? "ready" : "unavailable",
                      }));
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
                onDismiss={(id) =>
                  setAttentionItems((prev) => prev.filter((item) => item.id !== id))
                }
              />

              <ProjectOverviewSheet open={showProjectOverview} onClose={() => setShowProjectOverview(false)}>
                <p className="mb-4 text-sm text-[var(--text-muted)]">{getHeaderContextStatus()}</p>
                <OnboardingProgress
                  run={onboardingRun}
                  onAdvanceStage={bridgeMode === "dev_preview_synthetic" ? handleAdvanceOnboarding : undefined}
                  onEnableModelAuth={() => {
                    setShowProjectOverview(false);
                    return handleUpdateWorkspacePermissions({ modelPermission: "enabled" });
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
                onEnableModelAuth={() =>
                  handleUpdateWorkspacePermissions({ modelPermission: "enabled" })
                }
              />
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
                streamState &&
                  streamState.workspaceId === currentWorkspaceId &&
                  streamState.status === "streaming"
              )}
              modelPermission={currentSummary.modelPermission}
              stepFunConfigured={runtime.stepFunConfigured}
              sidecarAvailable={runtime.piSidecarStatus === "ready"}
              onOpenPermissions={() => {
                if (!runtime.stepFunConfigured || runtime.piSidecarStatus !== "ready") {
                  setShowAppSettings(true);
                } else {
                  setShowWorkspaceSettings(true);
                }
              }}
              onFocusChange={setIsComposerFocused}
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
        onSaveStepFunKey={
          bridge.configureStepFunSession
            ? async (apiKey) => {
                await bridge.configureStepFunSession?.(apiKey);
                await syncAppSnapshot(currentWorkspaceId);
              }
            : undefined
        }
        onClearStepFunKey={
          bridge.clearStepFunSession
            ? async () => {
                await bridge.clearStepFunSession?.();
                await syncAppSnapshot(currentWorkspaceId);
              }
            : undefined
        }
        onClose={() => setShowAppSettings(false)}
      />
    </div>
  );
};
