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
      aria-label="当前工作空间权限与边界设置"
      data-testid="workspace-settings-modal"
      className="fixed inset-0 z-50 flex items-start justify-center pt-14 px-4 bg-black/40 backdrop-blur-xs"
    >
      <div className="w-full max-w-xl rounded-[var(--corner-md)] border border-[var(--border-strong)] bg-[var(--surface-solid)] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#e88e47]" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                工作空间权限与只读范围 · {summary.name}
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] font-mono">
                {summary.rootDisplayPath}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭工作空间设置"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
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
                    : summary.observerState === "unavailable"
                      ? "未完成 (unavailable)"
                      : "已暂停观察 (paused)"}
                </span>
              </div>
              <p className="text-[var(--text-muted)] leading-relaxed">
                {nativeLocked
                  ? "文件观察器未完成。目录暂停、恢复、撤销走已有 Native 命令，不会把观察器显示成 active。"
                  : "暂停观察后，Rust 后台不再监听文件变动；观察暂停不会让背景火光变暗冒充项目停滞。"}
              </p>
            </div>
            <button
              type="button"
              disabled={saving || nativeLocked}
              onClick={handleToggleObserver}
              data-testid="toggle-observer-button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium border border-[var(--border-strong)] bg-[var(--surface-solid)] text-[var(--text-primary)] hover:border-[#e88e47] transition-colors whitespace-nowrap shrink-0"
            >
              {summary.observerState === "active" ? (
                <>
                  <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                  <span>暂停观察</span>
                </>
              ) : (
                <>
                  <PlayCircle className="w-3.5 h-3.5 text-[#3d8068]" />
                  <span>{nativeLocked ? "观察器未完成" : "恢复观察"}</span>
                </>
              )}
            </button>
          </div>

          {nativeLocked && workspace.rootId && (
            <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-2">
              <div className="font-semibold text-[var(--text-primary)]">
                目录授权 · {workspace.directoryStatus ?? "unknown"}
              </div>
              <p className="text-[var(--text-muted)] leading-relaxed">
                只对已授权 root 调用 pause / resume / revoke。不能在这里输入新路径。
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={saving} onClick={() => workspace.rootId && onPauseDirectory?.(workspace.rootId)} className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)]">暂停目录</button>
                <button type="button" disabled={saving} onClick={() => workspace.rootId && onResumeDirectory?.(workspace.rootId)} className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)]">恢复目录</button>
                <button type="button" disabled={saving} onClick={() => workspace.rootId && onRevokeDirectory?.(workspace.rootId)} className="px-3 py-1.5 rounded-lg border border-[#b74a46]/40 text-[#b74a46]">撤销目录</button>
              </div>
            </div>
          )}

          {/* 2. 模型对话与联网搜索授权 */}
          <div className="space-y-2.5">
            <div className="font-semibold text-[var(--text-primary)]">
              模型推理与外部搜索授权（Workspace 级隔离）
            </div>

            <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] p-3.5 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="font-medium text-[var(--text-primary)]">
                  StepFun 模型连续对话与片段分析授权 ({summary.modelPermission})
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  只授权这一个工作空间。填写 Key 不会打开其他工作空间。暂停或撤销目录后，已有检查会拦住发送。重启后 Key 要重填，授权会保留。
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
                  控制 Pi Agent 是否可调用外部搜索并在对话中附上 web_snippet / web_fulltext 证据。
                </p>
              </div>
              <button
                type="button"
                disabled={saving || nativeLocked}
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
              只读白名单入口 ({readOnlyPaths.length})
            </div>
            <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
              {readOnlyPaths.map((p) => (
                <span
                  key={p}
                  className="px-2.5 py-1 rounded bg-black/[0.04] dark:bg-white/[0.05] text-[var(--text-primary)]"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-[var(--text-primary)]">
              排除目录与子空间隔离 ({excludedPaths.length})
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              被排除的路径不会被当前 Agent 扫描；历史对话中已存在的旧引文会保留并标记为“已移出当前范围”。
            </p>
            <div className="flex flex-wrap gap-2">
              {excludedPaths.map((p) => (
                <div
                  key={p}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] font-mono text-[11px]"
                >
                  <span>{p}</span>
                  <button
                    type="button"
                    disabled={nativeLocked}
                    onClick={() => handleRemoveExcluded(p)}
                    aria-label={`移除排除项 ${p}`}
                    className="text-[var(--text-muted)] hover:text-[#b74a46]"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <form onSubmit={handleAddExcluded} className="flex items-center gap-2 pt-1">
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
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
