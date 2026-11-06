import React from "react";
import { CheckCircle2, Loader2, Lock, AlertTriangle, ArrowRight } from "lucide-react";
import { OnboardingRun } from "../../bridge/HarkBridge";

interface OnboardingProgressProps {
  run?: OnboardingRun | null;
  onAdvanceStage?: (runId: string) => void;
  onEnableModelAuth?: () => void;
}

/**
 * FE-04 · OnboardingProgress
 * PRD §4.1.5, §4.1.7, §4.1.8:
 * - 在对话页呈现实时阶段：扫描结构 → 阅读关键资料 → 生成理解 → 首条消息已保存。
 * - 内容来自后端持久化的 OnboardingRun，不是固定百分比假动画；重启/刷新依赖后端恢复，不盲目重扫。
 * - 若等待模型授权（waiting_for_model_auth），提供一键开启授权并继续初读。
 */
export const OnboardingProgress: React.FC<OnboardingProgressProps> = ({
  run,
  onAdvanceStage,
  onEnableModelAuth,
}) => {
  if (!run || run.stage === "completed") {
    return null;
  }

  const steps = [
    { key: "reading", label: "1. 扫描目录与只读清单" },
    { key: "analyzing", label: "2. 选择性读取关键文件" },
    { key: "message_ready", label: "3. 本地发现卡已保存，模型开场仍在等待" },
  ];

  const currentStepIdx =
    run.stage === "reading" || run.stage === "boundary_review"
      ? 0
      : run.stage === "analyzing"
      ? 1
      : 2;

  return (
    <section
      aria-label="正在认识项目进度"
      data-testid="onboarding-progress"
      className="mb-6 rounded-[var(--corner-md)] border border-[#e88e47]/40 bg-[var(--surface-elevated)] backdrop-blur-md p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
          {run.stage === "waiting_for_model_auth" ? (
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          ) : run.stage === "failed" ? (
            <AlertTriangle className="w-4 h-4 text-[#b74a46] shrink-0" />
          ) : (
            <Loader2 className="w-4 h-4 text-[#e88e47] animate-spin shrink-0" />
          )}
          <span>正在认识项目 · {run.id.startsWith("checkpoint:") ? "Core checkpoint" : "后端任务"} {run.id}</span>
        </div>

        {typeof run.scanReadCount === "number" && (
          <span className="font-mono tabular-nums text-xs text-[var(--text-muted)]">
            已读取只读节点 {run.scanReadCount} / {run.scanTotalEstimate ?? "—"}
          </span>
        )}
      </div>

      {/* 真实阶段说明文案 */}
      <p className="text-xs text-[var(--text-primary)] leading-relaxed">{run.progressText}</p>

      {/* 阶段步骤条 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
        {steps.map((s, idx) => {
          const isDone = idx < currentStepIdx;
          const isCurrent = idx === currentStepIdx;
          return (
            <div
              key={s.key}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border ${
                isCurrent
                  ? "border-[#e88e47] bg-[#e88e47]/10 text-[var(--text-primary)] font-medium"
                  : isDone
                  ? "border-[var(--border-subtle)] bg-black/[0.02] dark:bg-white/[0.02] text-[#3d8068]"
                  : "border-[var(--border-subtle)] text-[var(--text-muted)] opacity-70"
              }`}
            >
              {isDone && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
              <span>{s.label}</span>
            </div>
          );
        })}
      </div>

      {/* 操作入口 */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)] text-xs">
        <span className="text-[11px] text-[var(--text-muted)]">
          状态由 Rust Core 持久化维护，关闭或重开窗口将从当前阶段幂等恢复。
        </span>
        <div className="flex items-center gap-2">
          {run.stage === "waiting_for_model_auth" && onEnableModelAuth && (
            <button
              type="button"
              onClick={onEnableModelAuth}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#c27537] text-white hover:bg-[#b0672c] transition-colors"
            >
              <span>启用 StepFun 模型初读并生成首次开场</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {(run.stage === "reading" || run.stage === "analyzing") && onAdvanceStage && (
            <button
              type="button"
              onClick={() => onAdvanceStage(run.id)}
              data-testid="advance-onboarding-button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#c27537] text-white hover:bg-[#b0672c] transition-colors"
            >
              <span>推进初读阶段（预览首条主动开场）</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
