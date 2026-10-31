import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gsap } from 'gsap';
import {
  createFlameMotionController,
  STAGE_TARGETS,
  STAGE_TRANSITION_DURATION,
  STOKE_SURGE_RISE,
  STOKE_SURGE_DECAY,
} from '../../apps/web/src/motion';
import {
  createFlameRenderer,
  type FlameFrame,
} from '../../apps/web/src/features/flameRenderer';
import type { ProjectFlameStage } from '../../apps/web/src/features/flameVisual';

/**
 * Mock WebGL context to allow headless verification of flameRenderer point-sprite
 * particle physics, eviction queue constraints, and buffer safety.
 */
function createMockGL() {
  const shaders: unknown[] = [];
  const programs: unknown[] = [];
  const buffers: unknown[] = [];
  const textures: unknown[] = [];
  let drawArraysPointsCount = 0;
  let lastBufferDataLength = 0;
  let contextLost = false;

  return {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    DYNAMIC_DRAW: 35048,
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
    UNPACK_FLIP_Y_WEBGL: 37444,
    FLOAT: 5126,
    TRIANGLES: 4,
    POINTS: 0,
    SRC_ALPHA: 770,
    ONE: 1,
    BLEND: 3042,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,

    createShader: (kind: number) => {
      const s = { kind, id: shaders.length };
      shaders.push(s);
      return s;
    },
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    createProgram: () => {
      const p = { id: programs.length };
      programs.push(p);
      return p;
    },
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    createBuffer: () => {
      const b = { id: buffers.length };
      buffers.push(b);
      return b;
    },
    createTexture: () => {
      const t = { id: textures.length };
      textures.push(t);
      return t;
    },
    useProgram: () => {},
    bindBuffer: () => {},
    bufferData: (_target: number, data: Float32Array) => {
      lastBufferDataLength = data.length;
    },
    getAttribLocation: () => 1,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    getUniformLocation: () => ({}),
    activeTexture: () => {},
    bindTexture: () => {},
    texParameteri: () => {},
    texImage2D: () => {},
    pixelStorei: () => {},
    isContextLost: () => contextLost,
    viewport: () => {},
    uniform2f: () => {},
    uniform1f: () => {},
    uniform1i: () => {},
    drawArrays: (mode: number, _first: number, count: number) => {
      if (mode === 0 /* POINTS */) {
        drawArraysPointsCount = count;
      }
    },
    enable: () => {},
    blendFunc: () => {},
    disable: () => {},
    deleteTexture: () => {},
    deleteBuffer: () => {},
    deleteProgram: () => {},
    deleteShader: () => {},
    getExtension: (name: string) => {
      if (name === 'WEBGL_lose_context') {
        return {
          loseContext: () => {
            contextLost = true;
          },
        };
      }
      return null;
    },

    getPointsCount: () => drawArraysPointsCount,
    getLastBufferDataLength: () => lastBufferDataLength,
    setContextLost: (lost: boolean) => {
      contextLost = lost;
    },
  };
}

class MockImage {
  onload: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  src = '';
  naturalWidth = 64;
  naturalHeight = 64;
  complete = true;
}

