import type { ProjectFlameStage } from './projectEmber';

/** Visual proportions only; they never determine message or project state. */
export interface FlameShape {
  width: number;
  height: number;
  opacity: number;
  center: number;
  rate: number;
}

export const FLAME_SHAPES: Readonly<Record<ProjectFlameStage, Readonly<FlameShape>>> = {
  spark:   { width: 0.26, height: 0.23, opacity: 0.72, center: 0.50, rate: 0.68 },
  sprout:  { width: 0.54, height: 0.52, opacity: 0.86, center: 0.47, rate: 0.85 },
  blaze:   { width: 1.00, height: 1.00, opacity: 1.00, center: 0.47, rate: 1.08 },
  golden:  { width: 0.88, height: 0.82, opacity: 0.96, center: 0.47, rate: 0.62 },
  dormant: { width: 0.48, height: 0.25, opacity: 0.78, center: 0.39, rate: 0.42 },
};
