import { z } from 'zod';

/** Ephemeral visual intent only. No content, identity, authorization or business state. */
export const EMBER_CUE_EVENT = 'hearth:ember-cue';
export const EmberCueSchema = z.object({
  kind: z.enum(['focus','release','typing','waiting','request-failed','acknowledged','chapter','project-added','declined','failed','motion-preference']),
  paused: z.boolean().optional(),
}).strict();
export type EmberCue = z.infer<typeof EmberCueSchema>;
let motionPaused = false;
export function isEmberMotionPaused(): boolean { return motionPaused; }
export function emitEmberCue(kind: EmberCue['kind'], paused?: boolean): void {
  if (kind === 'motion-preference' && paused !== undefined) motionPaused = paused;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EMBER_CUE_EVENT, {detail: paused === undefined ? {kind} : {kind,paused}}));
}
export function readEmberCue(event: Event): EmberCue | null {
  if (!('detail' in event)) return null;
  const parsed = EmberCueSchema.safeParse(event.detail);
  return parsed.success ? parsed.data : null;
}
