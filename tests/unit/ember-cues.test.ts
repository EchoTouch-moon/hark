import { afterEach, expect, it, vi } from 'vitest';
import { EMBER_CUE_EVENT, EmberCueSchema, emitEmberCue, isEmberMotionPaused, readEmberCue } from '../../apps/web/src/features/ember-cues';
afterEach(() => { emitEmberCue('motion-preference', false); vi.unstubAllGlobals(); });
it('visual cue cannot carry message, project path or approval', () => {
 for(const field of ['message','path','projectId','approved','risk']) expect(EmberCueSchema.safeParse({kind:'typing',[field]:'private'}).success).toBe(false);
});
it('rejects unknown visual intent and malformed pause', () => {
 expect(EmberCueSchema.safeParse({kind:'execute'}).success).toBe(false);
 expect(EmberCueSchema.safeParse({kind:'motion-preference',paused:'true'}).success).toBe(false);
});
it('publishes no content and stores pause only in ephemeral UI memory', () => {
 const dispatchEvent=vi.fn();vi.stubGlobal('window',{dispatchEvent});
 emitEmberCue('typing');
 expect(dispatchEvent.mock.calls[0]?.[0].type).toBe(EMBER_CUE_EVENT);
 expect(dispatchEvent.mock.calls[0]?.[0].detail).toEqual({kind:'typing'});
 emitEmberCue('motion-preference',true);expect(isEmberMotionPaused()).toBe(true);
 expect(readEmberCue(dispatchEvent.mock.calls[1]?.[0])).toEqual({kind:'motion-preference',paused:true});
});
it('foreign events without valid detail are ignored', () => {
 expect(readEmberCue(new Event('other'))).toBeNull();
 expect(readEmberCue(new CustomEvent(EMBER_CUE_EVENT,{detail:{kind:'typing',message:'x'}}))).toBeNull();
});
it('supports stoke cue for fuel/scan visual excitation without carrying project payloads', () => {
 expect(EmberCueSchema.safeParse({kind:'stoke'}).success).toBe(true);
 expect(EmberCueSchema.safeParse({kind:'stoke',payload:'data'}).success).toBe(false);
});
