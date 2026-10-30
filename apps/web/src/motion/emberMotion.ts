import { gsap } from 'gsap';
import {
  HEARTH_EASE,
  STAGE_TRANSITION_DURATION,
  STOKE_SURGE_RISE,
  STOKE_SURGE_DECAY,
  PULSE_RISE_DURATION,
  PULSE_DECAY_DURATION,
  WAITING_HALF_CYCLE,
} from './easing';
import type { ProjectFlameStage } from '../features/flameVisual';

export interface FlameFrame {
  time: number;
  heat: number;
  size: number;
  day: number;
  golden: number;
  dormant: number;
  surge: number;
  pulse: number;
  waiting: number;
  focus: number;
}

export interface StageTarget {
  heat: number;
  size: number;
  golden: number;
  dormant: number;
  sparks: number;
}

/**
 * Baseline parameters for the 5 authoritative flame life stages.
 * Specification: docs/MOTION-SPECIFICATION.md §3.1 & §3.2
 */
export const STAGE_TARGETS: Record<ProjectFlameStage, StageTarget> = {
  spark: { heat: 0.20, size: 0.90, golden: 0.0, dormant: 0.0, sparks: 8 },
  sprout: { heat: 0.45, size: 1.00, golden: 0.0, dormant: 0.0, sparks: 16 },
  blaze: { heat: 0.75, size: 1.15, golden: 0.0, dormant: 0.0, sparks: 32 },
  golden: { heat: 0.95, size: 1.25, golden: 1.0, dormant: 0.0, sparks: 48 },
  dormant: { heat: 0.10, size: 0.70, golden: 0.0, dormant: 1.0, sparks: 2 },
} as const;

export interface TransitionOptions {
  immediate?: boolean;
  duration?: number;
}

export interface FlameMotionController {
  frame: FlameFrame;
  transitionToStage(stage: ProjectFlameStage, options?: TransitionOptions): gsap.core.Timeline;
  triggerStokeSurge(intensity?: number): gsap.core.Timeline;
  triggerPulse(type?: 'gentle' | 'strong'): gsap.core.Timeline;
  triggerWaiting(active: boolean): gsap.core.Timeline;
  dispose(): void;
  readonly isDisposed?: () => boolean;
}

/**
 * Creates a deterministic, GSAP-driven flame motion controller.
 * Operates on mutable physical frame targets testable in virtual time.
 */
