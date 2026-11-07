import React, { useState } from "react";
import {
  FolderOpen,
  ArrowLeft,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Layers,
  CheckSquare,
  Square,
  Globe,
  Cpu,
  Flame,
} from "lucide-react";
import {
  ConfirmImportInput,
  RootPreview,
  WorkspaceSummary,
} from "../../bridge/HarkBridge";

interface FolderOnboardingProps {
  existingWorkspaces: WorkspaceSummary[];
  stepFunConfigured: boolean;
  bridgeMode: "dev_preview_synthetic" | "strict_tauri_ipc";
  onPreviewPath: (path: string) => Promise<RootPreview>;
  onPickNative?: () => Promise<RootPreview>;
  onConfirmImport: (input: ConfirmImportInput) => Promise<void>;
  onSelectExistingWorkspace: (workspaceId: string) => void;
  onCancel?: () => void;
  onError?: (err: unknown) => void;
}

const PRESET_PATHS = [
  {
    label: "~/projects/hark-r1-desktop（单项目 / Monorepo 示例）",
    path: "~/projects/hark-r1-desktop",
  },
  {
    label: "~/projects/studio-multi-repos（含多个独立子项目候选）",
    path: "~/projects/studio-multi-repos",
  },
  {
    label: "~/projects/local-notes-engine（轻量单仓库项目）",
    path: "~/projects/local-notes-engine",
  },
];

/**
 * FE-03 · FolderOnboarding
 * PRD §3.3.A, §3.3.B, §4.1:
 * - 首次启动 / 添加项目：从一个你正在关心的项目开始，选择真实文件夹，先认识它，再和你聊。
 * - 导入前确认页：同一确认页展示「只读目录范围」「默认排除项」「模型初读授权」三个独立语义。
 */
