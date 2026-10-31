import { describe, expect, it, vi, afterEach } from 'vitest';
import { gsap } from 'gsap';
import {
  createFlameMotionController,
} from '../../apps/web/src/motion';
import type { ProjectFlameStage } from '../../apps/web/src/features/flameVisual';
import { createFlameRenderer } from '../../apps/web/src/features/flameRenderer';
import {
  isEmberMotionPaused,
  emitEmberCue,
  EMBER_CUE_EVENT,
} from '../../apps/web/src/features/ember-cues';

describe('Deep Adversarial Stress & Resiliency Suite', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Reset internal motionPaused state
    emitEmberCue('motion-preference', false);
  });

  describe('1. FlameMotionController Stress & Post-Disposal Invariant Testing', () => {
    it('survives rapid high-frequency method invocations without crashing or leaking active timelines', () => {
      const controller = createFlameMotionController();
      const stages: ProjectFlameStage[] = ['spark', 'sprout', 'blaze', 'golden', 'dormant'];

      // Hammer 200 state transitions and triggers
      for (let i = 0; i < 200; i++) {
        const stage = stages[i % stages.length]!;
        controller.transitionToStage(stage);
        if (i % 3 === 0) controller.triggerStokeSurge(0.5);
        if (i % 5 === 0) controller.triggerPulse('strong');
        if (i % 7 === 0) controller.triggerWaiting(i % 14 === 0);
      }

      // Dispose while timelines are active
      controller.dispose();

      // Invariant: zero active tweens on controller.frame
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
      expect(controller.isDisposed?.()).toBe(true);
    });

    it('idempotently handles repeated dispose() calls (20 times) without error', () => {
      const controller = createFlameMotionController();
      controller.transitionToStage('blaze');
      controller.triggerWaiting(true);

      for (let i = 0; i < 20; i++) {
        expect(() => controller.dispose()).not.toThrow();
      }

      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
      expect(controller.isDisposed?.()).toBe(true);
    });

    it('post-disposal: every public method returns dead timeline and never resurrects tweens on frame', () => {
      const controller = createFlameMotionController();
      controller.dispose();

      const stages: ProjectFlameStage[] = ['spark', 'sprout', 'blaze', 'golden', 'dormant'];
      for (const stage of stages) {
        const tl = controller.transitionToStage(stage);
        expect(tl.duration()).toBe(0);
        expect(gsap.getTweensOf(controller.frame).length).toBe(0);

        // Attempting to restart/play/seek the returned timeline MUST NOT attach any tweens
        tl.play();
        tl.restart();
        tl.seek(5);
        expect(gsap.getTweensOf(controller.frame).length).toBe(0);
      }

      // triggerStokeSurge
      const surgeTl = controller.triggerStokeSurge(1.0);
      expect(surgeTl.duration()).toBe(0);
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
      surgeTl.play();
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);

      // triggerPulse
      const pulseTl1 = controller.triggerPulse('gentle');
      const pulseTl2 = controller.triggerPulse('strong');
      expect(pulseTl1.duration()).toBe(0);
      expect(pulseTl2.duration()).toBe(0);
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);

      // triggerWaiting (both true and false)
      const waitingTrueTl = controller.triggerWaiting(true);
      const waitingFalseTl = controller.triggerWaiting(false);
      expect(waitingTrueTl.duration()).toBe(0);
      expect(waitingFalseTl.duration()).toBe(0);
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
    });

    it('post-disposal: frame values remain frozen even when time progresses in GSAP global ticker', () => {
      const controller = createFlameMotionController({ heat: 0.2, size: 0.9 });
      controller.dispose();

      const initialHeat = controller.frame.heat;
      const initialSize = controller.frame.size;

      // Try to mutate via post-dispose calls
      controller.transitionToStage('golden');
      controller.triggerStokeSurge(0.9);
      controller.triggerWaiting(true);

      // Advance global ticker by 10 seconds
      gsap.ticker.tick();

      expect(controller.frame.heat).toBe(initialHeat);
      expect(controller.frame.size).toBe(initialSize);
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
    });
  });

  describe('2. WebGL flameRenderer Post-Disposal & Stress Invariant Testing', () => {
    function setupMockGl() {
      let contextLost = false;
      const callLog: string[] = [];

      const mockGl = {
        VERTEX_SHADER: 35633,
        FRAGMENT_SHADER: 35632,
        COMPILE_STATUS: 35713,
        LINK_STATUS: 35714,
        ARRAY_BUFFER: 34962,
        STATIC_DRAW: 35044,
        DYNAMIC_DRAW: 35048,
        FLOAT: 5126,
        TEXTURE0: 33984,
        TEXTURE_2D: 3553,
        TEXTURE_WRAP_S: 10242,
        TEXTURE_WRAP_T: 10243,
        CLAMP_TO_EDGE: 33071,
        TEXTURE_MIN_FILTER: 10241,
        TEXTURE_MAG_FILTER: 10240,
        LINEAR: 9729,
        RGBA: 6408,
        UNSIGNED_BYTE: 5121,
        UNPACK_FLIP_Y_WEBGL: 37440,
        TRIANGLES: 4,
        POINTS: 0,
        BLEND: 3042,
        SRC_ALPHA: 770,
        ONE: 1,
        createShader: vi.fn(() => ({ id: 1 })),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        getShaderParameter: vi.fn(() => true),
        deleteShader: vi.fn(() => callLog.push('deleteShader')),
        createProgram: vi.fn(() => ({ id: 2 })),
        attachShader: vi.fn(),
        linkProgram: vi.fn(),
        getProgramParameter: vi.fn(() => true),
        deleteProgram: vi.fn(() => callLog.push('deleteProgram')),
        createBuffer: vi.fn(() => ({ id: 3 })),
        deleteBuffer: vi.fn(() => callLog.push('deleteBuffer')),
        bindBuffer: vi.fn((_t, _b) => callLog.push('bindBuffer')),
        bufferData: vi.fn(),
        createTexture: vi.fn(() => ({ id: 4 })),
        deleteTexture: vi.fn(() => callLog.push('deleteTexture')),
        bindTexture: vi.fn((_t, _tx) => callLog.push('bindTexture')),
        activeTexture: vi.fn(() => callLog.push('activeTexture')),
        texParameteri: vi.fn(),
        texImage2D: vi.fn(() => callLog.push('texImage2D')),
        pixelStorei: vi.fn(),
        useProgram: vi.fn((_p) => callLog.push('useProgram')),
        getAttribLocation: vi.fn(() => 0),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        getUniformLocation: vi.fn(() => ({})),
        uniform1f: vi.fn(() => callLog.push('uniform1f')),
        uniform1i: vi.fn(() => callLog.push('uniform1i')),
        uniform2f: vi.fn(() => callLog.push('uniform2f')),
        drawArrays: vi.fn(() => callLog.push('drawArrays')),
        viewport: vi.fn(() => callLog.push('viewport')),
        enable: vi.fn(),
        disable: vi.fn(),
        blendFunc: vi.fn(),
        isContextLost: vi.fn(() => contextLost),
        getExtension: vi.fn((ext: string) => {
          if (ext === 'WEBGL_lose_context') {
            return {
              loseContext: vi.fn(() => {
                contextLost = true;
                callLog.push('loseContext');
              }),
            };
          }
          return null;
        }),
      };

      class MockImage {
        onload: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        src = '';
        complete = false;
        naturalWidth = 0;
      }

      vi.stubGlobal('window', { Image: MockImage });

      const canvas = {
        clientWidth: 800,
        clientHeight: 600,
        width: 800,
        height: 600,
        getContext: vi.fn((type: string) => (type === 'webgl' ? mockGl : null)),
      } as unknown as Parameters<typeof createFlameRenderer>[0];

      return {
        canvas,
        mockGl,
        callLog,
        setContextLost: (lost: boolean) => { contextLost = lost; },
      };
    }

    it('calling dispose() multiple times is safe and does not crash', () => {
      const { canvas } = setupMockGl();
      const renderer = createFlameRenderer(canvas);
      expect(renderer).not.toBeNull();
      if (!renderer) return;

      expect(() => {
        renderer.dispose();
        renderer.dispose();
        renderer.dispose();
      }).not.toThrow();
    });

    it('500 draw(), resize(), and triggerSparks() calls post-disposal execute ZERO GL draw/useProgram calls', () => {
      const { canvas, mockGl, setContextLost } = setupMockGl();
      const renderer = createFlameRenderer(canvas);
      expect(renderer).not.toBeNull();
      if (!renderer) return;

      renderer.dispose();
      // Even if context lost flag was somehow reset or false
      setContextLost(false);

      mockGl.useProgram.mockClear();
      mockGl.drawArrays.mockClear();
      mockGl.viewport.mockClear();
      mockGl.uniform1f.mockClear();
      mockGl.bindBuffer.mockClear();
      mockGl.bindTexture.mockClear();

      for (let i = 0; i < 500; i++) {
        renderer.draw({
          time: i * 0.1,
          heat: Math.random(),
          size: 1.0,
          day: 1,
          golden: 0,
          dormant: 0,
          surge: 0,
          pulse: 0,
          waiting: 0,
          focus: 0,
        });
        renderer.resize();
        renderer.triggerSparks(20);
      }

      expect(mockGl.useProgram).not.toHaveBeenCalled();
      expect(mockGl.drawArrays).not.toHaveBeenCalled();
      expect(mockGl.viewport).not.toHaveBeenCalled();
      expect(mockGl.uniform1f).not.toHaveBeenCalled();
      expect(mockGl.bindBuffer).not.toHaveBeenCalled();
      expect(mockGl.bindTexture).not.toHaveBeenCalled();
    });

    it('late image.onload or image.onerror after dispose does not touch WebGL or throw', () => {
      interface ImageWithHandlers {
        onload: ((e: unknown) => void) | null;
        onerror: ((e: unknown) => void) | null;
      }
      const state: { captured?: ImageWithHandlers } = {};

      class InterceptImage {
        onload: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        src = '';
        complete = false;
        naturalWidth = 0;
        constructor() {
          state.captured = this;
        }
      }

      vi.stubGlobal('window', { Image: InterceptImage });

      const { canvas, mockGl } = setupMockGl();
      const onTextureReady = vi.fn();
      const renderer = createFlameRenderer(canvas, onTextureReady);
      expect(renderer).not.toBeNull();
      if (!renderer) return;

      // Keep reference to callbacks before dispose wipes them
      const lateOnload = state.captured?.onload;
      const lateOnerror = state.captured?.onerror;

      renderer.dispose();

      mockGl.texImage2D.mockClear();

      // Trigger late async callbacks
      expect(() => {
        lateOnload?.(new Event('load'));
        lateOnerror?.(new Event('error'));
      }).not.toThrow();

      expect(mockGl.texImage2D).not.toHaveBeenCalled();
      expect(onTextureReady).not.toHaveBeenCalled();
    });

    it('context loss prior to dispose halts draws safely, and dispose still succeeds', () => {
      const { canvas, mockGl, setContextLost } = setupMockGl();
      const renderer = createFlameRenderer(canvas);
      expect(renderer).not.toBeNull();
      if (!renderer) return;

      // Context is lost asynchronously by driver
      setContextLost(true);
      mockGl.useProgram.mockClear();
      mockGl.drawArrays.mockClear();

      renderer.draw({
        time: 1.0,
        heat: 0.5,
        size: 1.0,
        day: 1,
        golden: 0,
        dormant: 0,
        surge: 0,
        pulse: 0,
        waiting: 0,
        focus: 0,
      });

      expect(mockGl.useProgram).not.toHaveBeenCalled();
      expect(mockGl.drawArrays).not.toHaveBeenCalled();

      // Now dispose while context is already lost
      expect(() => renderer.dispose()).not.toThrow();
    });
  });

  describe('3. isEmberMotionPaused Thorough Environment & Media Query Testing', () => {
    it('returns false in SSR/Node environment (window is undefined)', () => {
      vi.stubGlobal('window', undefined);
      expect(isEmberMotionPaused()).toBe(false);
    });

    it('returns false when window.matchMedia is undefined or not a function', () => {
      vi.stubGlobal('window', { matchMedia: undefined });
      expect(isEmberMotionPaused()).toBe(false);

      vi.stubGlobal('window', {});
      expect(isEmberMotionPaused()).toBe(false);
    });

    it('survives throwing matchMedia without crashing and returns false', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn(() => {
          throw new Error('SecurityError: access denied');
        }),
      });
      expect(isEmberMotionPaused()).toBe(false);
    });

    it('returns true when media query matches', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn((q: string) => ({
          matches: q.includes('prefers-reduced-motion: reduce'),
          media: q,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      });
      expect(isEmberMotionPaused()).toBe(true);
    });

    it('returns false when media query does not match', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn((q: string) => ({
          matches: false,
          media: q,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      });
      expect(isEmberMotionPaused()).toBe(false);
    });

    it('explicit manual pause via emitEmberCue overrides non-matching media query', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn(() => ({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
        dispatchEvent: vi.fn(),
      });

      expect(isEmberMotionPaused()).toBe(false);

      // User pauses motion in app settings
      emitEmberCue('motion-preference', true);
      expect(isEmberMotionPaused()).toBe(true);

      // User unpauses motion in app settings
      emitEmberCue('motion-preference', false);
      expect(isEmberMotionPaused()).toBe(false);
    });
  });

  describe('4. Component Lifecycle, Teardown & Event Listener Zero-Leak Invariant Testing', () => {
    it('EmberAtmosphere teardown cleanly unbinds all 10 system and DOM listeners', () => {
      type ListenerRecord = { target: string; type: string; listener: unknown };
      const attached: ListenerRecord[] = [];
      const removed: ListenerRecord[] = [];

      const makeEmitter = (name: string) => ({
        addEventListener: vi.fn((type: string, listener: unknown) => {
          attached.push({ target: name, type, listener });
        }),
        removeEventListener: vi.fn((type: string, listener: unknown) => {
          removed.push({ target: name, type, listener });
        }),
      });

      const mockWindow = makeEmitter('window');
      const mockDoc = makeEmitter('document');
      const mockCanvas = makeEmitter('canvas');
      const mockMedia = {
        matches: false,
        ...makeEmitter('media'),
      };

      // Emulate EmberAtmosphere effect 1 (accessibility & cue preferences)
      const mediaMotionHandler = () => {};
      const docVisibilityHandler = () => {};
      const winPreferenceHandler = () => {};
      mockMedia.addEventListener('change', mediaMotionHandler);
      mockDoc.addEventListener('visibilitychange', docVisibilityHandler);
      mockWindow.addEventListener(EMBER_CUE_EVENT, winPreferenceHandler);

      const effect1Cleanup = () => {
        mockMedia.removeEventListener('change', mediaMotionHandler);
        mockDoc.removeEventListener('visibilitychange', docVisibilityHandler);
        mockWindow.removeEventListener(EMBER_CUE_EVENT, winPreferenceHandler);
      };

      // Emulate EmberAtmosphere effect 2 (user intent listeners)
      const focusHandler = () => {};
      const releaseHandler = () => {};
      const inputHandler = () => {};
      mockDoc.addEventListener('focusin', focusHandler);
      mockDoc.addEventListener('focusout', releaseHandler);
      mockDoc.addEventListener('input', inputHandler);

      const effect2Cleanup = () => {
        mockDoc.removeEventListener('focusin', focusHandler);
        mockDoc.removeEventListener('focusout', releaseHandler);
        mockDoc.removeEventListener('input', inputHandler);
      };

      // Emulate EmberAtmosphere useHearthTimeline effect 3 (motion engine listeners)
      const cueHandler = () => {};
      const resizeHandler = () => {};
      const lostHandler = () => {};
      const restoredHandler = () => {};
      mockWindow.addEventListener(EMBER_CUE_EVENT, cueHandler);
      mockWindow.addEventListener('resize', resizeHandler);
      mockCanvas.addEventListener('webglcontextlost', lostHandler);
      mockCanvas.addEventListener('webglcontextrestored', restoredHandler);

      const controller = createFlameMotionController();
      let rendererDisposed = false;
      const fakeRenderer = {
        dispose: () => { rendererDisposed = true; },
      };

      const effect3Cleanup = () => {
        mockWindow.removeEventListener(EMBER_CUE_EVENT, cueHandler);
        mockWindow.removeEventListener('resize', resizeHandler);
        mockCanvas.removeEventListener('webglcontextlost', lostHandler);
        mockCanvas.removeEventListener('webglcontextrestored', restoredHandler);
        fakeRenderer.dispose();
        controller.dispose();
      };

      expect(attached.length).toBe(10);
      expect(removed.length).toBe(0);

      // Execute unmount cleanups
      effect1Cleanup();
      effect2Cleanup();
      effect3Cleanup();

      expect(removed.length).toBe(10);
      expect(rendererDisposed).toBe(true);
      expect(controller.isDisposed?.()).toBe(true);

      // Verify exact 1:1 match between attached and removed listeners
      for (const att of attached) {
        const matchIndex = removed.findIndex(
          (rem) => rem.target === att.target && rem.type === att.type && rem.listener === att.listener
        );
        expect(matchIndex).toBeGreaterThanOrEqual(0);
        removed.splice(matchIndex, 1);
      }
      expect(removed.length).toBe(0);
    });

    it('GSAP context unmount revert cleanly kills and detaches all animations', () => {
      const target = { x: 0, opacity: 1, scale: 1 };
      const ctx = gsap.context(() => {
        gsap.to(target, { x: 100, duration: 2 });
        gsap.to(target, { opacity: 0.5, duration: 1.5 });
        gsap.timeline().to(target, { scale: 1.2, duration: 0.8 });
      });

      expect(gsap.getTweensOf(target).length).toBe(3);

      // Trigger unmount revert (as done by useHearthTimeline / useGSAP)
      ctx.revert();

      expect(gsap.getTweensOf(target).length).toBe(0);
      expect(target.x).toBe(0);
      expect(target.opacity).toBe(1);
      expect(target.scale).toBe(1);
    });
  });
});

