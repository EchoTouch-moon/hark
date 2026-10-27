import { describe, expect, it } from 'vitest';
import {
  RUN_STATE_TRANSITIONS,
  assertRunTransition,
  canTransitionRun,
  isTerminalRunState,
  InvalidRunTransitionError,
} from './index.js';

describe('run state machine', () => {
  it('allows the golden happy path', () => {
    const path = ['queued', 'executing', 'verifying', 'completed'] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransitionRun(path[i]!, path[i + 1]!)).toBe(true);
    }
  });
  it('allows approval path queued -> awaiting_approval -> executing -> blocked', () => {
    expect(canTransitionRun('queued', 'awaiting_approval')).toBe(true);
    expect(canTransitionRun('awaiting_approval', 'executing')).toBe(true);
    expect(canTransitionRun('awaiting_approval', 'blocked')).toBe(true);
  });
  it('allows uncertainty paths', () => {
    expect(canTransitionRun('executing', 'pending_verification')).toBe(true);
    expect(canTransitionRun('verifying', 'pending_verification')).toBe(true);
    expect(canTransitionRun('pending_verification', 'verifying')).toBe(true);
  });
  it('forbids queued -> completed (shortcut)', () => {
    expect(canTransitionRun('queued', 'completed')).toBe(false);
  });
  it('forbids executing -> completed (must verify)', () => {
    expect(canTransitionRun('executing', 'completed')).toBe(false);
  });
  it('forbids blocked -> completed', () => {
    expect(canTransitionRun('blocked', 'completed')).toBe(false);
  });
  it('forbids pending_verification -> executing with potential side effects', () => {
    expect(canTransitionRun('pending_verification', 'executing')).toBe(false);
  });
  it('forbids reverse transitions out of terminal states', () => {
    for (const terminal of ['completed', 'failed', 'blocked', 'cancelled'] as const) {
      expect(isTerminalRunState(terminal)).toBe(true);
      expect(RUN_STATE_TRANSITIONS[terminal]).toHaveLength(0);
      expect(canTransitionRun(terminal, 'queued')).toBe(false);
    }
  });
  it('assertRunTransition throws typed error on illegal move', () => {
    expect(() => assertRunTransition('executing', 'completed')).toThrow(InvalidRunTransitionError);
    expect(() => assertRunTransition('queued', 'executing')).not.toThrow();
  });
});
