/**
 * Hearth Motion Easing Tokens and Timing Constants.
 * Authoritative specification: docs/MOTION-SPECIFICATION.md
 */

export const HEARTH_EASE = {
  gentle: 'sine.inOut',
  breath: 'power1.inOut',
  burst: 'power2.out',
  snap: 'power3.out',
  sharp: 'power2.inOut',
  recoil: 'back.out(1.4)',
} as const;

export type HearthEase = typeof HEARTH_EASE;
export type HearthEaseName = keyof HearthEase;

/**
 * Standard duration tokens in seconds.
 */
export const STAGE_TRANSITION_DURATION = 1.2;
export const STOKE_SURGE_RISE = 0.22;
export const STOKE_SURGE_DECAY = 1.35;
export const COMPOSER_FLIP_DURATION = 0.4;
export const FOCUS_DURATION = 0.4;
export const PULSE_RISE_DURATION = 0.32;
export const PULSE_DECAY_DURATION = 0.8;
export const WAITING_HALF_CYCLE = 1.8;
