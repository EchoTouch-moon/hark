import type { FlameLevel, NarrativeState } from '@hearth/hearth-contract';

/** Renderer shape presets (FLAME_SHAPES / STAGE_TARGETS keys). Visual only. */
export type ProjectFlameStage = 'spark' | 'sprout' | 'blaze' | 'golden' | 'dormant';

export interface FlameVisual {
  level: FlameLevel;
  /** Renderer shape preset nearest this level. */
  stage: ProjectFlameStage;
  /** --ember-heat */
  heat: number;
  outer: number;
  inner: number;
  coal: number;
  aura: number;
  flicker: number;
  tone: string;
  golden: number;
  dormant: number;
  label: string;
  greeting: string;
  band: 'cool' | 'warm' | 'hot';
  reason: string;
  /** Render greyscale (error / permission_denied). */
  desaturated?: boolean;
  /** Jump with no transition. */
  instant?: boolean;
}

type LevelRow = Omit<FlameVisual, 'level' | 'golden' | 'reason'>;

// Style Bible v7 §1 (docs/STYLE-BIBLE-v7-2026-10-31.md): FlameLevel → visual.
// heat/outer/inner/coal/aura/flicker/tone are v7 values; stage picks the
// nearest existing renderer shape preset; greeting is v7 §2.
export const FLAME_LEVELS: Readonly<Record<FlameLevel, Readonly<LevelRow>>> = {
  neutral: { stage: 'spark',   heat: 0.10, outer: 0,    inner: 0,    coal: 0.25, aura: 0.10, flicker: 0,    tone: '#F2EFEA', dormant: 0, label: '静火', greeting: '从哪儿开始？', band: 'cool' },
  ember:   { stage: 'dormant', heat: 0.30, outer: 0.20, inner: 0.10, coal: 0.70, aura: 0.25, flicker: 0.02, tone: '#EDE6DC', dormant: 1, label: '余烬', greeting: '余烬还在。',   band: 'cool' },
  warm:    { stage: 'sprout',  heat: 0.60, outer: 0.55, inner: 0.45, coal: 0.60, aura: 0.50, flicker: 0.05, tone: '#F7F0E6', dormant: 0, label: '温火', greeting: '炉还温着。',   band: 'warm' },
  bright:  { stage: 'blaze',   heat: 0.90, outer: 0.90, inner: 0.85, coal: 0.50, aura: 0.80, flicker: 0.09, tone: '#FBEBD8', dormant: 0, label: '旺火', greeting: '火正旺。',     band: 'hot' },
};

const ORDER: readonly FlameLevel[] = ['neutral', 'ember', 'warm', 'bright'];

/** v7 §1: one step 500ms, two or more steps 800ms, no intermediate stops. Seconds. */
export function flameTransitionSeconds(from: FlameLevel, to: FlameLevel): number {
  const steps = Math.abs(ORDER.indexOf(from) - ORDER.indexOf(to));
  return steps === 0 ? 0.5 : steps === 1 ? 0.5 : 0.8;
}

/** cubic-bezier(.22,1,.36,1) as a GSAP ease function. */
export const EMBER_EASE = cubicBezier(0.22, 1, 0.36, 1);
export const EMBER_EASE_CSS = 'cubic-bezier(.22,1,.36,1)';

export function flameVisual(flame: NarrativeState['flame']): FlameVisual {
  return { ...FLAME_LEVELS[flame.level], level: flame.level, golden: flame.milestoneGold ? 1 : 0, reason: flame.reason };
}

/** 设计 notes on PR #8: error / permission_denied → neutral 0.10, desaturated, no transition, own label. */
export function frozenFlame(label: string, reason: string): FlameVisual {
  return { ...FLAME_LEVELS.neutral, level: 'neutral', golden: 0, reason, label, aura: 0, flicker: 0, tone: '#E6E3DF', desaturated: true, instant: true };
}

/** Shell flame from the ViewModel. Reads only narrative.flame; never counts. */
export function shellFlame(vm: { status: string; observationFreshness: string; narrative: NarrativeState } | null): FlameVisual {
  if (!vm || vm.status === 'error') return frozenFlame('火候未知', '读不到数据，暂不判断火候。');
  if (vm.status === 'permission_denied') return frozenFlame('未授权读取', '没有读取权限，暂不判断火候。');
  // 设计/产品 spec: empty = 尚未点火, neutral 0.10, not desaturated.
  if (vm.status === 'empty') return { ...FLAME_LEVELS.neutral, level: 'neutral', golden: 0, reason: '还没有项目，火尚未点起。', label: '尚未点火' };
  const v = flameVisual(vm.narrative.flame);
  return vm.observationFreshness === 'stale' ? { ...v, label: `${v.label} · 旧观测` } : v;
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const a = (p1: number, p2: number) => 1 - 3 * p2 + 3 * p1;
  const b = (p1: number, p2: number) => 3 * p2 - 6 * p1;
  const c = (p1: number) => 3 * p1;
  const at = (t: number, p1: number, p2: number) => ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;
  const slope = (t: number, p1: number, p2: number) => 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);
  return (x: number) => {
    if (x <= 0 || x >= 1) return x;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= (at(t, x1, x2) - x) / d;
    }
    return at(Math.min(1, Math.max(0, t)), y1, y2);
  };
}
