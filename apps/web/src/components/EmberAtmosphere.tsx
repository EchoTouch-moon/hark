import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { EMBER_CUE_EVENT, emitEmberCue, isEmberMotionPaused, readEmberCue } from '../features/ember-cues';
import { createFlameRenderer, type FlameFrame } from '../features/flameRenderer';
import flameTextureUrl from '../assets/living-fire.png';
import type { HearthPeriod } from '../features/hearthPeriod';
import './EmberAtmosphere.css';

gsap.registerPlugin(useGSAP);

export interface EmberAtmosphereProps {
  band?: 'cool' | 'warm' | 'hot';
  paused?: boolean;
  heat?: number;
  period?: HearthPeriod;
  size?: number;
}

function isWritingSurface(target: globalThis.EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && (target instanceof HTMLTextAreaElement
    || (target instanceof HTMLInputElement && ['text', 'search', 'email', 'url', 'tel', ''].includes(target.type))
    || target.isContentEditable);
}

/** One living light source; only confirmed conversation changes its base heat. */
export function EmberAtmosphere({ band = 'cool', heat = 0.12, paused = false, period = 'day', size = 1 }: EmberAtmosphereProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<globalThis.HTMLCanvasElement>(null);
  const frame = useRef<FlameFrame>({ time: 3.1, heat, size, attention: 0, pulse: 0, waiting: 0, day: period === 'day' ? 1 : 0 });
  const timelines = useRef<gsap.core.Animation[]>([]);
  const drawRef = useRef<(force?: boolean) => void>(() => {});
  const [preferencePaused, setPreferencePaused] = useState(isEmberMotionPaused);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const still = paused || preferencePaused || hidden || reduced;
  const stillRef = useRef(still);
  stillRef.current = still;

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

  useGSAP(() => {
    const node = root.current;
    const surface = canvas.current;
    if (!node || !surface) return;
    const textureReady = () => { node.dataset.texture = 'ready'; drawRef.current(true); };
    let renderer = createFlameRenderer(surface, textureReady);
    let lastDraw = -Infinity;
    let renderedFrames = 0;
    const draw = (force = false) => {
      const now = window.performance.now();
      if (!force && now - lastDraw < 30) return;
      if (document.hidden) return;
      lastDraw = now;
      renderer?.draw(frame.current);
      node.style.setProperty('--hearth-intensity', String(frame.current.heat));
      node.dataset.frame = String(++renderedFrames);
      node.dataset.response = (frame.current.attention + frame.current.pulse + frame.current.waiting).toFixed(3);
      node.dataset.waitingResponse = frame.current.waiting.toFixed(3);
    };
    const resize = () => { renderer?.resize(); draw(true); };
    drawRef.current = draw;
    node.dataset.renderer = renderer ? 'webgl' : 'fallback';
    resize();

    const clock = gsap.timeline({ paused: true })
      .to(frame.current, { time: '+=86400', duration: 86400, repeat: -1, ease: 'none', onUpdate: draw });
    const fallback = gsap.timeline({ paused: true })
      .to('.ember-atmosphere__fallback-flame', { scaleX: 1.08, scaleY: 1.04, rotation: 2, duration: 1.8,
        stagger: .13, repeat: -1, yoyo: true, ease: 'sine.inOut', transformOrigin: '50% 95%' });
    const focus = gsap.timeline({ paused: true })
      .to(frame.current, { attention: .14, duration: .4, ease: 'sine.out', onUpdate: () => draw(true) });
    const pulse = gsap.timeline({ paused: true });
    const triggerPulse = () => {
      pulse.clear();
      pulse.to(frame.current, { pulse: .26, duration: .32, ease: 'sine.out', onUpdate: () => draw(true) })
        .to(frame.current, { pulse: 0, duration: .8, ease: 'sine.inOut', onUpdate: () => draw(true) });
      pulse.restart();
    };
    const waiting = gsap.timeline({ paused: true })
      .to(frame.current, { waiting: .16, duration: 1.8, repeat: -1, yoyo: true, ease: 'sine.inOut', onUpdate: () => draw(true) });
    timelines.current = [clock, fallback, focus, pulse, waiting];
    let lastTyping = -Infinity;
    const cue = (event: Event) => {
      const detail = readEmberCue(event);
      if (!detail || detail.kind === 'motion-preference') return;
      const wasWaiting = node.dataset.phase === 'waiting';
      node.dataset.cue = detail.kind;
      if (detail.kind === 'waiting') node.dataset.phase = 'waiting';
      else if (detail.kind === 'chapter') node.dataset.phase = 'rest';
      else if (detail.kind === 'acknowledged') node.dataset.phase = 'acknowledged';
      else if (detail.kind === 'request-failed') node.dataset.phase = 'failed';
      else if (!wasWaiting) node.dataset.phase = detail.kind === 'release' ? 'rest' : detail.kind;
      if (detail.kind === 'acknowledged' || detail.kind === 'request-failed' || detail.kind === 'chapter') waiting.pause(0);
      if (stillRef.current || document.hidden) return;
      if (wasWaiting && !['waiting', 'acknowledged', 'request-failed', 'chapter'].includes(detail.kind)) return;
      if (detail.kind === 'focus') focus.play();
      else if (detail.kind === 'release') focus.reverse();
      else if (detail.kind === 'typing') {
        const now = window.performance.now();
        if (now - lastTyping < 400) return;
        lastTyping = now;
        triggerPulse();
      } else if (detail.kind === 'waiting') {
        focus.pause(0); pulse.pause(0); waiting.restart();
      } else if (detail.kind === 'acknowledged' || detail.kind === 'project-added' || detail.kind === 'chapter') {
        triggerPulse();
      } else if (detail.kind === 'declined' || detail.kind === 'failed' || detail.kind === 'request-failed') {
        pulse.pause(0); focus.reverse();
      }
    };
    const lost = (event: Event) => {
      event.preventDefault();
      renderer?.dispose(); renderer = null; node.dataset.renderer = 'fallback'; node.dataset.texture = 'unavailable';
    };
    const restored = () => {
      node.dataset.texture = 'loading';
      renderer = createFlameRenderer(surface, textureReady);
      node.dataset.renderer = renderer ? 'webgl' : 'fallback';
      resize();
    };
    window.addEventListener(EMBER_CUE_EVENT, cue);
    window.addEventListener('resize', resize);
    surface.addEventListener('webglcontextlost', lost);
    surface.addEventListener('webglcontextrestored', restored);
    if (!stillRef.current) { clock.play(); fallback.play(); }
    return () => {
      window.removeEventListener(EMBER_CUE_EVENT, cue);
      window.removeEventListener('resize', resize);
      surface.removeEventListener('webglcontextlost', lost);
      surface.removeEventListener('webglcontextrestored', restored);
      renderer?.dispose();
      drawRef.current = () => {};
      timelines.current = [];
    };
  }, { scope: root });

  useEffect(() => {
    const animations = timelines.current;
    if (still) {
      animations.forEach(animation => { animation.data = { resume: !animation.paused() }; animation.pause(); });
    } else {
      animations.forEach((animation, index) => {
        if (index === 4) {
          if (root.current?.dataset.phase === 'waiting') animation.paused(false);
          else animation.pause(0);
        } else if (index < 2 || animation.data?.resume) animation.paused(false);
        animation.data = undefined;
      });
      drawRef.current(true);
    }
  }, [still]);

  useGSAP(() => {
    gsap.to(frame.current, {
      heat: Number.isFinite(heat) ? Math.max(0, Math.min(1, heat)) : 0.12,
      size: Number.isFinite(size) ? Math.max(.65, Math.min(1.4, size)) : 1,
      day: period === 'day' ? 1 : 0,
      duration: still ? 0 : 1.1,
      ease: 'sine.inOut', overwrite: 'auto', onUpdate: () => drawRef.current(true),
    });
  }, { scope: root, dependencies: [heat, size, period, still] });

  return (
    <div ref={root} className="ember-atmosphere" data-band={band} data-still={still}
      data-cue="rest" data-phase="rest" data-period={period} data-heat={heat.toFixed(2)}
      data-size={size.toFixed(2)} data-renderer="pending" data-motion-engine="gsap" aria-hidden="true">
      <canvas ref={canvas} className="ember-atmosphere__canvas" />
      <div className="ember-atmosphere__fallback" style={{ transform: `scale(${size * (0.9 + heat * 0.25)})` }}>
        <img className="ember-atmosphere__fallback-flame" src={flameTextureUrl} alt="" />
      </div>
      <div className="ember-atmosphere__glass" />
    </div>
  );
}
