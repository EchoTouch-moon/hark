import React, { useEffect, useState } from "react";
import { Check, KeyRound, Monitor, Moon, Sun, X } from "lucide-react";
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
  onUpdateRuntime: (patch: Partial<Pick<RuntimeStatus, "windowBehaviorOnClose" | "launchAtLogin" | "notificationsEnabled" | "stepFunConfigured" | "piSidecarStatus">>) => Promise<void>;
  onSimulateTrayMinimize: () => void;
  onClose: () => void;
  nativeLocked?: boolean;
  nativeStatusNote?: string;
  onSaveStepFunKey?: (apiKey: string) => Promise<void>;
  onClearStepFunKey?: () => Promise<void>;
}

export const AppSettings: React.FC<AppSettingsProps> = ({
  isOpen, runtime, themePref, onThemePrefChange, pauseMotion, onPauseMotionChange,
  onClose, onSaveStepFunKey, onClearStepFunKey,
}) => {
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!isOpen) { setKeyDraft(""); setNotice(""); }
  }, [isOpen]);
  if (!isOpen) return null;

  const saveKey = async (event: React.FormEvent) => {
    event.preventDefault();
    const key = keyDraft.trim();
    if (!onSaveStepFunKey || !key || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await onSaveStepFunKey(key);
      setKeyDraft("");
      setNotice("AI 配置已保存。已有项目的访问权限保持不变。");
    } catch {
      setNotice("保存失败，请检查系统钥匙串后重试。");
    } finally { setBusy(false); }
  };
  const clearKey = async () => {
    if (!onClearStepFunKey || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await onClearStepFunKey();
      setKeyDraft("");
      setNotice("AI 配置已移除。");
    } catch (error) {
      const code = error && typeof error === "object" && "details" in error
        ? (error.details as { nativeCode?: unknown } | undefined)?.nativeCode
        : undefined;
      setNotice(code === "sidecar_stop_incomplete"
        ? "已移除保存的配置，但 AI 连接尚未完全停止。请退出并重新打开 Hark。"
        : "未能完成全部操作，请检查 AI 连接状态后重试。");
    } finally { setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="应用设置" data-testid="app-settings-modal"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8 backdrop-blur-xs">
      <div className="w-full max-w-xl overflow-hidden rounded-[var(--corner-md)] border border-[var(--border-strong)] bg-[var(--surface-solid)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-6 py-5">
          <div><h3 className="font-serif-narrative text-lg font-semibold text-[var(--text-primary)]">应用设置</h3><p className="mt-1 text-xs text-[var(--text-muted)]">管理 AI 连接和界面偏好</p></div>
          <button type="button" onClick={onClose} aria-label="关闭应用设置" className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[75vh] space-y-6 overflow-y-auto p-6 text-sm">
          <section aria-labelledby="ai-settings-title" className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e88e47]/10 text-[#c27537]"><KeyRound className="h-4 w-4" /></div><div><h4 id="ai-settings-title" className="font-semibold text-[var(--text-primary)]">AI 连接</h4><p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">StepFun · step-3.7-flash</p></div></div>
              <span className="rounded-full bg-black/[0.04] px-2.5 py-1 text-xs text-[var(--text-muted)] dark:bg-white/[0.06]">{runtime.stepFunConfigured ? "已配置" : "未配置"}</span>
            </div>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">{runtime.credentialPersistenceAvailable ? "密钥保存在系统钥匙串中。保存不会发送请求，项目资料的访问权限可在项目设置中管理。" : "暂时无法安全保存 AI 配置，请检查系统设置或重新打开 Hark。"}</p>
            {runtime.credentialError && <p role="alert" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{runtime.credentialError}</p>}
            {onSaveStepFunKey && runtime.credentialPersistenceAvailable ? <form onSubmit={saveKey} className="space-y-3">
              <label htmlFor="stepfun-key" className="block text-xs font-medium text-[var(--text-primary)]">{runtime.stepFunConfigured ? "更换 API Key" : "API Key"}</label>
              <input id="stepfun-key" data-testid="stepfun-key-input" type="password" autoComplete="off" value={keyDraft} disabled={busy} onChange={(event) => setKeyDraft(event.target.value)} placeholder={runtime.stepFunConfigured ? "输入新的 Key" : "输入 StepFun API Key"} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:outline-2 focus:outline-[var(--focus-ring)]" />
              <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || !keyDraft.trim()} data-testid="save-stepfun-key-btn" className="rounded-lg bg-[#c27537] px-4 py-2 text-xs font-medium text-white hover:bg-[#b0672c] disabled:opacity-50">{busy ? "处理中…" : "保存配置"}</button>{runtime.stepFunConfigured && onClearStepFunKey && <button type="button" disabled={busy} data-testid="clear-stepfun-key-btn" onClick={() => void clearKey()} className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-xs font-medium text-[var(--text-muted)] hover:text-[#b74a46] disabled:opacity-50">移除配置</button>}</div>
              {notice && <p role="status" className="text-xs text-[var(--text-muted)]">{notice}</p>}
            </form> : null}
          </section>
          <section className="space-y-3 border-t border-[var(--border-subtle)] pt-5" aria-labelledby="appearance-title">
            <div><h4 id="appearance-title" className="font-semibold text-[var(--text-primary)]">外观</h4><p className="mt-1 text-xs text-[var(--text-muted)]">选择适合你的阅读方式</p></div>
            <div className="grid grid-cols-3 gap-2">{([
              ["auto", "自动", Monitor], ["light", "浅色", Sun], ["dark", "深色", Moon],
            ] as const).map(([value, label, Icon]) => <button key={value} type="button" onClick={() => onThemePrefChange(value)} data-testid={value === "light" ? "theme-light-btn" : value === "dark" ? "theme-dark-btn" : undefined} aria-pressed={themePref === value} className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs ${themePref === value ? "border-[#c27537] bg-[#e88e47]/10 text-[var(--text-primary)]" : "border-[var(--border-subtle)] text-[var(--text-muted)]"}`}><Icon className="h-3.5 w-3.5" />{label}{themePref === value && <Check className="h-3 w-3" />}</button>)}</div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] p-3"><div><div className="text-xs font-medium text-[var(--text-primary)]">减少动态效果</div><p className="mt-1 text-xs text-[var(--text-muted)]">暂停背景动画</p></div><button type="button" data-testid="toggle-pause-motion-btn" onClick={() => onPauseMotionChange(!pauseMotion)} aria-pressed={pauseMotion} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs text-[var(--text-primary)]">{pauseMotion ? "已开启" : "已关闭"}</button></div>
          </section>
        </div>
      </div>
    </div>
  );
};
