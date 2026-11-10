import React from "react";
import { Play, Pause, Eye, Power, BellRing, Flame } from "lucide-react";
import { AttentionItem, WorkspaceSummary } from "../../bridge/HarkBridge";

interface TrayCompanionBarProps {
  isWindowHiddenToTray: boolean;
  currentWorkspace?: WorkspaceSummary;
  pendingAttention?: AttentionItem;
  onRestoreWindow: () => void;
  onToggleObserver: () => void;
  onJumpToNotification: (item: AttentionItem) => void;
  onQuitApp: () => void;
  isAppQuit: boolean;
  onRelaunchApp: () => void;
}

/**
 * Native Desktop Layer · Tray / MenuBar & OS Notification Simulation
 * PRD §3.1, §4.6, §11.3 Journey 5:
 * - 托盘菜单最小集合：打开 Hark、当前观察状态、暂停/恢复、退出。不要将全部页面搬进托盘。
 * - 关闭主窗口隐藏至托盘时：停止持续视觉动画渲染；点击“打开 Hark”或点击通知直接回到正确对话/相关观点，不新建重复欢迎消息。
 * - 完全退出后展示已安全终止所有子进程的状态与重新启动入口。
 */
export const TrayCompanionBar: React.FC<TrayCompanionBarProps> = ({
  isWindowHiddenToTray,
  currentWorkspace,
  pendingAttention,
  onRestoreWindow,
  onToggleObserver,
  onJumpToNotification,
  onQuitApp,
  isAppQuit,
  onRelaunchApp,
}) => {
  if (isAppQuit) {
    return (
      <div
        data-testid="app-quit-screen"
        className="fixed inset-0 z-50 flex items-center justify-center bg-[#101013] text-[#ece8e0] p-6"
      >
        <div className="max-w-md w-full rounded-[var(--corner-md)] border border-white/15 bg-[#17171b] p-6 text-center space-y-4">
          <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mx-auto">
            <Power className="w-5 h-5 text-[#e88e47]" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Hark 已退出</h2>
            <p className="text-xs text-[#a9a39b] leading-relaxed">
              重新打开后可以继续查看对话和记录。
            </p>
          </div>
          <button
            type="button"
            onClick={onRelaunchApp}
            data-testid="relaunch-hark-button"
            className="px-4 py-2 rounded-lg text-xs font-medium bg-[#c27537] text-white hover:bg-[#b0672c] transition-colors"
          >
            重新启动 Hark 桌面端
          </button>
        </div>
      </div>
    );
  }

  if (!isWindowHiddenToTray) {
    return null;
  }

  return (
    <div
      data-testid="tray-hidden-overlay"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#101013]/95 text-[#ece8e0] p-6"
    >
      <div className="max-w-md w-full rounded-[var(--corner-md)] border border-white/15 bg-[#17171b] shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Flame className="w-4 h-4 text-[#e88e47]" />
            <span>Hark</span>
          </div>
          <span className="text-[11px] font-mono text-[#a9a39b]">
            主窗口已隐藏 · 视觉渲染已暂停
          </span>
        </div>

        {/* 托盘最小菜单集合（PRD §4.6: 打开 Hark、当前观察状态、暂停/恢复、退出） */}
        <div className="p-4 space-y-2 text-xs">
          <div className="px-3 py-2 rounded-lg bg-white/[0.03] flex items-center justify-between">
            <span className="text-[#a9a39b]">当前活动项目</span>
            <span className="font-medium">{currentWorkspace?.name || "未绑定项目"}</span>
          </div>

          <div className="px-3 py-2 rounded-lg bg-white/[0.03] flex items-center justify-between">
            <span className="text-[#a9a39b]">后台文件观察状态</span>
            <span className="inline-flex items-center gap-1.5 font-mono">
              <Eye className="w-3.5 h-3.5 text-[#e88e47]" />
              <span>
                {currentWorkspace?.observerState === "active"
                  ? "观察中 (active)"
                  : "已暂停 (paused)"}
              </span>
            </span>
          </div>

          {pendingAttention && (
            <div className="rounded-lg border border-[#e88e47]/40 bg-[#e88e47]/10 p-3 space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-[#f1bb7c]">
                <BellRing className="w-3.5 h-3.5 shrink-0" />
                <span>OS 桌面通知：{pendingAttention.headline}</span>
              </div>
              <p className="text-[11px] text-[#ece8e0]/80 leading-relaxed">
                {pendingAttention.whyNow}
              </p>
              <button
                type="button"
                onClick={() => onJumpToNotification(pendingAttention)}
                data-testid="tray-notification-jump-btn"
                className="w-full py-1.5 rounded-md bg-[#c27537] text-white font-medium hover:bg-[#b0672c] transition-colors"
              >
                点击通知：恢复窗口并直达关联观点（不重复生成欢迎语）
              </button>
            </div>
          )}

          <div className="pt-2 space-y-1.5">
            <button
              type="button"
              onClick={onRestoreWindow}
              data-testid="tray-restore-window-btn"
              className="w-full text-left px-3.5 py-2.5 rounded-lg bg-[#c27537] text-white font-medium hover:bg-[#b0672c] transition-colors flex items-center justify-between"
            >
              <span>打开 Hark 主窗口（恢复原对话位置）</span>
              <span className="font-mono text-[11px] opacity-80">⌘O</span>
            </button>

            {currentWorkspace && (
              <button
                type="button"
                onClick={onToggleObserver}
                data-testid="tray-toggle-observer-btn"
                className="w-full text-left px-3.5 py-2 rounded-lg hover:bg-white/5 transition-colors flex items-center justify-between"
              >
                <span className="inline-flex items-center gap-2">
                  {currentWorkspace.observerState === "active" ? (
                    <>
                      <Pause className="w-3.5 h-3.5 text-amber-400" />
                      <span>暂停当前项目后台观察</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 text-[#3d8068]" />
                      <span>恢复当前项目后台观察</span>
                    </>
                  )}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={onQuitApp}
              data-testid="tray-quit-app-btn"
              className="w-full text-left px-3.5 py-2 rounded-lg text-[#f28b87] hover:bg-[#b74a46]/15 transition-colors flex items-center justify-between"
            >
              <span className="inline-flex items-center gap-2">
                <Power className="w-3.5 h-3.5" />
                <span>完全退出 Hark (Quit)</span>
              </span>
              <span className="font-mono text-[11px] opacity-80">⌘Q</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
