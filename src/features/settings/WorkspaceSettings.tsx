import React, { useState } from "react";
import { X, Shield, Eye, PauseCircle, PlayCircle, Plus, Trash2 } from "lucide-react";
import {
  ServicePermission,
  WorkspaceDetail,
  WorkspacePermissionsUpdate,
} from "../../bridge/HarkBridge";

interface WorkspaceSettingsProps {
  isOpen: boolean;
  workspace: WorkspaceDetail | null;
  onUpdatePermissions: (patch: Omit<WorkspacePermissionsUpdate, "requestId" | "workspaceId" | "expectedRevision">) => Promise<void>;
  onClose: () => void;
  nativeLocked?: boolean;
  onPauseDirectory?: (rootId: string) => Promise<void>;
  onResumeDirectory?: (rootId: string) => Promise<void>;
  onRevokeDirectory?: (rootId: string) => Promise<void>;
}

/**
 * FE-12 · WorkspaceSettings
 * PRD §4.5, §4.6, §5, §7.8:
 * - 目录只读边界、排除项、模型对话授权、联网搜索授权、观察暂停/恢复。
 * - 用户撤销模型/搜索权限后，当前 UI 立即刷新权限快照并停止相关远程请求。
 * - 观察暂停时明确显示 paused，不用火焰变暗伪装项目休眠。
 */
