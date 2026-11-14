import React, { useEffect, useRef, useState } from "react";
import { NarrativeState } from "../../bridge/HarkBridge";
import { describeFlameVisual } from "../../bridge/schemas";
import {
  createFlameRenderer,
  FlameFrame,
  FlameRenderer,
  R1_FLAME_STAGE_SHAPES,
} from "./flameRenderer";

interface FlameAtmosphereProps {
  narrative?: NarrativeState | null;
  isComposerFocused: boolean;
  isStreaming: boolean;
  transientSpreadKey: number;
  pauseMotion: boolean;
  isWindowHidden: boolean;
  observerState?: "active" | "paused" | "unauthorized" | "unavailable";
}

interface CinderSpec {
  id: number;
  leftPercent: number;
  bottomPercent: number;
  sizePx: number;
  durationSec: number;
  delaySec: number;
  driftPx: number;
  gold: boolean;
}

const RISING_CINDERS: readonly CinderSpec[] = [
  { id: 1, leftPercent: 44, bottomPercent: 18, sizePx: 4, durationSec: 4.4, delaySec: -0.6, driftPx: -18, gold: false },
  { id: 2, leftPercent: 52, bottomPercent: 16, sizePx: 5, durationSec: 3.9, delaySec: -1.9, driftPx: 22, gold: true },
  { id: 3, leftPercent: 48, bottomPercent: 20, sizePx: 3.5, durationSec: 4.8, delaySec: -2.8, driftPx: -12, gold: true },
  { id: 4, leftPercent: 56, bottomPercent: 15, sizePx: 4, durationSec: 4.2, delaySec: -0.3, driftPx: 16, gold: false },
  { id: 5, leftPercent: 41, bottomPercent: 14, sizePx: 3, durationSec: 5.1, delaySec: -3.2, driftPx: -24, gold: false },
  { id: 6, leftPercent: 50, bottomPercent: 22, sizePx: 4.5, durationSec: 3.6, delaySec: -1.2, driftPx: 10, gold: true },
  { id: 7, leftPercent: 46, bottomPercent: 19, sizePx: 3, durationSec: 4.6, delaySec: -2.4, driftPx: 20, gold: false },
  { id: 8, leftPercent: 54, bottomPercent: 17, sizePx: 3.5, durationSec: 5.3, delaySec: -4.1, driftPx: -15, gold: true },
  { id: 9, leftPercent: 43, bottomPercent: 21, sizePx: 3, durationSec: 4.1, delaySec: -1.5, driftPx: 14, gold: false },
  { id: 10, leftPercent: 57, bottomPercent: 18, sizePx: 3.5, durationSec: 4.9, delaySec: -3.7, driftPx: -20, gold: true },
  { id: 11, leftPercent: 49, bottomPercent: 15, sizePx: 5, durationSec: 3.7, delaySec: -0.9, driftPx: -8, gold: false },
  { id: 12, leftPercent: 51, bottomPercent: 23, sizePx: 3, durationSec: 4.5, delaySec: -2.9, driftPx: 18, gold: true },
];

