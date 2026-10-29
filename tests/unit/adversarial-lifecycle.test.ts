import { describe, expect, it, vi, afterEach } from 'vitest';
import { gsap } from 'gsap';
import {
  createFlameMotionController,
  STAGE_TARGETS,
} from '../../apps/web/src/motion';
import { createFlameRenderer } from '../../apps/web/src/features/flameRenderer';
import { isEmberMotionPaused } from '../../apps/web/src/features/ember-cues';

describe('Adversarial Lifecycle, Teardown & Memory Leak Suite', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('1. createFlameMotionController Lifecycle & Orphaned Tween Resurrections', () => {
    it('calling dispose() immediately terminates all active tweens on controller.frame', () => {
      const controller = createFlameMotionController();
      controller.transitionToStage('blaze');
      controller.triggerStokeSurge();
      controller.triggerWaiting(true);
      controller.triggerPulse('strong');

      const tweensBefore = gsap.getTweensOf(controller.frame);
      expect(tweensBefore.length).toBeGreaterThan(0);

      controller.dispose();

      const tweensAfter = gsap.getTweensOf(controller.frame);
      expect(tweensAfter.length).toBe(0);
    });

    it('calling methods on a disposed controller does NOT attach or resurrect tweens', () => {
      const controller = createFlameMotionController();
      controller.dispose();

      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
      expect(controller.isDisposed?.()).toBe(true);

      // 1. transitionToStage after dispose returns dead timeline and creates 0 tweens on frame
      const stageTl = controller.transitionToStage('golden');
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
      expect(stageTl.duration()).toBe(0);

      // 2. triggerStokeSurge after dispose creates 0 tweens on frame
      const surgeTl = controller.triggerStokeSurge(0.8);
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
      expect(surgeTl.duration()).toBe(0);

      // 3. triggerPulse after dispose creates 0 tweens on frame
      const pulseTl = controller.triggerPulse('strong');
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
      expect(pulseTl.duration()).toBe(0);

      // 4. triggerWaiting(true) after dispose creates 0 tweens on frame
      const waitingTl = controller.triggerWaiting(true);
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
      expect(waitingTl.repeat()).toBe(0);
    });

    it('calling dispose() repeatedly is idempotent and does not throw', () => {
      const controller = createFlameMotionController();
      expect(() => {
        controller.dispose();
        controller.dispose();
        controller.dispose();
      }).not.toThrow();
    });
  });

  describe('2. WebGL flameRenderer dispose() and Post-Disposal Safety', () => {
    function setupMockBrowser() {
      const deletedShaders: unknown[] = [];
      const deletedPrograms: unknown[] = [];
      const deletedBuffers: unknown[] = [];
      const deletedTextures: unknown[] = [];
      let loseContextCalled = false;
      let contextLost = false;

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
        createShader: vi.fn(() => ({ id: Math.random() })),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        getShaderParameter: vi.fn(() => true),
        deleteShader: vi.fn((s) => deletedShaders.push(s)),
        createProgram: vi.fn(() => ({ id: Math.random() })),
        attachShader: vi.fn(),
        linkProgram: vi.fn(),
        getProgramParameter: vi.fn(() => true),
        deleteProgram: vi.fn((p) => deletedPrograms.push(p)),
        createBuffer: vi.fn(() => ({ id: Math.random() })),
        deleteBuffer: vi.fn((b) => deletedBuffers.push(b)),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        createTexture: vi.fn(() => ({ id: Math.random() })),
        deleteTexture: vi.fn((t) => deletedTextures.push(t)),
        bindTexture: vi.fn(),
        activeTexture: vi.fn(),
        texParameteri: vi.fn(),
        texImage2D: vi.fn(),
        pixelStorei: vi.fn(),
        useProgram: vi.fn(),
        getAttribLocation: vi.fn(() => 0),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        getUniformLocation: vi.fn(() => ({})),
        uniform1f: vi.fn(),
        uniform1i: vi.fn(),
        uniform2f: vi.fn(),
        drawArrays: vi.fn(),
        enable: vi.fn(),
        disable: vi.fn(),
        blendFunc: vi.fn(),
        isContextLost: vi.fn(() => contextLost),
        getExtension: vi.fn((ext: string) => {
          if (ext === 'WEBGL_lose_context') {
            return {
              loseContext: vi.fn(() => {
                loseContextCalled = true;
                contextLost = true;
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

      vi.stubGlobal('window', {
        Image: MockImage,
      });

      const canvas = {
        clientWidth: 800,
        clientHeight: 600,
        width: 800,
        height: 600,
        getContext: vi.fn((type: string) => {
          if (type === 'webgl') return mockGl;
          return null;
        }),
      } as unknown as Parameters<typeof createFlameRenderer>[0];

      return {
        canvas,
        mockGl,
        setContextLost: (lost: boolean) => { contextLost = lost; },
        getDeleted: () => ({
          deletedShaders,
          deletedPrograms,
          deletedBuffers,
          deletedTextures,
          loseContextCalled,
        }),
      };
    }

    it('cleanly calls loseContext, deletes shaders, programs, buffers, textures on dispose()', () => {
      const { canvas, getDeleted } = setupMockBrowser();
      const renderer = createFlameRenderer(canvas);
      expect(renderer).not.toBeNull();
      if (!renderer) return;

      renderer.dispose();

      const deleted = getDeleted();
      expect(deleted.loseContextCalled).toBe(true);
      expect(deleted.deletedPrograms.length).toBeGreaterThanOrEqual(1);
      expect(deleted.deletedShaders.length).toBeGreaterThanOrEqual(2);
      expect(deleted.deletedBuffers.length).toBeGreaterThanOrEqual(1);
      expect(deleted.deletedTextures.length).toBeGreaterThanOrEqual(1);
    });

    it('draw() properly checks disposed flag and is a no-op after dispose()', () => {
      const { canvas, mockGl, setContextLost } = setupMockBrowser();
      const renderer = createFlameRenderer(canvas);
      expect(renderer).not.toBeNull();
      if (!renderer) return;

      renderer.dispose();

      // If context loss is asynchronous or not immediately reported by driver
      setContextLost(false);
      mockGl.useProgram.mockClear();
      mockGl.drawArrays.mockClear();

      renderer.draw({
        time: 1.0,
        heat: 0.5,
        size: 1.0,
        day: 1,
        pulse: 0,
        waiting: 0,
      });

      // draw() immediately exits on disposed flag, never calling GL methods on deleted objects
      expect(mockGl.useProgram).not.toHaveBeenCalled();
      expect(mockGl.drawArrays).not.toHaveBeenCalled();
    });

    it('triggerSparks() properly checks disposed flag and is a no-op after dispose()', () => {
      const { canvas } = setupMockBrowser();
      const renderer = createFlameRenderer(canvas);
      expect(renderer).not.toBeNull();
      if (!renderer) return;

      renderer.dispose();

      expect(() => {
        renderer.triggerSparks(50);
      }).not.toThrow();
    });
  });

  describe('3. Reduced Motion & motionPaused Instant End-State Snapping', () => {
    it('immediate: true on controller snaps directly to target values with 0 duration', () => {
      const controller = createFlameMotionController({
        heat: 0.1,
        size: 0.8,
        golden: 0,
        dormant: 0,
      });

      const tl = controller.transitionToStage('blaze', { immediate: true });
      expect(tl.duration()).toBe(0);
      expect(controller.frame.heat).toBe(STAGE_TARGETS.blaze.heat);
      expect(controller.frame.size).toBe(STAGE_TARGETS.blaze.size);
      controller.dispose();
    });

    it('isEmberMotionPaused detects prefers-reduced-motion media query when window.matchMedia matches', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn().mockImplementation((query: string) => ({
          matches: query.includes('prefers-reduced-motion: reduce'),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      });

      expect(isEmberMotionPaused()).toBe(true);
    });

    it('isEmberMotionPaused returns false when reduced-motion does not match and motionPaused is false', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      });

      expect(isEmberMotionPaused()).toBe(false);
    });

    it('isEmberMotionPaused is safe in Node/SSR environment where window is undefined', () => {
      vi.stubGlobal('window', undefined);
      expect(isEmberMotionPaused()).toBe(false);
    });
  });
});
