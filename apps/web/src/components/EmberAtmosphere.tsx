import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { EMBER_CUE_EVENT, emitEmberCue, isEmberMotionPaused, readEmberCue } from '../features/ember-cues';
import { createFlameRenderer } from '../features/flameRenderer';
import type { ProjectFlameStage } from '../features/projectEmber';
import flameTextureUrl from '../assets/living-fire.png';
import type { HearthPeriod } from '../features/hearthPeriod';
import {
  createFlameMotionController,
  useHearthTimeline,
  HEARTH_EASE,
  STAGE_TRANSITION_DURATION,
  type FlameMotionController,
} from '../motion';
import './EmberAtmosphere.css';

export interface EmberAtmosphereProps {
  band?: 'cool' | 'warm' | 'hot';
  paused?: boolean;
  heat?: number;
  golden?: number;
  dormant?: number;
  stage?: ProjectFlameStage;
  period?: HearthPeriod;
  size?: number;
}

function isWritingSurface(target: globalThis.EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && (target instanceof HTMLTextAreaElement
    || (target instanceof HTMLInputElement && ['text', 'search', 'email', 'url', 'tel', ''].includes(target.type))
    || target.isContentEditable);
}

/** One living light source; only confirmed conversation changes its base heat. */
export function EmberAtmosphere({
  band = 'cool',
  heat = 0.12,
  golden = 0,
  dormant = 0,
  stage = 'spark',
  paused = false,
  period = 'day',
  size = 1,
}: EmberAtmosphereProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<globalThis.HTMLCanvasElement>(null);
  const controllerRef = useRef<FlameMotionController | null>(null);
  const rendererRef = useRef<ReturnType<typeof createFlameRenderer>>(null);
  const timelines = useRef<gsap.core.Animation[]>([]);
  const drawRef = useRef<(force?: boolean) => void>(() => {});
  const [preferencePaused, setPreferencePaused] = useState(isEmberMotionPaused);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const still = paused || preferencePaused || hidden || reduced;
  const stillRef = useRef(still);
  stillRef.current = still;

  if (!controllerRef.current) {
    controllerRef.current = createFlameMotionController({
      time: 3.1,
      heat: Number.isFinite(heat) ? Math.max(0, Math.min(1, heat)) : 0.12,
      size: Number.isFinite(size) ? Math.max(0.65, Math.min(1.4, size)) : 1,
      day: period === 'day' ? 1 : 0,
      golden: Number.isFinite(golden) ? Math.max(0, Math.min(1, golden)) : 0,
      dormant: Number.isFinite(dormant) ? Math.max(0, Math.min(1, dormant)) : 0,
      surge: 0,
      pulse: 0,
      waiting: 0,
      focus: 0,
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    const preference = (event: Event) => {
      const cue = readEmberCue(event);
      if (cue?.kind === 'motion-preference' && cue.paused !== undefined) setPreferencePaused(cue.paused);
    };
    media.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener(EMBER_CUE_EVENT, preference);
    return () => {
      media.removeEventListener('change', motion);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener(EMBER_CUE_EVENT, preference);
    };
  }, []);

  // Capture only intent; values, identities and project data never reach the flame.
  useEffect(() => {
    let lastTyping = -Infinity;
    const focus = (event: globalThis.FocusEvent) => { if (isWritingSurface(event.target)) emitEmberCue('focus'); };
    const release = (event: globalThis.FocusEvent) => {
      if (isWritingSurface(event.target) && !isWritingSurface(event.relatedTarget)) emitEmberCue('release');
    };
    const typing = (event: Event) => {
      const now = window.performance.now();
      if (!isWritingSurface(event.target) || now - lastTyping < 400) return;
      lastTyping = now;
      emitEmberCue('typing');
    };
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', release);
    document.addEventListener('input', typing);
    return () => {
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', release);
      document.removeEventListener('input', typing);
    };
  }, []);

  useHearthTimeline((_context, contextSafe) => {
    const node = root.current;
    const surface = canvas.current;
    if (!node || !surface) return;

    const textureReady = () => {
      node.dataset.texture = 'ready';
      drawRef.current(true);
    };

    let renderer = createFlameRenderer(surface, textureReady);
    rendererRef.current = renderer;
    let lastDraw = -Infinity;
    let renderedFrames = 0;

    const draw = (force = false) => {
      const now = window.performance.now();
      if (!force && now - lastDraw < 30) return;
      if (document.hidden) return;
      lastDraw = now;
      renderer?.draw(controller.frame);
      node.style.setProperty('--hearth-intensity', String(controller.frame.heat));
      node.dataset.frame = String(++renderedFrames);
      const responseVal = controller.frame.focus + controller.frame.pulse + controller.frame.waiting;
      node.dataset.response = responseVal.toFixed(3);
      node.dataset.waitingResponse = controller.frame.waiting.toFixed(3);
    };

    const resize = () => {
      renderer?.resize();
      draw(true);
    };
    drawRef.current = draw;
    node.dataset.renderer = renderer ? 'webgl' : 'fallback';
    resize();

    const clock = gsap.timeline({ paused: true }).to(controller.frame, {
      time: '+=86400',
      duration: 86400,
      repeat: -1,
      ease: 'none',
      onUpdate: () => draw(),
    });

    const fallback = gsap.timeline({ paused: true }).to('.ember-atmosphere__fallback-flame', {
      scaleX: 1.08,
      scaleY: 1.04,
      rotation: 2,
      duration: 1.8,
      stagger: 0.13,
      repeat: -1,
      yoyo: true,
      ease: HEARTH_EASE.gentle,
      transformOrigin: '50% 95%',
    });

    const focusTl = gsap.timeline({ paused: true }).to(controller.frame, {
      focus: 0.14,
      duration: 0.4,
      ease: 'sine.out',
      onUpdate: () => draw(true),
    });

    timelines.current = [clock, fallback, focusTl];
    let lastTyping = -Infinity;

    const rawCue = (event: Event) => {
      const detail = readEmberCue(event);
      if (!detail || detail.kind === 'motion-preference') return;
      const wasWaiting = node.dataset.phase === 'waiting';
      node.dataset.cue = detail.kind;

      if (detail.kind === 'waiting') node.dataset.phase = 'waiting';
      else if (detail.kind === 'chapter') node.dataset.phase = 'rest';
      else if (detail.kind === 'acknowledged') node.dataset.phase = 'acknowledged';
      else if (detail.kind === 'request-failed' || detail.kind === 'failed' || detail.kind === 'declined') node.dataset.phase = 'failed';
      else if (detail.kind === 'stoke') node.dataset.phase = 'stoke';
      else if (!wasWaiting) node.dataset.phase = detail.kind === 'release' ? 'rest' : detail.kind;

      if (detail.kind === 'acknowledged' || detail.kind === 'request-failed' || detail.kind === 'chapter' || detail.kind === 'failed' || detail.kind === 'declined') {
        controller.triggerWaiting(false);
      }

      if (stillRef.current || document.hidden) {
        if (detail.kind === 'focus') focusTl.progress(1);
        else if (detail.kind === 'release') focusTl.progress(0);
        return;
      }

      if (wasWaiting && !['waiting', 'acknowledged', 'request-failed', 'chapter', 'stoke', 'failed', 'declined'].includes(detail.kind)) return;

      if (detail.kind === 'focus') {
        focusTl.play();
      } else if (detail.kind === 'release') {
        focusTl.reverse();
      } else if (detail.kind === 'typing') {
        const now = window.performance.now();
        if (now - lastTyping < 400) return;
        lastTyping = now;
        controller.triggerPulse('gentle');
      } else if (detail.kind === 'waiting') {
        focusTl.pause(0);
        controller.triggerWaiting(true);
      } else if (detail.kind === 'stoke' || detail.kind === 'project-added') {
        controller.triggerStokeSurge(0.55);
        renderer?.triggerSparks(36);
      } else if (detail.kind === 'acknowledged' || detail.kind === 'chapter') {
        controller.triggerPulse('strong');
      } else if (detail.kind === 'declined' || detail.kind === 'failed' || detail.kind === 'request-failed') {
        focusTl.reverse();
      }
    };
    const cue = contextSafe ? (contextSafe(rawCue as (...args: unknown[]) => unknown) as (event: Event) => void) : rawCue;

    const lost = (event: Event) => {
      event.preventDefault();
      renderer?.dispose();
      renderer = null;
      rendererRef.current = null;
      node.dataset.renderer = 'fallback';
      node.dataset.texture = 'unavailable';
    };

    const restored = () => {
      node.dataset.texture = 'loading';
      renderer = createFlameRenderer(surface, textureReady);
      rendererRef.current = renderer;
      node.dataset.renderer = renderer ? 'webgl' : 'fallback';
      resize();
    };

    window.addEventListener(EMBER_CUE_EVENT, cue);
    window.addEventListener('resize', resize);
    surface.addEventListener('webglcontextlost', lost);
    surface.addEventListener('webglcontextrestored', restored);

    if (!stillRef.current) {
      clock.play();
      fallback.play();
    }

    return () => {
      window.removeEventListener(EMBER_CUE_EVENT, cue);
      window.removeEventListener('resize', resize);
      surface.removeEventListener('webglcontextlost', lost);
      surface.removeEventListener('webglcontextrestored', restored);
      renderer?.dispose();
      rendererRef.current = null;
      controller.dispose();
      controllerRef.current = null;
      drawRef.current = () => {};
      timelines.current = [];
    };
  }, { scope: root });

  useEffect(() => {
    const animations = timelines.current;
    if (still) {
      animations.forEach((animation) => {
        animation.data = { resume: !animation.paused() };
        animation.pause();
      });
      drawRef.current(true);
    } else {
      animations.forEach((animation, index) => {
        if (index < 2 || animation.data?.resume) {
          animation.paused(false);
        }
        animation.data = undefined;
      });
      drawRef.current(true);
    }
  }, [still]);

  useHearthTimeline(() => {
    if (!controllerRef.current) return;
    const targetHeat = Number.isFinite(heat) ? Math.max(0, Math.min(1, heat)) : 0.12;
    const targetSize = Number.isFinite(size) ? Math.max(0.65, Math.min(1.4, size)) : 1;
    const targetDay = period === 'day' ? 1 : 0;
    const targetGolden = Number.isFinite(golden) ? Math.max(0, Math.min(1, golden)) : 0;
    const targetDormant = Number.isFinite(dormant) ? Math.max(0, Math.min(1, dormant)) : 0;

    gsap.to(controllerRef.current.frame, {
      heat: targetHeat,
      size: targetSize,
      day: targetDay,
      golden: targetGolden,
      dormant: targetDormant,
      duration: still ? 0 : STAGE_TRANSITION_DURATION,
      ease: HEARTH_EASE.gentle,
      overwrite: 'auto',
      onUpdate: () => drawRef.current(true),
    });
  }, { scope: root, dependencies: [heat, size, period, golden, dormant, stage, still] });

  return (
    <div ref={root} className="ember-atmosphere" data-band={band} data-still={still}
      data-cue="rest" data-phase="rest" data-flame-stage={stage} data-period={period}
      data-heat={heat.toFixed(2)} data-golden={golden.toFixed(2)} data-dormant={dormant.toFixed(2)}
      data-size={size.toFixed(2)} data-renderer="pending" data-motion-engine="gsap" aria-hidden="true">
      <canvas ref={canvas} className="ember-atmosphere__canvas" />
      <div className="ember-atmosphere__fallback" style={{ transform: `scale(${size * (0.9 + heat * 0.25)})` }}>
        <img className="ember-atmosphere__fallback-flame" src={flameTextureUrl} alt="" />
      </div>
      <div className="ember-atmosphere__glass" />
    </div>
  );
}
