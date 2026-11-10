import React, { useState } from "react";
import {
  X,
  Sun,
  Moon,
  Clock,
  Cpu,
  AlertOctagon,
  Monitor,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { RuntimeStatus } from "../../bridge/HarkBridge";

export type ThemePreference = "auto" | "light" | "dark";

interface AppSettingsProps {
  isOpen: boolean;
  runtime: RuntimeStatus;
  themePref: ThemePreference;
  onThemePrefChange: (pref: ThemePreference) => void;
  pauseMotion: boolean;
  onPauseMotionChange: (paused: boolean) => void;
  bridgeMode: "dev_preview_synthetic" | "strict_tauri_ipc";
  onBridgeModeChange: (mode: "dev_preview_synthetic" | "strict_tauri_ipc") => void;
  onUpdateRuntime: (
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
  ) => Promise<void>;
  onSimulateTrayMinimize: () => void;
  onClose: () => void;
  nativeLocked?: boolean;
  nativeStatusNote?: string;
  onSaveStepFunKey?: (apiKey: string) => Promise<void>;
  onClearStepFunKey?: () => Promise<void>;
}

/**
 * FE-13 · AppSettings & Runtime Status
 * PRD §4.6, §6.3, §6.4, §9.2, §13:
 * - 主题偏好：自动（按本地时间 07:00-18:59 暖白日间 / 19:00-06:59 近黑夜间） / 明亮 / 深色。
 * - 动效控制：暂停持续火影动效（不影响真实观察与后台对话）。
 * - 桌面窗口生命周期：关闭主窗口默认隐藏至托盘 vs 完全退出。
 * - 显式 DevPreviewBridge 状态切换与故障演练（测试 Sidecar 失联、StepFun 未配置、严格 Tauri IPC 校验）。
 */
export const AppSettings: React.FC<AppSettingsProps> = ({
  isOpen,
  runtime,
  themePref,
  onThemePrefChange,
  pauseMotion,
  onPauseMotionChange,
  bridgeMode,
  onBridgeModeChange,
  onUpdateRuntime,
  onSimulateTrayMinimize,
  onClose,
  nativeLocked = false,
  nativeStatusNote,
  onSaveStepFunKey,
  onClearStepFunKey,
}) => {
  const [keyDraft, setKeyDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyNote, setKeyNote] = useState("");
  if (!isOpen) return null;

  const saveKey = async () => {
    if (!onSaveStepFunKey) return;
    const next = keyDraft.trim();
    if (!next) return;
    setKeyBusy(true);
    setKeyNote("");
    try {
      await onSaveStepFunKey(next);
      setKeyDraft("");
      setKeyNote("已保存在本次运行内存。这不表示 Key 已认证，也没有发送请求。重启后需要重填。");
    } catch (err) {
      setKeyNote(err instanceof Error ? err.message : "保存失败。没有发送模型请求。");
    } finally {
      setKeyBusy(false);
    }
  };

  const clearKey = async () => {
    if (!onClearStepFunKey) return;
    setKeyBusy(true);
    setKeyNote("");
    try {
      await onClearStepFunKey();
      setKeyDraft("");
      setKeyNote("已清除本次运行的 Key。工作空间授权仍保留，重启后也不会去找全局凭据。");
    } catch (err) {
      setKeyNote(err instanceof Error ? err.message : "清除失败。");
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hark 桌面应用设置与运行状态"
      data-testid="app-settings-modal"
      className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 bg-black/40 backdrop-blur-xs"
    >
      <div className="w-full max-w-xl rounded-[var(--corner-md)] border border-[var(--border-strong)] bg-[var(--surface-solid)] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              应用设置与宿主运行状态 (App Settings & Runtime)
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              主题氛围、动效合同、桌面托盘生命周期与前后端接口契约状态
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭应用设置"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 max-h-[78vh] overflow-y-auto space-y-5 text-xs">
          {/* 1. 昼夜环境光与主题 (PRD §6.4) */}
          <div className="space-y-2">
            <div className="font-semibold text-[var(--text-primary)]">
              昼夜环境光与主题覆盖（仅切换环境，不改变业务状态与火势等级）
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => onThemePrefChange("auto")}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border font-medium transition-colors ${
                  themePref === "auto"
                    ? "border-[#c27537] bg-[#e88e47]/15 text-[var(--text-primary)]"
                    : "border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--text-muted)]"
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>自动昼夜 (07-19)</span>
              </button>
              <button
                type="button"
                onClick={() => onThemePrefChange("light")}
                data-testid="theme-light-btn"
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border font-medium transition-colors ${
                  themePref === "light"
                    ? "border-[#c27537] bg-[#e88e47]/15 text-[var(--text-primary)]"
                    : "border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--text-muted)]"
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>暖白日间</span>
              </button>
              <button
                type="button"
                onClick={() => onThemePrefChange("dark")}
                data-testid="theme-dark-btn"
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border font-medium transition-colors ${
                  themePref === "dark"
                    ? "border-[#c27537] bg-[#e88e47]/15 text-[var(--text-primary)]"
                    : "border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--text-muted)]"
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>近黑夜间</span>
              </button>
            </div>
          </div>

          {/* 2. 动效合同与无障碍 (PRD §6.3) */}
          <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] p-3.5 flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#e88e47]" />
                <span>暂停持续火光呼吸动效 (Reduced Motion)</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                开启后背景采用静态火影，停止持续动画渲染，但绝不停止后台真实观察与对话任务。
              </p>
            </div>
            <button
              type="button"
              onClick={() => onPauseMotionChange(!pauseMotion)}
              data-testid="toggle-pause-motion-btn"
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap shrink-0 ${
                pauseMotion
                  ? "bg-[#c27537] text-white"
                  : "bg-black/10 dark:bg-white/10 text-[var(--text-primary)]"
              }`}
            >
              {pauseMotion ? "已暂停动效（静态火影）" : "动效正常开启"}
            </button>
          </div>

          {/* 3. 桌面窗口生命周期与托盘 (PRD §4.6 & FE-O6) */}
          <div className="space-y-2">
            <div className="font-semibold text-[var(--text-primary)]">
              桌面宿主生命周期与系统托盘 (Native Desktop Layer)
            </div>
            <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-[var(--text-primary)]">
                    点击窗口关闭按钮默认行为
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {nativeLocked ? "当前版本暂不支持更改此行为。" : "与完全退出和暂停观察区分；隐藏窗口时停止前端高频视觉渲染。"}
                  </p>
                </div>
                <select
                  aria-label="点击窗口关闭按钮默认行为"
                  disabled={nativeLocked}
                  title={nativeLocked ? "当前版本暂不支持更改" : undefined}
                  value={runtime.windowBehaviorOnClose}
                  onChange={(e) =>
                    onUpdateRuntime({
                      windowBehaviorOnClose: e.target.value as RuntimeStatus["windowBehaviorOnClose"],
                    })
                  }
                  className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-solid)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                >
                  <option value="hide_to_tray">隐藏至系统托盘（保持后台观察）</option>
                  <option value="quit_app">完全退出 Hark 进程</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]">
                <span className="text-[11px] text-[var(--text-muted)]">
                  可立即演练“关闭主窗口隐藏至托盘 → 停止动画渲染 → 从托盘恢复原对话”：
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSimulateTrayMinimize();
                  }}
                  data-testid="simulate-tray-hide-btn"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium border border-[var(--border-strong)] bg-[var(--surface-solid)] text-[var(--text-primary)] hover:border-[#e88e47]"
                >
                  <Monitor className="w-3.5 h-3.5 text-[#c27537] dark:text-[#f1bb7c]" />
                  <span>{nativeLocked ? "调用 hide_window" : "模拟隐藏窗口至系统托盘"}</span>
                </button>
              </div>
            </div>
          </div>

          {/* 4. 真实状態与故障验收控制台 (PRD §9.2 & §11.3 Journey 4) */}
          <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
            <div className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-[#e88e47]" />
              <span>HarkBridge 数据通路与故障状态验证 (Journey 4 验收)</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {nativeLocked
                ? nativeStatusNote || "Sidecar 与模型状态只展示 Native 返回。不能在这里拨成已配置或已批准。Dev Preview 只能显式切换。"
                : "根据 PRD §7.2 与 §9.2，前端严禁在真实调用失败时静默切入 Mock。你可以在下方切换真实 Tauri IPC 校验模式，或注入 Sidecar 故障 / 模型未配置状态检验 UI 诚实降级。"}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[var(--text-primary)]">Pi Agent Host Sidecar</span>
                  <span
                    className={`font-mono text-[11px] ${
                      runtime.piSidecarStatus === "ready" ? "text-[#3d8068]" : "text-[#b74a46]"
                    }`}
                  >
                    {runtime.piSidecarStatus}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={nativeLocked}
                  data-testid="toggle-sidecar-fault-btn"
                  onClick={() =>
                    onUpdateRuntime({
                      piSidecarStatus:
                        runtime.piSidecarStatus === "ready" ? "unavailable" : "ready",
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--surface-solid)] text-xs font-medium hover:border-[#e88e47] transition-colors"
                >
                  {runtime.piSidecarStatus === "ready"
                    ? "模拟 Sidecar 进程失联 (SIDECAR_UNAVAILABLE)"
                    : "恢复 Sidecar 进程就绪 (ready)"}
                </button>
              </div>

              <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[var(--text-primary)]">StepFun 模型凭据状态</span>
                  <span
                    className={`font-mono text-[11px] ${
                      runtime.stepFunConfigured ? "text-[#3d8068]" : "text-amber-600"
                    }`}
                  >
                    {runtime.stepFunConfigured ? "已配置" : "未配置"}
                  </span>
                </div>
                {onSaveStepFunKey ? (
                  <div className="space-y-2">
                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                      固定套餐 stepfun / step-3.7-flash。Key 只留在本次运行内存，不写入本地存储。保存本身不发请求，也不给所有工作空间授权。
                    </p>
                    <input
                      type="password"
                      autoComplete="off"
                      value={keyDraft}
                      disabled={keyBusy}
                      data-testid="stepfun-key-input"
                      placeholder="本次运行的 StepFun Key"
                      onChange={(event) => setKeyDraft(event.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--surface-solid)] text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={keyBusy || keyDraft.trim().length === 0}
                        data-testid="save-stepfun-key-btn"
                        onClick={() => void saveKey()}
                        className="flex-1 px-2.5 py-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--surface-solid)] text-xs font-medium hover:border-[#e88e47]"
                      >
                        仅本次运行保存
                      </button>
                      <button
                        type="button"
                        disabled={keyBusy}
                        data-testid="clear-stepfun-key-btn"
                        onClick={() => void clearKey()}
                        className="px-2.5 py-1.5 rounded-md border border-[var(--border-strong)] text-xs"
                      >
                        清除
                      </button>
                    </div>
                    {keyNote ? <p className="text-[11px] text-[var(--text-muted)]">{keyNote}</p> : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={nativeLocked}
                    data-testid="toggle-stepfun-config-btn"
                    onClick={() =>
                      onUpdateRuntime({
                        stepFunConfigured: !runtime.stepFunConfigured,
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--surface-solid)] text-xs font-medium hover:border-[#e88e47] transition-colors"
                  >
                    {runtime.stepFunConfigured
                      ? "模拟未配置 StepFun (MODEL_NOT_CONFIGURED)"
                      : "恢复 StepFun 已配置状态"}
                  </button>
                )}
              </div>
            </div>

            {/* Bridge 模式切换 */}
            <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="font-medium text-[var(--text-primary)]">
                  当前 Bridge 适配器：{bridgeMode === "dev_preview_synthetic" ? "DEV PREVIEW / SYNTHETIC" : "Strict Tauri 2 IPC"}
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  若切换至 Strict Tauri IPC，在非 Tauri 宿主窗口中将直接触发不可用边界且绝不回退 Mock。
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onBridgeModeChange(
                    bridgeMode === "dev_preview_synthetic"
                      ? "strict_tauri_ipc"
                      : "dev_preview_synthetic"
                  )
                }
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-solid)] font-medium hover:border-[#e88e47]"
              >
                {bridgeMode === "dev_preview_synthetic" ? (
                  <>
                    <AlertOctagon className="w-3.5 h-3.5 text-amber-600" />
                    <span>验证 Strict Tauri IPC 失联态</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#3d8068]" />
                    <span>切回显式 DevPreviewBridge</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
