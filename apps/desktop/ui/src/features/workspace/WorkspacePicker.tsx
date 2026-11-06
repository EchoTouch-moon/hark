import React, { useState, useEffect } from "react";
import {
  Search,
  FolderPlus,
  GitBranchPlus,
  Check,
  X,
  PauseCircle,
  Sparkles,
} from "lucide-react";
import {
  CreateChildWorkspaceInput,
  WorkspaceId,
  WorkspaceSummary,
} from "../../bridge/HarkBridge";

interface WorkspacePickerProps {
  isOpen: boolean;
  workspaces: WorkspaceSummary[];
  currentWorkspaceId?: WorkspaceId;
  onSelectWorkspace: (id: WorkspaceId) => void;
  onStartAddFolder: () => void;
  onCreateChildWorkspace: (input: CreateChildWorkspaceInput) => Promise<void>;
  onClose: () => void;
  childSplitAvailable?: boolean;
}

/**
 * FE-02 · WorkspacePicker
 * PRD §3.1, §4.5, §5:
 * - Workspace Picker 展示项目名称、必要状态和一个搜索框；多工作空间时默认选中当前对话。
 * - 支持将当前项目的子目录拆分为独立子 Workspace：前端显示父空间排除与历史保留的明确说明，用户确认后一次请求原子提交，不出现半成功。
 */
