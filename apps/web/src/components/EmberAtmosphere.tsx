import { useEffect, useId, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { EMBER_CUE_EVENT, emitEmberCue, isEmberMotionPaused, readEmberCue } from '../features/ember-cues';
import type { HearthPeriod } from '../features/hearthPeriod';
import './EmberAtmosphere.css';

gsap.registerPlugin(useGSAP);

export interface EmberAtmosphereProps {
  band?: 'cool' | 'warm' | 'hot';
  paused?: boolean;
  heat?: number;
  period?: HearthPeriod;
}

// These broad, translucent currents are part of the page, not a flame icon.
// Matching command topology lets GSAP move each current as a continuous shape.
const currents = [
  ['M155 735 C90 605 145 505 254 417 C315 367 353 277 324 167 C414 240 423 326 399 408 C484 369 545 256 524 119 C656 264 615 416 550 492 C501 551 603 619 581 735 Z', 'M150 735 C102 600 156 500 270 407 C329 359 359 273 340 160 C427 238 436 328 409 405 C491 366 561 251 541 116 C664 265 625 414 560 487 C512 550 613 620 581 735 Z'],
  ['M283 741 C221 632 277 550 355 479 C408 431 426 357 405 285 C478 342 490 410 470 462 C530 436 567 379 566 313 C643 410 595 496 548 538 C504 579 544 660 535 741 Z', 'M288 741 C234 625 289 547 366 471 C419 422 438 353 418 279 C488 339 501 409 479 459 C539 432 579 375 578 306 C652 407 608 496 558 535 C514 577 549 659 535 741 Z'],
  ['M356 742 C308 655 340 589 402 529 C438 495 449 448 441 411 C487 450 496 491 485 535 C527 516 548 487 548 453 C595 515 571 570 541 599 C518 624 532 685 522 742 Z', 'M360 742 C319 651 351 586 413 522 C448 487 459 445 453 406 C497 447 507 489 496 531 C536 513 559 484 560 448 C604 514 583 570 552 596 C528 622 541 683 522 742 Z'],
];

function isWritingSurface(target: globalThis.EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && (target instanceof HTMLTextAreaElement
    || (target instanceof HTMLInputElement && ['text', 'search', 'email', 'url', 'tel', ''].includes(target.type))
    || target.isContentEditable);
}

/** A content-free room: temporary attention never changes the relationship band. */
export function EmberAtmosphere({ band = 'cool', heat = 0.12, paused = false, period = 'day' }: EmberAtmosphereProps) {
  const root = useRef<HTMLDivElement>(null);
  const unique = useId().replace(/:/g, '');
  const timelines = useRef<gsap.core.Animation[]>([]);
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

  // Keep semantic feedback even when visual motion is paused or reduced.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const markPhase = (event: Event) => {
      const cue = readEmberCue(event);
      if (!cue || cue.kind === 'motion-preference') return;
      if (cue.kind === 'waiting') node.dataset.phase = 'waiting';
      else if (cue.kind === 'chapter') node.dataset.phase = 'rest';
      else if (cue.kind === 'acknowledged') node.dataset.phase = cue.kind;
      else if (cue.kind === 'request-failed') node.dataset.phase = 'failed';
      else if (node.dataset.phase !== 'waiting') node.dataset.phase = cue.kind === 'release' ? 'rest' : cue.kind;
    };
    window.addEventListener(EMBER_CUE_EVENT, markPhase);
    return () => window.removeEventListener(EMBER_CUE_EVENT, markPhase);
  }, []);

  // Capture only input intent. Never inspect values, text, identity or project data.
  useEffect(() => {
    let lastTyping = -Infinity;
    const focus = (event: globalThis.FocusEvent) => {
      if (isWritingSurface(event.target)) emitEmberCue('focus');
    };
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
    if (!node || reduced) return;
    const select = gsap.utils.selector(node);
    const ambient = gsap.timeline({ paused: true });
    const pace = period === 'night' ? 1.4 : 1;
    // Local fire tongues and the room deliberately keep different phases.
    select('.ember-atmosphere__current').forEach((path, index) => {
      const contour = currents[index]?.[1];
      if (!contour) return;
      ambient.to(path, { attr: { d: contour }, duration: (2.2 + index * .23) * pace,
        repeat: -1, yoyo: true, ease: 'sine.inOut' }, index * .19);
    });
    ambient.to(select('.ember-atmosphere__breath'), { opacity: .84, scaleX: 1.055, scaleY: 1.06,
      duration: 3.6 * pace, repeat: -1, yoyo: true, ease: 'sine.inOut', transformOrigin: '50% 100%' }, 0);
    ambient.to(select('.ember-atmosphere__side--left'), { opacity: .8, yPercent: -3,
      duration: 3.1 * pace, repeat: -1, yoyo: true, ease: 'sine.inOut' }, .7);
    ambient.to(select('.ember-atmosphere__side--right'), { opacity: .9, yPercent: 3,
      duration: 3.8 * pace, repeat: -1, yoyo: true, ease: 'sine.inOut' }, 1.3);
    ambient.to(select('.ember-atmosphere__current'), { opacity: .76, duration: 2.7 * pace,
      repeat: -1, yoyo: true, ease: 'sine.inOut' }, .6);

    // Two broad, independently phased veils make the room itself feel alive.
    ambient.to(select('.ember-atmosphere__veil--left'), { opacity: .78, xPercent: 5, yPercent: -5,
      scale: 1.08, duration: 5.2 * pace, repeat: -1, yoyo: true, ease: 'sine.inOut' }, .4);
    ambient.to(select('.ember-atmosphere__veil--right'), { opacity: .7, xPercent: -4, yPercent: 4,
      scale: .94, duration: 6.1 * pace, repeat: -1, yoyo: true, ease: 'sine.inOut' }, 1.1);

    // Reused, bounded envelopes: events restart a response, never stack brightness.
    const focus = gsap.timeline({ paused: true }).to(select('.ember-atmosphere__attention'),
      { opacity: .65, scaleX: .82, duration: .3, ease: 'power2.out' });
    const typing = gsap.timeline({ paused: true })
      .to(select('.ember-atmosphere__reply'), { opacity: .38, scaleX: .9, duration: .2, ease: 'sine.out' })
      .to(select('.ember-atmosphere__reply'), { opacity: 0, scaleX: 1, duration: .45, ease: 'sine.inOut' });
    const answer = gsap.timeline({ paused: true })
      .to(select('.ember-atmosphere__reply'), { opacity: .72, scaleX: 1.06, duration: .34, ease: 'power2.out' })
      .to(select('.ember-atmosphere__reply'), { opacity: 0, scaleX: 1.13, duration: .7, ease: 'sine.inOut' });
    const waiting = gsap.timeline({ paused: true })
      .to(select('.ember-atmosphere__waiting'), { opacity: .68, scaleX: .92, scaleY: 1.06,
        duration: 1.8 * pace, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    const chapter = gsap.timeline({ paused: true })
      .to(select('.ember-atmosphere__chapter--left'), { opacity: .7, duration: .22, ease: 'sine.out' }, 0)
      .to(select('.ember-atmosphere__chapter--left'), { opacity: 0, duration: .42, ease: 'sine.inOut' }, .22)
      .to(select('.ember-atmosphere__chapter--right'), { opacity: .65, duration: .22, ease: 'sine.out' }, .14)
      .to(select('.ember-atmosphere__chapter--right'), { opacity: 0, duration: .32, ease: 'sine.inOut' }, .36);
    const all = [ambient, focus, typing, answer, chapter, waiting];
    timelines.current = all;
    let lastTyping = -Infinity;
    const cue = (event: Event) => {
      const detail = readEmberCue(event);
      if (!detail) return;
      node.dataset.cue = detail.kind;
      if (detail.kind === 'acknowledged' || detail.kind === 'request-failed' || detail.kind === 'chapter') waiting.pause(0);
      if (stillRef.current || document.hidden || detail.kind === 'motion-preference') return;
      if (node.dataset.phase === 'waiting' && !['waiting', 'acknowledged', 'request-failed', 'chapter'].includes(detail.kind)) return;
      if (detail.kind === 'focus') focus.play();
      else if (detail.kind === 'release') focus.reverse();
      else if (detail.kind === 'typing') {
        const now = window.performance.now();
        if (now - lastTyping < 400) return;
        lastTyping = now;
        answer.pause();
        typing.restart();
      } else if (detail.kind === 'waiting') {
        typing.pause(0); answer.pause(0); waiting.restart();
      } else if (detail.kind === 'acknowledged' || detail.kind === 'project-added') {
        typing.pause();
        answer.restart();
      } else if (detail.kind === 'chapter') chapter.restart();
      else if (detail.kind === 'declined' || detail.kind === 'failed' || detail.kind === 'request-failed') {
        typing.pause(0); answer.pause(0); chapter.pause(0); focus.reverse();
        // Both envelopes share the same zero-opacity rest pose.
        typing.progress(1).pause(); answer.progress(1).pause(); chapter.progress(1).pause();
      }
    };
    window.addEventListener(EMBER_CUE_EVENT, cue);
    if (!stillRef.current) { ambient.play(); if (node.dataset.phase === 'waiting') waiting.play(); }
    return () => {
      window.removeEventListener(EMBER_CUE_EVENT, cue);
      timelines.current = [];
    };
  }, { scope: root, dependencies: [reduced, period], revertOnUpdate: true });

  useEffect(() => {
    // Preserve each playhead and direction. Completed one-shot cues stay completed.
    const animations = timelines.current;
    if (still) {
      animations.forEach(animation => {
        animation.data = { resume: !animation.paused() };
        animation.pause();
      });
    } else {
      animations.forEach((animation, index) => {
        if (index === 5) {
          if (root.current?.dataset.phase === 'waiting') animation.paused(false);
          else animation.pause(0);
        } else if (index === 0 || animation.data?.resume) animation.paused(false);
        animation.data = undefined;
      });
    }
  }, [still, reduced, period]);

  // The continuously varying light is reconstructed from the active thread.
  // It remains a visual expression, never a project progress or success flag.
  useGSAP(() => {
    if (!root.current) return;
    gsap.to(root.current, {
      '--hearth-intensity': Number.isFinite(heat) ? Math.max(0, Math.min(1, heat)) : 0.12,
      duration: still ? 0 : 1.1,
      ease: 'sine.inOut',
      overwrite: true,
    });
  }, { scope: root, dependencies: [heat, still] });

  return (
    <div ref={root} className="ember-atmosphere" data-band={band} data-still={still}
      data-cue="rest" data-phase="rest" data-period={period} data-heat={heat.toFixed(2)} data-motion-engine="gsap" aria-hidden="true">
      <div className="ember-atmosphere__core" />
      <div className="ember-atmosphere__breath" />
      <div className="ember-atmosphere__veil ember-atmosphere__veil--left" />
      <div className="ember-atmosphere__veil ember-atmosphere__veil--right" />
      <div className="ember-atmosphere__side ember-atmosphere__side--left" />
      <div className="ember-atmosphere__side ember-atmosphere__side--right" />
      <div className="ember-atmosphere__attention" />
      <div className="ember-atmosphere__reply" />
      <div className="ember-atmosphere__waiting" />
      <div className="ember-atmosphere__chapter ember-atmosphere__chapter--left" />
      <div className="ember-atmosphere__chapter ember-atmosphere__chapter--right" />
      <svg className="ember-atmosphere__currents" viewBox="0 0 900 760" focusable="false">
        <defs>
          <linearGradient id={`${unique}-outer`} x1="450" y1="100" x2="450" y2="730" gradientUnits="userSpaceOnUse">
            <stop stopColor="#edbd85" stopOpacity="0" />
            <stop offset=".34" stopColor="#df9b60" stopOpacity=".34" />
            <stop offset=".75" stopColor="#d68448" stopOpacity=".45" />
            <stop offset="1" stopColor="#e5ad75" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${unique}-inner`} x1="430" y1="240" x2="470" y2="730" gradientUnits="userSpaceOnUse">
            <stop stopColor="#f4d6a8" stopOpacity="0" />
            <stop offset=".48" stopColor="#f5d3a1" stopOpacity=".62" />
            <stop offset="1" stopColor="#e7a96d" stopOpacity="0" />
          </linearGradient>
        </defs>
        {currents.map(([path], index) => <path key={index} className="ember-atmosphere__current" d={path} fill={`url(#${unique}-${index === 0 ? 'outer' : 'inner'})`} />)}
      </svg>
    </div>
  );
}