export function createFlameMotionController(initialFrame?: Partial<FlameFrame>): FlameMotionController {
  const frame: FlameFrame = {
    time: 0,
    heat: STAGE_TARGETS.spark.heat,
    size: STAGE_TARGETS.spark.size,
    day: 0,
    golden: STAGE_TARGETS.spark.golden,
    dormant: STAGE_TARGETS.spark.dormant,
    surge: 0,
    pulse: 0,
    waiting: 0,
    focus: 0,
    ...initialFrame,
  };

  let disposed = false;
  const activeTimelines = new Set<gsap.core.Timeline>();
  let stageTimeline: gsap.core.Timeline | null = null;
  let surgeTimeline: gsap.core.Timeline | null = null;
  let pulseTimeline: gsap.core.Timeline | null = null;
  let waitingTimeline: gsap.core.Timeline | null = null;

  const createDeadTimeline = (): gsap.core.Timeline => {
    const tl = gsap.timeline({ paused: true });
    tl.kill();
    return tl;
  };

  const registerTimeline = (tl: gsap.core.Timeline): gsap.core.Timeline => {
    if (disposed) {
      tl.kill();
      return tl;
    }
    activeTimelines.add(tl);
    tl.eventCallback('onComplete', () => {
      activeTimelines.delete(tl);
    });
    return tl;
  };

  const transitionToStage = (stage: ProjectFlameStage, options?: TransitionOptions): gsap.core.Timeline => {
    if (disposed) return createDeadTimeline();

    if (stageTimeline) {
      stageTimeline.kill();
      activeTimelines.delete(stageTimeline);
      stageTimeline = null;
    }

    const target = STAGE_TARGETS[stage];
    const duration = options?.immediate ? 0 : (options?.duration ?? STAGE_TRANSITION_DURATION);

    const tl = gsap.timeline();
    tl.to(frame, {
      heat: target.heat,
      size: target.size,
      golden: target.golden,
      dormant: target.dormant,
      duration,
      ease: HEARTH_EASE.gentle,
    });

    stageTimeline = tl;
    registerTimeline(tl);
    tl.eventCallback('onComplete', () => {
      activeTimelines.delete(tl);
      if (stageTimeline === tl) stageTimeline = null;
    });

    return tl;
  };

  const triggerStokeSurge = (intensity: number = 0.55): gsap.core.Timeline => {
    if (disposed) return createDeadTimeline();

    if (surgeTimeline) {
      surgeTimeline.kill();
      activeTimelines.delete(surgeTimeline);
      surgeTimeline = null;
    }

    const tl = gsap.timeline();
    tl.to(frame, {
      surge: intensity,
      duration: STOKE_SURGE_RISE,
      ease: HEARTH_EASE.burst,
    }).to(frame, {
      surge: 0,
      duration: STOKE_SURGE_DECAY,
      ease: HEARTH_EASE.gentle,
    });

    surgeTimeline = tl;
    registerTimeline(tl);
    tl.eventCallback('onComplete', () => {
      activeTimelines.delete(tl);
      if (surgeTimeline === tl) surgeTimeline = null;
    });

    return tl;
  };

  const triggerPulse = (type: 'gentle' | 'strong' = 'gentle'): gsap.core.Timeline => {
    if (disposed) return createDeadTimeline();

    if (pulseTimeline) {
      pulseTimeline.kill();
      activeTimelines.delete(pulseTimeline);
      pulseTimeline = null;
    }

    const intensity = type === 'strong' ? 0.35 : 0.20;
    const tl = gsap.timeline();
    tl.to(frame, {
      pulse: intensity,
      duration: PULSE_RISE_DURATION,
      ease: 'sine.out',
    }).to(frame, {
      pulse: 0,
      duration: PULSE_DECAY_DURATION,
      ease: HEARTH_EASE.gentle,
    });

    pulseTimeline = tl;
    registerTimeline(tl);
    tl.eventCallback('onComplete', () => {
      activeTimelines.delete(tl);
      if (pulseTimeline === tl) pulseTimeline = null;
    });

    return tl;
  };

  const triggerWaiting = (active: boolean): gsap.core.Timeline => {
    if (disposed) return createDeadTimeline();

    if (waitingTimeline) {
      waitingTimeline.kill();
      activeTimelines.delete(waitingTimeline);
      waitingTimeline = null;
    }

    if (active) {
      const tl = gsap.timeline({ repeat: -1, yoyo: true });
      tl.to(frame, {
        waiting: 0.16,
        duration: WAITING_HALF_CYCLE,
        ease: HEARTH_EASE.gentle,
      });
      waitingTimeline = tl;
      activeTimelines.add(tl);
      return tl;
    } else {
      const tl = gsap.timeline();
      tl.to(frame, {
        waiting: 0,
        duration: 0.3,
        ease: 'sine.out',
      });
      registerTimeline(tl);
      return tl;
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;

    if (stageTimeline) {
      stageTimeline.kill();
      stageTimeline = null;
    }
    if (surgeTimeline) {
      surgeTimeline.kill();
      surgeTimeline = null;
    }
    if (pulseTimeline) {
      pulseTimeline.kill();
      pulseTimeline = null;
    }
    if (waitingTimeline) {
      waitingTimeline.kill();
      waitingTimeline = null;
    }
    activeTimelines.forEach((tl) => {
      tl.kill();
    });
    activeTimelines.clear();
    gsap.killTweensOf(frame);
  };

  return {
    frame,
    transitionToStage,
    triggerStokeSurge,
    triggerPulse,
    triggerWaiting,
    dispose,
    isDisposed: () => disposed,
  };
}