function createMockCanvas(mockGL: ReturnType<typeof createMockGL>) {
  return {
    clientWidth: 800,
    clientHeight: 600,
    width: 800,
    height: 600,
    getContext: (type: string) => (type === 'webgl' ? mockGL : null),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as globalThis.HTMLCanvasElement;
}

describe('Hearth GSAP Motion System — Adversarial Stress & Chaos Verification', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      Image: MockImage,
      performance: { now: () => 1000 },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Adversarial Test 1: Rapid sequential stage transitions & virtual time seeking', () => {
    it('survives rapid 50ms sequential switching across all 5 stages without NaN, Infinity, or uncaught exceptions', () => {
      const controller = createFlameMotionController();
      const stages: ProjectFlameStage[] = ['spark', 'blaze', 'dormant', 'sprout', 'golden'];

      // Execute 40 cycles (200 rapid stage switches in 50ms intervals)
      const CYCLES = 40;
      let switchCount = 0;

      for (let cycle = 0; cycle < CYCLES; cycle++) {
        for (const targetStage of stages) {
          switchCount++;
          const tl = controller.transitionToStage(targetStage);
          tl.pause();

          // Advance 50ms virtual time (0.05s)
          tl.seek(0.05);

          // Assert zero NaN or Infinity on mutable physical frame
          const { heat, size, golden, dormant, surge, pulse, waiting, focus } = controller.frame;
          expect(Number.isFinite(heat), `heat is non-finite at switch #${switchCount}`).toBe(true);
          expect(Number.isFinite(size), `size is non-finite at switch #${switchCount}`).toBe(true);
          expect(Number.isFinite(golden), `golden is non-finite at switch #${switchCount}`).toBe(true);
          expect(Number.isFinite(dormant), `dormant is non-finite at switch #${switchCount}`).toBe(true);
          expect(Number.isFinite(surge), `surge is non-finite at switch #${switchCount}`).toBe(true);
          expect(Number.isFinite(pulse), `pulse is non-finite at switch #${switchCount}`).toBe(true);
          expect(Number.isFinite(waiting), `waiting is non-finite at switch #${switchCount}`).toBe(true);
          expect(Number.isFinite(focus), `focus is non-finite at switch #${switchCount}`).toBe(true);

          // Physical boundary checks
          expect(heat).toBeGreaterThanOrEqual(0.08);
          expect(heat).toBeLessThanOrEqual(1.0);
          expect(size).toBeGreaterThanOrEqual(0.65);
          expect(size).toBeLessThanOrEqual(1.35);
          expect(golden).toBeGreaterThanOrEqual(0);
          expect(golden).toBeLessThanOrEqual(1.0);
          expect(dormant).toBeGreaterThanOrEqual(0);
          expect(dormant).toBeLessThanOrEqual(1.0);
        }
      }

      // After 200 switches, let the final target ('golden') seek to completion
      const finalTl = controller.transitionToStage('golden');
      finalTl.seek(STAGE_TRANSITION_DURATION);

      expect(controller.frame.heat).toBeCloseTo(STAGE_TARGETS.golden.heat, 4);
      expect(controller.frame.size).toBeCloseTo(STAGE_TARGETS.golden.size, 4);
      expect(controller.frame.golden).toBeCloseTo(STAGE_TARGETS.golden.golden, 4);
      expect(controller.frame.dormant).toBeCloseTo(STAGE_TARGETS.golden.dormant, 4);

      // Verify that no orphaned tweens pile up
      controller.dispose();
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
    });

    it('kills and replaces previous stage timelines cleanly during zero-interval churn', () => {
      const controller = createFlameMotionController();

      // Fire 100 stage transitions with zero time in between
      for (let i = 0; i < 100; i++) {
        const stage: ProjectFlameStage = i % 2 === 0 ? 'spark' : 'blaze';
        controller.transitionToStage(stage);
      }

      // There should only be at most 1 active tween on the frame properties
      const activeTweens = gsap.getTweensOf(controller.frame);
      expect(activeTweens.length).toBeLessThanOrEqual(1);

      controller.dispose();
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
    });
  });

  describe('Adversarial Test 2: Spark particle queue overflow & eviction guarantee', () => {
    it('strictly caps particle count at MAX_SPARKS = 160 under 20 concurrent triggerSparks(50) calls', () => {
      const mockGL = createMockGL();
      const canvas = createMockCanvas(mockGL);
      const renderer = createFlameRenderer(canvas);
      expect(renderer).not.toBeNull();
      if (!renderer) return;

      const frame: FlameFrame = {
        time: 1.0,
        heat: 0.75,
        size: 1.15,
        day: 1.0,
        golden: 0.0,
        dormant: 0.0,
        surge: 0.0,
        pulse: 0.0,
        waiting: 0.0,
      };

      // 20 concurrent bursts of 50 sparks each = 1,000 requested particles
      for (let burst = 1; burst <= 20; burst++) {
        renderer.triggerSparks(50);
        // Draw one frame to process the particle queue and update shaders
        frame.time += 0.016;
        renderer.draw(frame);

        const currentActiveSparks = mockGL.getPointsCount();
        const currentDataLength = mockGL.getLastBufferDataLength();

        // Strict assertion: Particle count MUST NOT exceed MAX_SPARKS (160)
        expect(currentActiveSparks).toBeLessThanOrEqual(160);
        // Strict assertion: Buffer data MUST NOT exceed MAX_SPARKS * 7 = 1,120 floats
        expect(currentDataLength).toBeLessThanOrEqual(160 * 7);
      }

      // After all 20 bursts, verify particles stay at the hard ceiling
      expect(mockGL.getPointsCount()).toBe(160);
      expect(mockGL.getLastBufferDataLength()).toBe(160 * 7);

      // Verify that particles age and decay properly over subsequent frames
      for (let step = 0; step < 150; step++) {
        frame.time += 0.032;
        renderer.draw(frame);
        expect(mockGL.getPointsCount()).toBeLessThanOrEqual(160);
      }

      renderer.dispose();
    });

    it('handles extreme particle bursts (e.g. 500 sparks in a single call) safely without overrun', () => {
      const mockGL = createMockGL();
      const canvas = createMockCanvas(mockGL);
      const renderer = createFlameRenderer(canvas);
      expect(renderer).not.toBeNull();
      if (!renderer) return;

      const frame: FlameFrame = {
        time: 2.0,
        heat: 0.5,
        size: 1.0,
        day: 0.0,
        golden: 0.0,
        dormant: 0.0,
        surge: 0.0,
        pulse: 0.0,
        waiting: 0.0,
      };

      // Single burst of 500 sparks into empty or existing queue
      renderer.triggerSparks(500);
      renderer.draw(frame);

      expect(mockGL.getPointsCount()).toBeLessThanOrEqual(160);
      expect(mockGL.getLastBufferDataLength()).toBeLessThanOrEqual(160 * 7);

      // Negative or zero spark requests should not corrupt the array
      renderer.triggerSparks(-10);
      renderer.draw(frame);
      expect(mockGL.getPointsCount()).toBeLessThanOrEqual(160);

      renderer.triggerSparks(0);
      renderer.draw(frame);
      expect(mockGL.getPointsCount()).toBeLessThanOrEqual(160);

      renderer.dispose();
    });
  });

  describe('Adversarial Test 3: Stoke surge stacking & physical bound decoupling', () => {
    it('kills prior tweens during 10 rapid triggerStokeSurge calls without value compounding', () => {
      const controller = createFlameMotionController();
      const baselineHeat = controller.frame.heat;

      // Trigger 10 rapid surges with partial progress seek (20ms each)
      for (let i = 1; i <= 10; i++) {
        const tl = controller.triggerStokeSurge(0.55);
        tl.pause();
        tl.seek(0.02);

        // Assert surge never compounds beyond peak intensity 0.55
        expect(controller.frame.surge).toBeGreaterThan(0);
        expect(controller.frame.surge).toBeLessThanOrEqual(0.55);

        // Assert heat is completely decoupled and never accumulates from stoke surge
        expect(controller.frame.heat).toBe(baselineHeat);

        // Assert active tweens on surge do not stack up uncontrollably
        const tweens = gsap.getTweensOf(controller.frame);
        // At most 1 stage tween and 1 surge tween
        expect(tweens.length).toBeLessThanOrEqual(2);
      }

      // Fast-forward final surge timeline to full completion
      const finalTl = controller.triggerStokeSurge(0.55);
      finalTl.seek(STOKE_SURGE_RISE + STOKE_SURGE_DECAY);

      // Surge returns strictly to 0
      expect(controller.frame.surge).toBe(0);
      // Heat remains completely untouched
      expect(controller.frame.heat).toBe(baselineHeat);

      controller.dispose();
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
    });

    it('rejects infinite compounding even under 100 rapid concurrent stoke triggers', () => {
      const controller = createFlameMotionController();

      for (let i = 0; i < 100; i++) {
        controller.triggerStokeSurge(0.60);
      }

      // Only 1 surge timeline should be tracked
      const tweens = gsap.getTweensOf(controller.frame);
      expect(tweens.length).toBeLessThanOrEqual(2);

      controller.dispose();
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
    });
  });

  describe('Adversarial Test 4: Combined chaos stress (Concurrent transitions, surges & spark floods)', () => {
    it('maintains finite frame values and zero resource leaks under full combined load', () => {
      const mockGL = createMockGL();
      const canvas = createMockCanvas(mockGL);
      const renderer = createFlameRenderer(canvas);
      const controller = createFlameMotionController();
      expect(renderer).not.toBeNull();
      if (!renderer) return;

      const stages: ProjectFlameStage[] = ['blaze', 'dormant', 'spark', 'golden', 'sprout'];

      // Execute 30 steps of concurrent chaos
      for (let step = 0; step < 30; step++) {
        // 1. Stage transition
        const stage = stages[step % stages.length]!;
        const tlStage = controller.transitionToStage(stage);
        tlStage.pause();
        tlStage.seek(0.04);

        // 2. Stoke surge
        const tlSurge = controller.triggerStokeSurge(0.55);
        tlSurge.pause();
        tlSurge.seek(0.03);

        // 3. Pulse
        const tlPulse = controller.triggerPulse('strong');
        tlPulse.pause();
        tlPulse.seek(0.05);

        // 4. Waiting oscillation
        if (step % 5 === 0) {
          controller.triggerWaiting(true);
        } else if (step % 5 === 3) {
          controller.triggerWaiting(false);
        }

        // 5. Spark flood
        renderer.triggerSparks(40);

        // 6. Draw call
        controller.frame.time += 0.016;
        renderer.draw(controller.frame);

        // Invariant assertions
        expect(Number.isFinite(controller.frame.heat)).toBe(true);
        expect(Number.isFinite(controller.frame.size)).toBe(true);
        expect(Number.isFinite(controller.frame.golden)).toBe(true);
        expect(Number.isFinite(controller.frame.dormant)).toBe(true);
        expect(Number.isFinite(controller.frame.surge)).toBe(true);
        expect(mockGL.getPointsCount()).toBeLessThanOrEqual(160);
        expect(mockGL.getLastBufferDataLength()).toBeLessThanOrEqual(160 * 7);
      }

      // Complete cleanup
      renderer.dispose();
      controller.dispose();

      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
    });
  });
});
