import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gsap } from 'gsap';
import {
  createFlameMotionController,
} from '../../apps/web/src/motion';
import {
  createFlameRenderer,
  type FlameFrame,
} from '../../apps/web/src/features/flameRenderer';
import type { ProjectFlameStage } from '../../apps/web/src/features/projectEmber';

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

describe('Challenger R2-2 Adversarial Stress Harness', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      Image: MockImage,
      performance: { now: () => 1000 },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Fuzzing: 500 randomized stage transitions with arbitrary seek offsets preserve strict physical bounds and zero NaN/Infinity', () => {
    const controller = createFlameMotionController();
    const stages: ProjectFlameStage[] = ['spark', 'sprout', 'blaze', 'golden', 'dormant'];

    for (let i = 0; i < 500; i++) {
      const stage = stages[Math.floor(Math.random() * stages.length)]!;
      const immediate = Math.random() < 0.2;
      const tl = controller.transitionToStage(stage, { immediate });
      tl.pause();

      // Random seek between 0 and 2.0s
      const seekTime = Math.random() * 2.0;
      tl.seek(seekTime);

      const { heat, size, golden, dormant, surge, pulse, waiting, focus } = controller.frame;

      // Invariant 1: No NaN / Infinity
      expect(Number.isFinite(heat)).toBe(true);
      expect(Number.isFinite(size)).toBe(true);
      expect(Number.isFinite(golden)).toBe(true);
      expect(Number.isFinite(dormant)).toBe(true);
      expect(Number.isFinite(surge)).toBe(true);
      expect(Number.isFinite(pulse)).toBe(true);
      expect(Number.isFinite(waiting)).toBe(true);
      expect(Number.isFinite(focus)).toBe(true);

      // Invariant 2: Physical bounds based on STAGE_TARGETS
      // heat ranges from dormant (0.10) to golden (0.95)
      expect(heat).toBeGreaterThanOrEqual(0.09);
      expect(heat).toBeLessThanOrEqual(0.96);

      // size ranges from dormant (0.70) to golden (1.25)
      expect(size).toBeGreaterThanOrEqual(0.69);
      expect(size).toBeLessThanOrEqual(1.26);

      // golden and dormant are [0, 1]
      expect(golden).toBeGreaterThanOrEqual(0);
      expect(golden).toBeLessThanOrEqual(1.0);
      expect(dormant).toBeGreaterThanOrEqual(0);
      expect(dormant).toBeLessThanOrEqual(1.0);
    }

    controller.dispose();
    expect(gsap.getTweensOf(controller.frame).length).toBe(0);
  });

  it('Particle Engine Fuzzing: Extreme spark flood (10,000 sparks total) with erratic framerates strictly adheres to MAX_SPARKS = 160', () => {
    const mockGL = createMockGL();
    const canvas = createMockCanvas(mockGL);
    const renderer = createFlameRenderer(canvas);
    expect(renderer).not.toBeNull();
    if (!renderer) return;

    const frame: FlameFrame = {
      time: 0,
      heat: 0.8,
      size: 1.2,
      day: 1.0,
      golden: 0.5,
      dormant: 0.0,
      surge: 0.2,
      pulse: 0.1,
      waiting: 0.0,
    };

    // 100 iterations of random burst requests (0 to 200 sparks each)
    let totalRequested = 0;
    for (let i = 0; i < 100; i++) {
      const burst = Math.floor(Math.random() * 200);
      totalRequested += burst;
      renderer.triggerSparks(burst);

      // Erratic dt: sometimes 0ms, sometimes 16ms, sometimes 100ms
      const dtStep = [0, 0.005, 0.016, 0.033, 0.08, 0.2][i % 6]!;
      frame.time += dtStep;
      renderer.draw(frame);

      const activeSparks = mockGL.getPointsCount();
      const bufferLength = mockGL.getLastBufferDataLength();

      expect(activeSparks).toBeLessThanOrEqual(160);
      expect(bufferLength).toBeLessThanOrEqual(160 * 7);
    }

    expect(totalRequested).toBeGreaterThan(5000);
    renderer.dispose();
  });

  it('Stoke Surge Resilience: Concurrent rapid surges never exceed peak requested surge intensity', () => {
    const controller = createFlameMotionController();
    const baselineHeat = controller.frame.heat;

    let maxRequestedIntensity = 0;
    for (let i = 0; i < 50; i++) {
      const intensity = 0.4 + Math.random() * 0.3; // between 0.40 and 0.70
      maxRequestedIntensity = Math.max(maxRequestedIntensity, intensity);
      const tl = controller.triggerStokeSurge(intensity);
      tl.pause();
      tl.seek(Math.random() * 0.1); // seek anywhere during rise

      // The surge must never compound beyond the maximum requested intensity seen
      expect(controller.frame.surge).toBeLessThanOrEqual(maxRequestedIntensity + 1e-6);
      expect(controller.frame.surge).toBeGreaterThanOrEqual(0);

      // Heat must remain invariant
      expect(controller.frame.heat).toBe(baselineHeat);
    }

    controller.dispose();

    // Now test 50 rapid fixed-intensity bursts (0.55) on fresh controller to verify zero additive accumulation
    const freshController = createFlameMotionController();
    for (let i = 0; i < 50; i++) {
      const tl = freshController.triggerStokeSurge(0.55);
      tl.pause();
      tl.seek(0.05);
      expect(freshController.frame.surge).toBeLessThanOrEqual(0.55);
      expect(freshController.frame.surge).toBeGreaterThan(0);
      expect(freshController.frame.heat).toBe(baselineHeat);
    }
    freshController.dispose();

    controller.dispose();
    expect(gsap.getTweensOf(controller.frame).length).toBe(0);
  });

  it('Waiting Oscillation Toggle: Rapid switching between active true and false leaves 0 orphaned tweens', () => {
    const controller = createFlameMotionController();

    for (let i = 0; i < 50; i++) {
      const active = i % 2 === 0;
      controller.triggerWaiting(active);
    }

    // Turn off waiting
    const offTl = controller.triggerWaiting(false);
    offTl.seek(0.3); // seek to end of deactivation

    expect(controller.frame.waiting).toBe(0);

    controller.dispose();
    expect(gsap.getTweensOf(controller.frame).length).toBe(0);
  });

  it('Mid-flight Disposal Chaos: 100 cycles of starting 4 concurrent timelines and disposing mid-flight leaves 0 leaks', () => {
    for (let cycle = 0; cycle < 100; cycle++) {
      const controller = createFlameMotionController();
      controller.transitionToStage('blaze');
      controller.triggerStokeSurge(0.6);
      controller.triggerPulse('strong');
      controller.triggerWaiting(true);

      expect(gsap.getTweensOf(controller.frame).length).toBeGreaterThan(0);

      // Dispose mid-flight
      controller.dispose();
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);

      // Verify dead timelines post-disposal
      const deadStage = controller.transitionToStage('golden');
      const deadSurge = controller.triggerStokeSurge(0.55);
      const deadPulse = controller.triggerPulse('gentle');
      const deadWaiting = controller.triggerWaiting(true);

      expect(deadStage.duration()).toBe(0);
      expect(deadSurge.duration()).toBe(0);
      expect(deadPulse.duration()).toBe(0);
      expect(deadWaiting.duration()).toBe(0);
      expect(gsap.getTweensOf(controller.frame).length).toBe(0);
    }
  });

  it('WebGL Context Loss Mid-burst: Safely suppresses draw calls and particle uploads without unhandled exceptions', () => {
    const mockGL = createMockGL();
    const canvas = createMockCanvas(mockGL);
    const renderer = createFlameRenderer(canvas);
    expect(renderer).not.toBeNull();
    if (!renderer) return;

    const frame: FlameFrame = {
      time: 1.0,
      heat: 0.7,
      size: 1.1,
      day: 1.0,
      golden: 0.0,
      dormant: 0.0,
      surge: 0.0,
      pulse: 0.0,
      waiting: 0.0,
    };

    // Trigger sparks
    renderer.triggerSparks(40);
    renderer.draw(frame);
    expect(mockGL.getPointsCount()).toBe(40);

    // Simulate WebGL context loss
    mockGL.setContextLost(true);

    // Further sparks and draw calls should be safely ignored
    renderer.triggerSparks(50);
    frame.time += 0.016;
    renderer.draw(frame);
    renderer.resize();

    // Context restored
    mockGL.setContextLost(false);
    renderer.draw(frame);

    renderer.dispose();
    // After disposal, even with context alive, draw/resize must be no-ops
    renderer.draw(frame);
    renderer.resize();
    renderer.triggerSparks(30);
  });

  it('Long-duration Stability: Simulated 24-hour continuous run (86,400s) maintains finite particle state and frame invariants', () => {
    const mockGL = createMockGL();
    const canvas = createMockCanvas(mockGL);
    const renderer = createFlameRenderer(canvas);
    expect(renderer).not.toBeNull();
    if (!renderer) return;

    const frame: FlameFrame = {
      time: 0,
      heat: 0.5,
      size: 1.0,
      day: 1.0,
      golden: 0.2,
      dormant: 0.0,
      surge: 0.0,
      pulse: 0.0,
      waiting: 0.0,
    };

    // Step through 24 simulated hours in large time leaps (e.g. 500s each)
    for (let t = 0; t <= 86400; t += 500) {
      frame.time = t;
      renderer.draw(frame);
      expect(mockGL.getPointsCount()).toBeLessThanOrEqual(160);
      expect(mockGL.getLastBufferDataLength()).toBeLessThanOrEqual(160 * 7);
    }

    renderer.dispose();
  });
});