/**
 * FE-07 · FlameAtmosphere
 * PRD §2.2, §2.3, §6.3:
 * - 火在薄雾玻璃之后，灵动呼吸却不压住阅读对比度。
 * - 基础阶段完全由后端 NarrativeState 决定；未知阶段优雅回退至 neutral。
 * - 输入聚焦收拢提亮、流式生成上扬舒展、确认保存短暂火星扩散。
 * - 主窗口隐藏、系统减弱动效或暂停动效时停止持续渲染。
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
  const stageShape = R1_FLAME_STAGE_SHAPES[descriptor.stage];

  const [reducedMotion, setReducedMotion] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false
  );
  const [webglReady, setWebglReady] = useState(false);

  const shouldAnimate = !pauseMotion && !isWindowHidden && !reducedMotion;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<FlameRenderer | null>(null);
  const lastSpreadKeyRef = useRef(transientSpreadKey);

  const frameRef = useRef<FlameFrame>({
    time: 3.1,
    heat: stageShape.heat,
    size: 1,
    focus: isComposerFocused ? 0.16 : 0,
    pulse: 0,
    waiting: isStreaming ? 0.22 : 0,
    day: isDark ? 0 : 1,
    golden: stageShape.golden,
    dormant: stageShape.dormant,
    surge: 0,
  });

  const targetRef = useRef({
    stageShape,
    isComposerFocused,
    isStreaming,
    isDark,
    shouldAnimate,
  });
  targetRef.current = {
    stageShape,
    isComposerFocused,
    isStreaming,
    isDark,
    shouldAnimate,
  };

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    const root = document.documentElement;
    const syncTheme = () => setIsDark(root.classList.contains("dark"));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Initialize WebGL renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createFlameRenderer(canvas, () => {
      rendererRef.current?.draw(frameRef.current, targetRef.current.stageShape);
    });
    rendererRef.current = renderer;
    setWebglReady(Boolean(renderer));
    if (!renderer) return;

    const handleResize = () => {
      renderer.resize();
      renderer.draw(frameRef.current, targetRef.current.stageShape);
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      rendererRef.current = null;
      setWebglReady(false);
    };
  }, []);

  // Trigger burst sparks and surge on verified saves / completions
  useEffect(() => {
    if (transientSpreadKey > lastSpreadKeyRef.current) {
      lastSpreadKeyRef.current = transientSpreadKey;
      frameRef.current.surge = 0.65;
      frameRef.current.pulse = 0.3;
      if (shouldAnimate) {
        rendererRef.current?.triggerSparks(28);
      }
      rendererRef.current?.draw(frameRef.current, targetRef.current.stageShape);
    }
  }, [transientSpreadKey, shouldAnimate]);

  // Animation loop (strictly paused when hidden, pauseMotion, or reducedMotion)
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Synchronize static frame immediately when state updates
    frameRef.current.day = isDark ? 0 : 1;
    frameRef.current.heat = stageShape.heat;
    frameRef.current.golden = stageShape.golden;
    frameRef.current.dormant = stageShape.dormant;
    frameRef.current.focus = isComposerFocused ? 0.16 : 0;
    frameRef.current.waiting = isStreaming ? 0.24 : 0;
    renderer.draw(frameRef.current, stageShape);

    if (!shouldAnimate) return;

    let rafId = 0;
    let prevTs = performance.now();
    let lastDrawTs = 0;

    const tick = (now: number) => {
      const target = targetRef.current;
      const dt = Math.min(0.06, Math.max(0.001, (now - prevTs) / 1000));
      prevTs = now;

      const frame = frameRef.current;
      const shape = target.stageShape;
      const lerp = Math.min(1, dt * 4.2);

      frame.heat += (shape.heat - frame.heat) * lerp;
      frame.golden += (shape.golden - frame.golden) * lerp;
      frame.dormant += (shape.dormant - frame.dormant) * lerp;
      frame.day += ((target.isDark ? 0 : 1) - frame.day) * lerp;
      frame.focus += ((target.isComposerFocused ? 0.18 : 0) - frame.focus) * lerp;
      frame.waiting += ((target.isStreaming ? 0.26 : 0) - frame.waiting) * lerp;
      frame.surge = Math.max(0, frame.surge - dt * 0.72);
      frame.pulse = Math.max(0, frame.pulse - dt * 0.9);

      const speedBoost = target.isStreaming ? 1.48 : target.isComposerFocused ? 1.15 : 1.0;
      frame.time += dt * shape.rate * speedBoost;

      if (now - lastDrawTs >= 28) {
        lastDrawTs = now;
        renderer.draw(frame, shape);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [shouldAnimate, isDark, isComposerFocused, isStreaming, stageShape]);

  const activeOpacity = isWindowHidden
    ? 0.14
    : isStreaming
    ? Math.min(1, descriptor.coreOpacity * 1.15)
    : descriptor.coreOpacity;

  const focusScale = isStreaming
    ? descriptor.haloScale * 1.1
    : isComposerFocused
    ? descriptor.haloScale * 0.96
    : descriptor.haloScale;

  const cinderCount =
    descriptor.stage === "milestone"
      ? 12
      : descriptor.stage === "bright"
      ? 10
      : descriptor.stage === "gentle"
      ? 8
      : descriptor.stage === "ember"
      ? 5
      : 3;

  const isMilestone = descriptor.stage === "milestone";

  return (
    <div
      aria-hidden="true"
      data-testid="flame-atmosphere"
      data-flame-stage={descriptor.stage}
      data-motion-active={shouldAnimate ? "true" : "false"}
      data-renderer={webglReady ? "webgl" : "svg"}
      className={`pointer-events-none fixed inset-0 overflow-hidden z-0 select-none ${
        shouldAnimate ? "" : "pause-motion"
      }`}
    >
      {/* 顶部极轻暖光呼应 */}
      <div
        style={{
          opacity: isWindowHidden ? 0.06 : activeOpacity * 0.38,
          transition: shouldAnimate ? "opacity 600ms ease" : "none",
        }}
        className="absolute left-1/2 top-[-16%] -translate-x-1/2 w-[820px] h-[280px] rounded-full blur-[90px] bg-gradient-to-b from-[#f1bb7c]/32 via-[#e88e47]/14 to-transparent"
      />

      {/* Layer A · WebGL FBM 活火纹理与物理火星粒子层 */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full pointer-events-none"
        style={{
          opacity: isWindowHidden ? 0.15 : webglReady ? Math.min(0.96, activeOpacity * 1.05) : 0,
          transition: shouldAnimate ? "opacity 500ms ease" : "none",
        }}
      />

      {/* Layer B · 雕塑感多层有机火舌与炉床辉光（在 WebGL 叠加或降级时皆清晰可见） */}
      <div
        key={transientSpreadKey}
        style={{
          opacity: isWindowHidden ? 0.14 : webglReady ? activeOpacity * 0.72 : activeOpacity * 0.96,
          transform: `translate3d(-50%, ${isComposerFocused ? "8px" : "0px"}, 0) scale(${focusScale})`,
          transition: shouldAnimate
            ? "transform 480ms cubic-bezier(0.22, 1, 0.36, 1), opacity 480ms ease"
            : "none",
        }}
        className={`absolute left-1/2 bottom-[2%] w-[460px] h-[440px] sm:w-[540px] sm:h-[500px] ${
          shouldAnimate && transientSpreadKey > 0 ? "ember-transient-spread" : ""
        }`}
      >
        {/* 炉床炭火暖底晕 */}
        <div
          className={`absolute left-1/2 bottom-[2%] -translate-x-1/2 w-[360px] h-[150px] rounded-full blur-[34px] bg-radial ${descriptor.warmthClass}`}
        />

        {/* 多层不对称有机火舌 SVG */}
        <svg
          viewBox="0 0 360 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="absolute inset-0 w-full h-full overflow-visible"
        >
          <defs>
            <linearGradient id="hearthOuterFlameGrad" x1="180" y1="380" x2="180" y2="34" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#b83b14" stopOpacity="0.92" />
              <stop offset="48%" stopColor={isMilestone ? "#df7a1f" : "#dc581b"} stopOpacity="0.86" />
              <stop offset="85%" stopColor="#f59e0b" stopOpacity="0.52" />
              <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="hearthWingFlameGrad" x1="180" y1="372" x2="180" y2="90" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#c94416" stopOpacity="0.82" />
              <stop offset="60%" stopColor="#ea7b28" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="hearthInnerCoreGrad" x1="180" y1="366" x2="180" y2="145" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor={isMilestone ? "#fde68a" : "#fbbf24"} stopOpacity="0.96" />
              <stop offset="55%" stopColor="#fcd34d" stopOpacity="0.84" />
              <stop offset="100%" stopColor="#fff7ed" stopOpacity="0.08" />
            </linearGradient>
            <radialGradient id="hearthCoalBedGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.72" />
              <stop offset="52%" stopColor="#c2410c" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#9a3412" stopOpacity="0" />
            </radialGradient>
            <filter id="hearthFlameSoftGlow" x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur stdDeviation="5.5" />
            </filter>
          </defs>

          {/* 炭火底座 */}
          <ellipse cx="180" cy="366" rx="116" ry="26" fill="url(#hearthCoalBedGrad)" />

          {/* 左侧副火舌：错相摇曳 */}
          <path
            d="M178 368 C122 356 96 300 112 240 C123 198 106 164 128 122 C134 156 154 176 160 218 C170 264 190 318 178 368 Z"
            fill="url(#hearthWingFlameGrad)"
            filter="url(#hearthFlameSoftGlow)"
            className={shouldAnimate ? "ember-tongue-left" : ""}
            style={{
              transformOrigin: "152px 362px",
              animationDuration: isStreaming ? "2.1s" : "3.6s",
            }}
          />

          {/* 右侧副火舌：独立节拍 */}
          <path
            d="M182 368 C236 358 264 302 246 238 C236 202 252 162 230 128 C222 162 204 184 198 226 C188 272 170 322 182 368 Z"
            fill="url(#hearthWingFlameGrad)"
            filter="url(#hearthFlameSoftGlow)"
            className={shouldAnimate ? "ember-tongue-right" : ""}
            style={{
              transformOrigin: "208px 362px",
              animationDuration: isStreaming ? "2.4s" : "4.2s",
            }}
          />

          {/* 主外焰火舌 */}
          <path
            d="M180 374 C118 368 96 302 118 232 C132 188 164 150 156 88 C172 52 194 40 198 28 C194 68 220 96 226 146 C234 202 258 242 238 308 C225 352 206 372 180 374 Z"
            fill="url(#hearthOuterFlameGrad)"
            filter="url(#hearthFlameSoftGlow)"
            className={shouldAnimate ? "ember-tongue-main" : ""}
            style={{
              transformOrigin: "180px 368px",
              animationDuration: isStreaming ? "1.9s" : "3.1s",
            }}
          />

          {/* 亮金内焰心 */}
          <path
            d="M180 368 C144 362 134 316 150 264 C160 230 176 202 178 158 C190 184 208 214 210 258 C214 310 206 364 180 368 Z"
            fill="url(#hearthInnerCoreGrad)"
            filter="url(#hearthFlameSoftGlow)"
            className={shouldAnimate ? "ember-core-flicker" : ""}
            style={{
              transformOrigin: "180px 364px",
              animationDuration: isStreaming ? "1.35s" : "2.25s",
            }}
          />
        </svg>

        {/* 上浮火星粒子层 */}
        <div className="absolute inset-0 overflow-visible">
          {RISING_CINDERS.slice(0, cinderCount).map((cinder) => (
            <span
              key={cinder.id}
              className={shouldAnimate ? "ember-spark-float" : ""}
              style={
                {
                  position: "absolute",
                  left: `${cinder.leftPercent}%`,
                  bottom: `${cinder.bottomPercent}%`,
                  width: `${cinder.sizePx}px`,
                  height: `${cinder.sizePx}px`,
                  borderRadius: "9999px",
                  backgroundColor: cinder.gold || isMilestone ? "#fbbf24" : "#f97316",
                  boxShadow:
                    cinder.gold || isMilestone
                      ? "0 0 10px 2px rgba(251, 191, 36, 0.72)"
                      : "0 0 9px 2px rgba(234, 88, 12, 0.68)",
                  animationDuration: `${
                    isStreaming ? cinder.durationSec * 0.62 : cinder.durationSec
                  }s`,
                  animationDelay: `${cinder.delaySec}s`,
                  ["--spark-drift" as string]: `${cinder.driftPx}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      </div>

      {/* Layer C · 轻薄光学玻璃漫射层（大幅减薄遮罩，透出火舌轮廓与火星微光） */}
      <div
        className="absolute inset-0 backdrop-blur-[6px] bg-[var(--canvas)]/12 dark:bg-[var(--canvas)]/20 transition-colors duration-700"
      />

      {/* 极细腻的纸面暖光肌理 */}
      <div
        className="absolute inset-0 opacity-[0.022] dark:opacity-[0.035]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(232, 142, 71, 0.4) 0.75px, transparent 0.75px)",
          backgroundSize: "24px 24px",
        }}
      />
    </div>
  );
};