export const FolderOnboarding: React.FC<FolderOnboardingProps> = ({
  existingWorkspaces,
  stepFunConfigured,
  bridgeMode,
  onPreviewPath,
  onPickNative,
  onConfirmImport,
  onSelectExistingWorkspace,
  onCancel,
  onError,
}) => {
  const native = bridgeMode === "strict_tauri_ipc";
  const [step, setStep] = useState<"pick_folder" | "boundary_review">("pick_folder");
  const [folderPath, setFolderPath] = useState("~/projects/hark-r1-desktop");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submittingImport, setSubmittingImport] = useState(false);
  const [preview, setPreview] = useState<RootPreview | null>(null);

  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [showReasons, setShowReasons] = useState(true);
  const [showReadOnlyScope, setShowReadOnlyScope] = useState(false);
  const [enableModelInitialRead, setEnableModelInitialRead] = useState(true);
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [forceMultiSplit, setForceMultiSplit] = useState(false);

  const applyPreview = (res: RootPreview) => {
    setPreview(res);
    const selectable = res.candidates.filter((candidate) => candidate.selectable);
    setSelectedCandidateIds(
      res.recommendedMode === "select_candidates"
        ? selectable.slice(0, 2).map((candidate) => candidate.candidateId)
        : selectable.slice(0, 1).map((candidate) => candidate.candidateId),
    );
    setForceMultiSplit(res.recommendedMode === "select_candidates");
    setStep("boundary_review");
  };

  const handleChooseFolder = async (targetPath?: string) => {
    setLoadingPreview(true);
    try {
      if (native) {
        if (!onPickNative) {
          throw new Error("Native 选择器未接线");
        }
        applyPreview(await onPickNative());
        return;
      }
      const chosen = (targetPath ?? folderPath).trim();
      if (!chosen) return;
      applyPreview(await onPreviewPath(chosen));
    } catch (err) {
      onError?.(err);
    } finally {
      setLoadingPreview(false);
    }
  };

  const toggleCandidate = (candidateId: string) => {
    setSelectedCandidateIds((prev) =>
      prev.includes(candidateId)
        ? prev.filter((id) => id !== candidateId)
        : [...prev, candidateId]
    );
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setSubmittingImport(true);
    try {
      const nativeSelection =
        native && (preview.recommendedMode === "select_candidates" || forceMultiSplit)
          ? "selected"
          : "single";
      await onConfirmImport({
        requestId: `req-import-${Date.now()}`,
        previewId: preview.previewId,
        selectedCandidateIds: selectedCandidateIds,
        importMode: native
          ? nativeSelection === "selected"
            ? "multiple"
            : "single"
          : selectedCandidateIds.length > 1
            ? "multiple"
            : "single",
        nativeSelection: native ? nativeSelection : undefined,
        enableModelInitialRead: stepFunConfigured ? enableModelInitialRead : false,
        enableWebSearch: native ? false : enableWebSearch,
        customExcludedPaths: native ? undefined : preview.defaultExcludedPaths,
      });
    } finally {
      setSubmittingImport(false);
    }
  };

  if (step === "pick_folder") {
    return (
      <section
        aria-label="选择项目文件夹"
        data-testid="folder-onboarding-picker"
        className="w-full max-w-[600px] mx-auto my-16 sm:my-24 px-6 py-8 text-center space-y-7 animate-hearth-fade-up"
      >
        <div className="space-y-3">
          <div className="w-11 h-11 rounded-2xl bg-[#e88e47]/12 border border-[#e88e47]/30 flex items-center justify-center mx-auto">
            <Flame className="w-5 h-5 text-[#e88e47]" />
          </div>
          <h2 className="text-2xl sm:text-[26px] font-semibold text-[var(--text-primary)] font-serif-narrative">
            从一个项目开始
          </h2>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
            {native
              ? "只读了解项目资料，不修改文件。"
              : "选一个本地文件夹，我会先在只读边界内认识它，主动说出第一句理解，再和你深聊。"}
          </p>
        </div>

        <div className="max-w-lg mx-auto text-left space-y-3.5">
          {native ? (
            <div className="space-y-3 text-center">
              <button
                type="button"
                disabled={loadingPreview}
                onClick={() => handleChooseFolder()}
                data-testid="native-pick-directory"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-[#c27537] text-white hover:bg-[#b0672c] disabled:opacity-50 shadow-xs transition-all active:scale-[0.98]"
              >
                <FolderOpen className="w-4 h-4" />
                <span>{loadingPreview ? "正在读取…" : "选择项目文件夹"}</span>
              </button>
            </div>
          ) : (
            <>
              <label
                htmlFor="hark-folder-path-input"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                显式 Dev Preview 路径（不会在 Native 模式出现）：
              </label>
              <div className="flex items-center gap-2.5">
                <input
                  id="hark-folder-path-input"
                  type="text"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="~/projects/your-project"
                  className="flex-1 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-solid)] px-4 py-2.5 text-sm font-mono text-[var(--text-primary)] focus:outline-2 focus:outline-[var(--focus-ring)]"
                />
                <button
                  type="button"
                  disabled={loadingPreview || !folderPath.trim()}
                  onClick={() => handleChooseFolder()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-[#c27537] text-white hover:bg-[#b0672c] disabled:opacity-50 shadow-xs transition-all active:scale-[0.98] whitespace-nowrap shrink-0"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>{loadingPreview ? "正在初扫…" : "选择项目文件夹"}</span>
                </button>
              </div>
              <div className="pt-1 space-y-2">
                <div className="text-[11px] text-[var(--text-muted)]">
                  预设目录只属于显式 Dev Preview，不能代替系统选择器。
                </div>
                <div className="flex flex-wrap gap-2">
                  {PRESET_PATHS.map((preset) => (
                    <button
                      key={preset.path}
                      type="button"
                      onClick={() => {
                        setFolderPath(preset.path);
                        handleChooseFolder(preset.path);
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs border border-[var(--border-subtle)] bg-[var(--surface-solid)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[#e88e47]/50 transition-all active:scale-[0.98]"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 已有项目快捷入口 */}
        {existingWorkspaces.length > 0 && (
          <div className="pt-5 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-center gap-2.5 text-xs text-[var(--text-muted)]">
            <span>已有认识中的项目？</span>
            {existingWorkspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => onSelectExistingWorkspace(ws.id)}
                className="font-medium text-[#c27537] dark:text-[#f1bb7c] hover:underline"
              >
                打开「{ws.name}」
              </button>
            ))}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="ml-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                返回当前对话
              </button>
            )}
          </div>
        )}
      </section>
    );
  }

  if (!preview) return null;

  return (
    <section
      aria-label="认识这个文件夹 · 导入前边界确认"
      data-testid="folder-boundary-review"
      className="w-full max-w-[740px] mx-auto my-6 rounded-[20px] border border-[var(--border-strong)] hearth-surface p-7 space-y-5 animate-hearth-fade-up"
    >
      {/* 顶栏：返回与标题（对应 PRD §3.3.B 线框） */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
        <button
          type="button"
          onClick={() => setStep("pick_folder")}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>返回重选文件夹</span>
        </button>
        <h2 className="text-sm font-semibold font-serif-narrative text-[var(--text-primary)]">
          认识这个文件夹 · 导入边界确认
        </h2>
      </div>

      {/* 路径与初步判断 */}
      <div className="space-y-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-[var(--text-muted)]">
          <span>已选择路径：</span>
          <code className="font-mono text-[var(--text-primary)] bg-black/[0.03] dark:bg-white/[0.04] px-2.5 py-0.5 rounded">
            {preview.displayPath}
          </code>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="text-[var(--text-primary)] font-medium">
            初步判断：
            {preview.recommendedMode === "select_candidates"
              ? "检测到多个独立项目候选（可勾选导入）"
              : "一个项目（Monorepo 不因多包自动拆分，可更改）"}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowReasons((prev) => !prev)}
              className="inline-flex items-center gap-1 text-xs text-[#c27537] dark:text-[#f1bb7c] hover:underline"
            >
              <span>{showReasons ? "收起识别依据" : "展开识别依据"}</span>
              {showReasons ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {!native && preview.candidates.length === 1 && (
              <button
                type="button"
                onClick={() => {
                  setForceMultiSplit((prev) => !prev);
                  if (!forceMultiSplit) {
                    handleChooseFolder("~/projects/studio-multi-repos");
                  }
                }}
                className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>这是多个项目？切换多候选预览</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 候选 Workspace 列表 */}
      <div className="space-y-2.5">
        {preview.candidates.map((cand) => {
          const isChecked = selectedCandidateIds.includes(cand.candidateId);
          return (
            <div
              key={cand.candidateId}
              onClick={() => toggleCandidate(cand.candidateId)}
              role="checkbox"
              aria-checked={isChecked}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  toggleCandidate(cand.candidateId);
                }
              }}
              className={`cursor-pointer rounded-xl border p-4 transition-all ${
                isChecked
                  ? "border-[#c27537] bg-[#e88e47]/[0.08]"
                  : "border-[var(--border-subtle)] bg-[var(--surface-solid)]/60 hover:border-[var(--border-strong)]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {isChecked ? (
                    <CheckSquare className="w-4 h-4 text-[#c27537] dark:text-[#f1bb7c] mt-0.5 shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-[var(--text-muted)] mt-0.5 shrink-0" />
                  )}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                      <span>{cand.suggestedName}</span>
                      <span className="text-xs font-normal text-[var(--text-muted)]">
                        · {cand.classification === "single_project" ? "建议作为一个 Workspace" : "独立子项目候选"}
                      </span>
                      <code className="text-xs font-mono font-normal text-[var(--text-muted)]">
                        ({cand.relativePath})
                      </code>
                    </div>
                    {showReasons && (
                      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                        发现依据：{cand.reasons.join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 三个独立权限语义（PRD §4.1.3）：1. 只读范围 / 默认排除  2. 模型初读  3. 联网搜索 */}
      <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)] text-xs">
        {/* 1. 只读目录范围与默认排除 */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-solid)]/70 p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#3d8068] shrink-0" />
              <span className="font-medium text-[var(--text-primary)]">
                只读范围 / 默认排除项（R1 不包含项目写入与脚本执行工具）
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowReadOnlyScope((prev) => !prev)}
              className="text-[#c27537] dark:text-[#f1bb7c] hover:underline font-medium whitespace-nowrap shrink-0"
            >
              {showReadOnlyScope ? "收起详情" : "查看范围"}
            </button>
          </div>
          {showReadOnlyScope && (
            <div className="mt-2.5 pt-2.5 border-t border-[var(--border-subtle)] space-y-1.5 text-[var(--text-muted)] animate-hearth-pop">
              <p>{preview.readOnlyBoundaryNote}</p>
              <div className="font-mono text-[11px]">
                默认排除目录：{preview.defaultExcludedPaths.join(", ")}
              </div>
              {preview.uncoveredReasons.length > 0 && (
                <div className="text-amber-700 dark:text-amber-300">
                  跳过说明：{preview.uncoveredReasons.join("；")}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 2. 模型初读授权开关 */}
        <label className="flex items-start gap-3 p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-solid)]/70 cursor-pointer hover:border-[var(--border-strong)] transition-colors">
          <input
            type="checkbox"
            checked={stepFunConfigured && enableModelInitialRead}
            disabled={!stepFunConfigured}
            onChange={(e) => setEnableModelInitialRead(e.target.checked)}
            className="mt-0.5 rounded border-[var(--border-strong)] accent-[#c27537]"
          />
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
              <Cpu className="w-3.5 h-3.5 text-[#e88e47]" />
              <span>
                {stepFunConfigured
                  ? "允许将必要项目片段发送给已配置 StepFun，调用已有开场入口。不会另建欢迎流程，也不会在保存 Key 时自动发送。"
                  : "先在设置里填写本次运行的 Key，才能开启初读。这里不能把模型标成已认证。"}
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {stepFunConfigured
                ? "勾选后确认导入会调用已有开场入口。不勾选则只做选择性读取和 local_scan_card。"
                : "当前尚未配置本次运行的 StepFun Key。本次导入只做本地只读扫描，不会读取全局凭据。"}
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-solid)]/70 cursor-pointer hover:border-[var(--border-strong)] transition-colors">
          <input
            type="checkbox"
            checked={native ? false : enableWebSearch}
            disabled={native}
            onChange={(e) => setEnableWebSearch(e.target.checked)}
            className="mt-0.5 rounded border-[var(--border-strong)] accent-[#c27537]"
          />
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
              <Globe className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              <span>
                {native
                  ? "联网搜索未完成，不能在这里启用。"
                  : enableWebSearch
                    ? "联网搜索：已启用（允许通过 MCP 检索外部文档）"
                    : "联网搜索：未启用（默认仅读取本地只读文件，可后续设置）"}
              </span>
            </div>
          </div>
        </label>
      </div>

      {/* 底部提交按钮 */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            取消
          </button>
        )}
        <button
          type="button"
          disabled={
            submittingImport ||
            preview.scanStatus === "failed" ||
            (native
              ? preview.recommendedMode === "select_candidates" && selectedCandidateIds.length === 0
              : selectedCandidateIds.length === 0)
          }
          onClick={handleConfirm}
          data-testid="confirm-import-button"
          className="px-5 py-2.5 rounded-xl text-sm font-medium bg-[#c27537] text-white hover:bg-[#b0672c] disabled:opacity-50 shadow-xs transition-all active:scale-[0.98] whitespace-nowrap shrink-0"
        >
          {submittingImport ? "正在创建工作空间…" : "开始认识项目"}
        </button>
      </div>
    </section>
  );
};