export const WorkspaceSettings: React.FC<WorkspaceSettingsProps> = ({
  isOpen,
  workspace,
  onUpdatePermissions,
  onClose,
  nativeLocked = false,
  onPauseDirectory,
  onResumeDirectory,
  onRevokeDirectory,
}) => {
  const [newExcluded, setNewExcluded] = useState("");
  const [saving, setSaving] = useState(false);
  const [directoryError, setDirectoryError] = useState("");

  if (!isOpen || !workspace) return null;

  const { summary, readOnlyPaths, excludedPaths } = workspace;

  const handleTogglePermission = async (
    field: "modelPermission" | "searchPermission",
    current: ServicePermission
  ) => {
    setSaving(true);
    try {
      const next: ServicePermission = current === "enabled" ? "disabled" : "enabled";
      await onUpdatePermissions({ [field]: next });
    } finally {
      setSaving(false);
    }
  };

  const handleDirectoryAction = async (action: ((rootId: string) => Promise<void>) | undefined) => {
    if (!workspace.rootId || !action) return;
    setSaving(true);
    setDirectoryError("");
    try {
      await action(workspace.rootId);
    } catch (err) {
      setDirectoryError(err && typeof err === "object" && "message" in err ? String(err.message) : "目录授权操作失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleObserver = async () => {
    setSaving(true);
    try {
      const next = summary.observerState === "active" ? "paused" : "active";
      await onUpdatePermissions({ observerState: next });
    } finally {
      setSaving(false);
    }
  };

  const handleAddExcluded = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newExcluded.trim();
    if (!clean || excludedPaths.includes(clean)) return;
    setSaving(true);
    try {
      await onUpdatePermissions({
        excludedPaths: [...excludedPaths, clean],
      });
      setNewExcluded("");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveExcluded = async (target: string) => {
    setSaving(true);
    try {
      await onUpdatePermissions({
        excludedPaths: excludedPaths.filter((p) => p !== target),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="项目设置"
      data-testid="workspace-settings-modal"
      className="fixed inset-0 z-50 flex items-start justify-center pt-14 px-4 bg-black/40 backdrop-blur-xs"
    >
      <div className="w-full max-w-xl rounded-[var(--corner-md)] border border-[var(--border-strong)] bg-[var(--surface-solid)] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="w-4 h-4 text-[#e88e47] shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                项目设置 · {summary.name}
              </h3>
              <p title={summary.rootDisplayPath} className="text-[11px] text-[var(--text-muted)] font-mono truncate">
                {summary.rootDisplayPath}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭工作空间设置"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 max-h-[75vh] overflow-y-auto space-y-5 text-xs">
          {/* 1. 后台文件观察状态 */}
          <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] p-4 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 text-[#e88e47]" />
                <span>
                  文件观察器状态：
                  {summary.observerState === "active"
                    ? "正在观察 (active)"
                    : summary.observerState === "paused"
                      ? "已暂停观察 (paused)"
                      : summary.observerState === "unauthorized"
                        ? "目录未授权 (unauthorized)"
                        : "未就绪 (unavailable)"}
                </span>
              </div>
              <p className="text-[var(--text-muted)] leading-relaxed">
                暂停观察后，Rust 后台不再监听文件变动；观察暂停不会让背景火光变暗冒充项目停滞。
              </p>
            </div>
            <button
              type="button"
              disabled={saving || summary.observerState === "unauthorized" || summary.observerState === "unavailable"}
              onClick={handleToggleObserver}
              data-testid="toggle-observer-button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium border border-[var(--border-strong)] bg-[var(--surface-solid)] text-[var(--text-primary)] hover:border-[#e88e47] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {summary.observerState === "active" ? (
                <>
                  <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                  <span>暂停观察</span>
                </>
              ) : (
                <>
                  <PlayCircle className="w-3.5 h-3.5 text-[#3d8068]" />
                  <span>{summary.observerState === "unauthorized" ? "目录未授权" : "恢复观察"}</span>
                </>
              )}
            </button>
          </div>

          {nativeLocked && workspace.rootId && (
            <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-2">
              <div className="font-semibold text-[var(--text-primary)]">
                文件夹访问 · {workspace.directoryStatus === "active" ? "已授权" : workspace.directoryStatus === "paused" ? "已暂停" : workspace.directoryStatus === "revoked" ? "已撤销" : "状态未知"}
              </div>
              <p className="text-[var(--text-muted)] leading-relaxed">
                Hark 只能读取你选择的文件夹。暂停或撤销后将停止读取。
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={saving || !onPauseDirectory || workspace.directoryStatus !== "active"} onClick={() => void handleDirectoryAction(onPauseDirectory)} className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)] disabled:opacity-50">暂停目录</button>
                <button type="button" disabled={saving || !onResumeDirectory || workspace.directoryStatus !== "paused"} onClick={() => void handleDirectoryAction(onResumeDirectory)} className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)] disabled:opacity-50">恢复目录</button>
                <button type="button" disabled={saving || !onRevokeDirectory || workspace.directoryStatus === "revoked"} onClick={() => void handleDirectoryAction(onRevokeDirectory)} className="px-3 py-1.5 rounded-lg border border-[#b74a46]/40 text-[#b74a46] disabled:opacity-50">撤销目录</button>
              </div>
              {directoryError && <p role="alert" className="text-[#b74a46]">{directoryError}</p>}
            </div>
          )}

          {/* 2. 模型对话与联网搜索授权 */}
          <div className="space-y-2.5">
            <div className="font-semibold text-[var(--text-primary)]">
              AI 访问
            </div>

            <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] p-3.5 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="font-medium text-[var(--text-primary)]">
                  允许 AI 分析此项目
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  此权限仅适用于当前项目。分析时，所需资料会发送给 StepFun；你可以随时撤销。
                </p>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleTogglePermission("modelPermission", summary.modelPermission)}
                data-testid="toggle-model-permission-btn"
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 ${
                  summary.modelPermission === "enabled"
                    ? "bg-[#3d8068] text-white"
                    : "bg-black/10 dark:bg-white/10 text-[var(--text-primary)]"
                }`}
              >
                {summary.modelPermission === "enabled" ? "已授权 · 点击撤销" : "未授权 · 点击启用"}
              </button>
            </div>

            <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] p-3.5 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="font-medium text-[var(--text-primary)]">
                  MCP 联网搜索权限 ({summary.searchPermission})
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  控制 Agent 是否可调用 Tavily 等外部搜索服务并在对话中附上网页事实来源。
                </p>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleTogglePermission("searchPermission", summary.searchPermission)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 ${
                  summary.searchPermission === "enabled"
                    ? "bg-[#3d8068] text-white"
                    : "bg-black/10 dark:bg-white/10 text-[var(--text-primary)]"
                }`}
              >
                {summary.searchPermission === "enabled" ? "已启用 · 点击关闭" : "未启用 · 点击开启"}
              </button>
            </div>
          </div>

          {/* 3. 只读目录与排除路径 */}
          <div className="space-y-2">
            <div className="font-semibold text-[var(--text-primary)]">
              可读取的文件夹 ({readOnlyPaths.length})
            </div>
            <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
              {readOnlyPaths.map((p) => (
                <span
                  key={p}
                  className="max-w-full break-all px-2.5 py-1 rounded bg-black/[0.04] dark:bg-white/[0.05] text-[var(--text-primary)]"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-[var(--text-primary)]">
              排除的目录 ({excludedPaths.length})
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              这些目录不会被读取。历史对话中已引用的资料仍会保留，并标记为已移出范围。
            </p>
            <div className="flex flex-wrap gap-2">
              {excludedPaths.map((p) => (
                <div
                  key={p}
                  className="inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] font-mono text-[11px]"
                >
                  <span className="break-all">{p}</span>
                  {!nativeLocked && <button
                    type="button"
                    disabled={nativeLocked}
                    onClick={() => handleRemoveExcluded(p)}
                    aria-label={`移除排除项 ${p}`}
                    className="text-[var(--text-muted)] hover:text-[#b74a46]"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>}
                </div>
              ))}
            </div>

            {!nativeLocked && <form onSubmit={handleAddExcluded} className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newExcluded}
                onChange={(e) => setNewExcluded(e.target.value)}
                placeholder="新增排除相对路径，如 coverage/ 或 packages/legacy/"
                className="flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 font-mono text-xs text-[var(--text-primary)]"
              />
              <button
                type="submit"
                disabled={saving || nativeLocked || !newExcluded.trim()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg font-medium bg-[#c27537] text-white hover:bg-[#b0672c] disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>添加排除</span>
              </button>
            </form>}
          </div>
        </div>
      </div>
    </div>
  );
};