export const WorkspacePicker: React.FC<WorkspacePickerProps> = ({
  isOpen,
  workspaces,
  currentWorkspaceId,
  onSelectWorkspace,
  onStartAddFolder,
  onCreateChildWorkspace,
  onClose,
  childSplitAvailable = true,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showChildModal, setShowChildModal] = useState(false);
  const [subPath, setSubPath] = useState("packages/memory-engine");
  const [childName, setChildName] = useState("Hark Memory Engine");
  const [excludeFromParent, setExcludeFromParent] = useState(true);
  const [retainParentHistoryRef, setRetainParentHistoryRef] = useState(true);
  const [submittingChild, setSubmittingChild] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filtered = workspaces.filter(
    (w) =>
      w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.rootDisplayPath.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const currentWs = workspaces.find((w) => w.id === currentWorkspaceId);

  const handleCreateChild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorkspaceId || !subPath.trim() || !childName.trim()) return;
    setSubmittingChild(true);
    try {
      await onCreateChildWorkspace({
        requestId: `req-child-${Date.now()}`,
        parentWorkspaceId: currentWorkspaceId,
        relativeSubPath: subPath.trim(),
        suggestedName: childName.trim(),
        excludeFromParent,
        retainParentHistoryRef,
      });
      setShowChildModal(false);
      onClose();
    } finally {
      setSubmittingChild(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="切换或添加项目工作空间"
      data-testid="workspace-picker-modal"
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/40 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg rounded-[var(--corner-md)] border border-[var(--border-strong)] bg-[var(--surface-solid)] shadow-2xl overflow-hidden">
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)]">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              项目工作空间切换 (Workspace Switcher)
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              一个项目对应一个逻辑 Agent、专属会话与隔离草稿
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭工作空间切换器"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 搜索框 */}
        <div className="p-4 border-b border-[var(--border-subtle)]">
          <div className="relative">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="按项目名称或路径筛选工作空间…"
              aria-label="筛选工作空间"
              className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] pl-9 pr-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-2 focus:outline-[var(--focus-ring)]"
            />
          </div>
        </div>

        {/* 空间列表 */}
        <div className="max-h-72 overflow-y-auto divide-y divide-[var(--border-subtle)]">
          {filtered.map((ws) => {
            const isSelected = ws.id === currentWorkspaceId;
            return (
              <button
                key={ws.id}
                type="button"
                data-testid={`select-workspace-${ws.id}`}
                onClick={() => {
                  onSelectWorkspace(ws.id);
                  onClose();
                }}
                className={`w-full text-left px-5 py-3.5 flex items-center justify-between gap-3 transition-colors ${
                  isSelected
                    ? "bg-[#e88e47]/[0.09]"
                    : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                }`}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                    <span className="truncate">{ws.name}</span>
                    {ws.observerState === "paused" && (
                      <span className="inline-flex items-center gap-1 text-xs font-normal text-amber-600 dark:text-amber-400">
                        <PauseCircle className="w-3 h-3" />
                        <span>观察已暂停</span>
                      </span>
                    )}
                    {ws.agentStatus !== "idle" && (
                      <span className="inline-flex items-center gap-1 text-xs font-normal text-[#c27537] dark:text-[#f1bb7c]">
                        <Sparkles className="w-3 h-3" />
                        <span>{ws.agentStatus}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
                    <span className="truncate">{ws.rootDisplayPath}</span>
                    <span aria-hidden="true">·</span>
                    <span>模型: {ws.modelPermission}</span>
                    <span aria-hidden="true">·</span>
                    <span>联网: {ws.searchPermission}</span>
                  </div>
                </div>

                {isSelected && (
                  <Check className="w-4 h-4 text-[#c27537] dark:text-[#f1bb7c] shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* 拆分独立子目录工作空间表单（PRD §4.5: 父空间排除与历史保留一次原子提交） */}
        {showChildModal && currentWs ? (
          <form
            onSubmit={handleCreateChild}
            className="p-5 border-t border-[var(--border-strong)] bg-[var(--surface)] space-y-3 text-xs"
          >
            <div className="font-semibold text-[var(--text-primary)]">
              从父空间「{currentWs.name}」拆分独立子目录 Workspace
            </div>
            <p className="text-[var(--text-muted)] leading-relaxed">
              确认后将向 Rust Core 一次性原子提交「父空间排除该子目录」与「新建子项目空间」，绝不在前端本地先行伪造排除状态。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                  子目录相对路径
                </label>
                <input
                  type="text"
                  value={subPath}
                  onChange={(e) => setSubPath(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-solid)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                  新子空间名称
                </label>
                <input
                  type="text"
                  value={childName}
                  onChange={(e) => setChildName(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-solid)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeFromParent}
                onChange={(e) => setExcludeFromParent(e.target.checked)}
                className="accent-[#c27537]"
              />
              <span className="text-[var(--text-primary)]">
                同步在父工作空间「{currentWs.name}」中排除该子目录，避免双 Agent 重复扫描
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={retainParentHistoryRef}
                onChange={(e) => setRetainParentHistoryRef(e.target.checked)}
                className="accent-[#c27537]"
              />
              <span className="text-[var(--text-primary)]">
                保留父空间历史对话中对该目录的旧引文锚点（标记为“已移出当前范围”）
              </span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowChildModal(false)}
                className="px-3 py-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={submittingChild}
                data-testid="confirm-child-workspace-btn"
                className="px-3.5 py-1.5 rounded-md font-medium bg-[#c27537] text-white hover:bg-[#b0672c]"
              >
                {submittingChild ? "正在原子提交…" : "确认排除父目录并创建子空间"}
              </button>
            </div>
          </form>
        ) : (
          <div className="px-5 py-3.5 border-t border-[var(--border-subtle)] bg-[var(--surface)] flex flex-wrap items-center justify-between gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                onClose();
                onStartAddFolder();
              }}
              data-testid="add-new-folder-button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium bg-[#c27537] text-white hover:bg-[#b0672c] transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>添加新项目文件夹</span>
            </button>

            {currentWs && childSplitAvailable && (
              <button
                type="button"
                onClick={() => setShowChildModal(true)}
                data-testid="open-split-child-btn"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium border border-[var(--border-strong)] text-[var(--text-primary)] hover:border-[#e88e47] transition-colors"
              >
                <GitBranchPlus className="w-3.5 h-3.5 text-[#c27537] dark:text-[#f1bb7c]" />
                <span>拆分当前项目的子目录为独立空间</span>
              </button>
            )}
            {currentWs && !childSplitAvailable && (
              <span className="text-[11px] text-[var(--text-muted)]">
                子工作空间尚未完成，不能在这里拆分。
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
