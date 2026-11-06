import React from "react";
import { NarrativeState } from "../../bridge/HarkBridge";
import { describeFlameVisual } from "../../bridge/schemas";

interface FlameAtmosphereProps {
  narrative?: NarrativeState | null;
  isComposerFocused: boolean;
  isStreaming: boolean;
  transientSpreadKey: number;
  pauseMotion: boolean;
  isWindowHidden: boolean;
  observerState?: "active" | "paused" | "unauthorized" | "unavailable";
}

/**
 * FE-07 · FlameAtmosphere
 * PRD §2.2, §2.3, §6.3:
 * - 火在磨砂玻璃之后，退居背景，不压住文字，不变成固定吉祥物。
 * - 基础阶段完全由后端 NarrativeState 决定；未知阶段优雅回退至 neutral。
 * - 输入聚焦收拢、请求等待轻呼吸、确认保存短暂扩散。
 * - 主窗口隐藏或开启暂停动效时停止持续渲染。
 */
export const FlameAtmosphere: React.FC<FlameAtmosphereProps> = ({
  narrative,
  isComposerFocused,
  isStreaming,
  transientSpreadKey,
  pauseMotion,
  isWindowHidden,
}) => {
  const descriptor = describeFlameVisual(narrative);
  const shouldAnimate = !pauseMotion && !isWindowHidden;

  // 输入聚焦时火影向中心底座收拢（PRD §2.2 暂时响应）
  const focusScale = isComposerFocused ? descriptor.haloScale * 0.92 : descriptor.haloScale;

  return (
    <div
      aria-hidden="true"
      data-testid="flame-atmosphere"
      data-flame-stage={descriptor.stage}
      data-motion-active={shouldAnimate ? "true" : "false"}
      className="pointer-events-none fixed inset-0 overflow-hidden z-0 select-none"
    >
      {/* 顶层极淡天光环境晕染 */}
      <div
        style={{
          opacity: isWindowHidden ? 0.08 : descriptor.coreOpacity * 0.45,
          transition: shouldAnimate ? "opacity 600ms ease" : "none",
        }}
        className="absolute left-1/2 top-[-18%] -translate-x-1/2 w-[960px] h-[360px] rounded-full blur-[110px] bg-gradient-to-b from-[#f1bb7c]/25 via-[#e88e47]/10 to-transparent"
      />

      {/* 第一层：远景主火场（位于磨砂玻璃之后） */}
      <div
        key={transientSpreadKey}
        style={{
          opacity: isWindowHidden ? 0.14 : descriptor.coreOpacity,
          transform: `translate3d(-50%, ${isComposerFocused ? "18px" : "0px"}, 0) scale(${focusScale})`,
          transition: shouldAnimate
            ? "transform 520ms cubic-bezier(0.16, 1, 0.3, 1), opacity 520ms ease"
            : "none",
        }}
        className={`absolute left-1/2 bottom-[-16%] w-[820px] h-[520px] rounded-full blur-[90px] bg-radial ${descriptor.warmthClass} ${
          shouldAnimate && (isStreaming || descriptor.stage !== "neutral") ? "ember-breathing" : ""
        } ${shouldAnimate && transientSpreadKey > 0 ? "ember-transient-spread" : ""}`}
      />

      {/* 第二层：次级跃动暖光层，营造有机火影层次感 */}
      <div
        style={{
          opacity: isWindowHidden ? 0.1 : Math.min(0.88, descriptor.coreOpacity * 0.95),
          transform: `translate3d(-50%, ${isComposerFocused ? "10px" : "0px"}, 0) scale(${
            isStreaming ? 1.06 : 1
          })`,
          transition: shouldAnimate
            ? "transform 480ms cubic-bezier(0.16, 1, 0.3, 1), opacity 480ms ease"
            : "none",
        }}
        className={`absolute left-1/2 bottom-[-4%] w-[520px] h-[280px] rounded-full blur-[64px] bg-gradient-to-t from-[#e88e47]/40 via-[#f1bb7c]/22 to-transparent ${
          shouldAnimate && descriptor.stage !== "neutral" ? "ember-breathing-secondary" : ""
        }`}
      />

      {/* 第三层：底部炉心琥珀色聚光核（随 Composer 聚焦微收拢） */}
      <div
        style={{
          opacity: isWindowHidden
            ? 0.08
            : isComposerFocused
            ? Math.min(0.92, descriptor.coreOpacity * 1.25)
            : Math.min(0.75, descriptor.coreOpacity * 1.05),
          transform: isComposerFocused
            ? "translate3d(-50%, 6px, 0) scale(0.86)"
            : "translate3d(-50%, 0, 0) scale(1)",
          transition: shouldAnimate ? "transform 360ms cubic-bezier(0.16, 1, 0.3, 1), opacity 360ms ease" : "none",
        }}
        className="absolute left-1/2 bottom-[2%] w-[360px] h-[140px] rounded-full blur-[44px] bg-gradient-to-t from-[#e88e47]/45 via-[#f1bb7c]/20 to-transparent"
      />

      {/* 磨砂玻璃漫射遮罩层，确保前方正文对比度 >= 4.5:1 且温润通透 */}
      <div className="absolute inset-0 backdrop-blur-[48px] bg-[var(--canvas)]/62" />

      {/* 极细腻的纸张/胶片微噪点纹理感与边缘柔和暗角 */}
      <div
        className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(232, 142, 71, 0.4) 0.75px, transparent 0.75px)",
          backgroundSize: "24px 24px",
        }}
      />
    </div>
  );
};
