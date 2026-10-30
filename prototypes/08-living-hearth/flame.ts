import { createFlameRenderer, type FlameRenderer } from './flame-renderer.js';
import { FLAME_SHAPES } from './flame-shape.js';

type Cue = 'typing' | 'sent' | 'project';
type Theme = 'light' | 'dark';

/** Visual-only local animation. No application or project state is inferred. */
export function createLivingFlame(canvas: HTMLCanvasElement) {
  const root = canvas.parentElement;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false;
  let paused = false;
  let lost = false;
  let failed = false;
  let focus = false;
  let theme: Theme = 'dark';
  let frames = 0;
  let time = 0;
  let pulse = 0;
  let cueKind: Cue | null = null;
  let cueStart = 0;
  let lastTyping = -Infinity;
  let raf = 0;
  let previous = 0;
  let renderer: FlameRenderer | null = null;
  const fallback = document.createElement('img');
  fallback.className = 'flame-fallback';
  fallback.alt = '';
  fallback.setAttribute('aria-hidden', 'true');
  fallback.src = new URL('./assets/living-fire.png', import.meta.url).href;
  fallback.hidden = true;
  // Keep a visible, bounded fallback even if the host page has no fallback CSS.
  fallback.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:100px;height:150px;object-fit:contain;pointer-events:none';
  canvas.insertAdjacentElement('afterend', fallback);
  const mode = () => disposed ? 'disposed' : lost ? 'context-lost' : failed ? 'fallback' : document.hidden ? 'hidden' : paused ? 'paused' : media.matches ? 'reduced-motion' : 'running';
  const canRun = () => mode() === 'running';
  const syncData = () => {
    if (!root) return;
    root.dataset.motion = mode();
    root.dataset.frames = String(frames);
    root.dataset.time = time.toFixed(3);
  };
  const showFallback = () => {
    fallback.hidden = false;
    canvas.style.visibility = 'hidden';
  };
  const draw = () => {
    if (disposed) return;
    if (renderer && !lost && !failed) {
      const elapsed = time - cueStart;
      const duration = cueKind === 'typing' ? 0.28 : 0.48;
      if (cueKind && elapsed >= duration) cueKind = null;
      pulse = cueKind ? Math.sin(Math.PI * Math.max(0, elapsed) / duration) * (cueKind === 'sent' ? 0.32 : cueKind === 'project' ? -0.17 : 0.09) : 0;
      renderer.draw({ time, heat: 0.5 + (focus ? 0.025 : 0), size: 0.9 + pulse * 0.10,
        focus: focus ? 0.14 : 0, pulse: Math.max(0, pulse), waiting: 0, day: theme === 'light' ? 1 : 0 },
        { ...FLAME_SHAPES.blaze, width: 1 + Math.min(0, pulse) * 0.40 });
    }
    syncData();
  };
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    previous = 0;
  };
  const tick = (now: number) => {
    raf = 0;
    if (!canRun()) { previous = 0; syncData(); return; }
    if (!previous) previous = now;
    const delta = now - previous;
    if (delta >= 1000 / 30) {
      time += Math.min(delta, 100) / 1000;
      previous = now;
      frames++;
      draw();
    }
    raf = requestAnimationFrame(tick);
  };
  const reconcile = () => {
    if (disposed) return;
    if (canRun()) {
      if (!raf) { previous = 0; raf = requestAnimationFrame(tick); }
    } else {
      stop();
      cueKind = null;
      pulse = 0;
    }
    draw();
  };
  const resize = () => {
    if (disposed) return;
    renderer?.resize();
    draw();
  };
  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    stop();
    showFallback();
    syncData();
  };
  // A restored context stays on the static image: a deterministic, no-retry recovery.
  const onRestored = () => {
    if (disposed) return;
    renderer?.dispose();
    renderer = null;
    lost = false;
    failed = true;
    showFallback();
    reconcile();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  try {
    renderer = createFlameRenderer(canvas, () => queueMicrotask(() => { if (!disposed) draw(); }));
  } catch { renderer = null; }
  if (!renderer) { failed = true; showFallback(); }
  document.addEventListener('visibilitychange', reconcile);
  media.addEventListener('change', reconcile);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  observer?.observe(canvas);
  if (!observer) window.addEventListener('resize', resize);
  resize();
  reconcile();
  return {
    setFocus(value: boolean) { if (disposed) return; focus = value; draw(); },
    cue(kind: Cue) {
      if (!canRun()) return;
      if (kind === 'typing') {
        if (time - lastTyping < 0.4) return;
        lastTyping = time;
      }
      cueKind = kind;
      cueStart = time;
      draw();
    },
    setPaused(value: boolean) { if (disposed) return; paused = value; reconcile(); },
    setTheme(value: Theme) { if (disposed) return; theme = value; draw(); },
    snapshot() {
      return { mode: mode(), frames, time, focus, pulse, textureReady: renderer?.textureReady() ?? false };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', reconcile);
      media.removeEventListener('change', reconcile);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      renderer?.dispose();
      renderer = null;
      fallback.remove();
      syncData();
    },
  };
}
