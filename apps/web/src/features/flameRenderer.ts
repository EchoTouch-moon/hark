import flameTextureUrl from '../assets/living-fire.png';

/** A single transparent, bounded fire field with life-stage support. */
export interface FlameFrame {
  time: number;
  heat: number;
  size: number;
  attention: number;
  pulse: number;
  waiting: number;
  day: number;
  golden?: number;
  dormant?: number;
  surge?: number;
}

export interface FlameRenderer {
  resize: () => void;
  draw: (frame: FlameFrame) => void;
  triggerSparks: (count?: number) => void;
  dispose: () => void;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  r: number;
  g: number;
  b: number;
  sway: number;
}

const vertex = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const fragment = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_heat;
uniform float u_size;
uniform float u_response;
uniform float u_day;
uniform sampler2D u_flame;
uniform float u_textureReady;
uniform float u_golden;
uniform float u_dormant;
uniform float u_surge;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float value = 0.0, amp = 0.52;
  for (int i = 0; i < 4; i++) {
    value += amp * noise(p);
    p = mat2(1.65, 1.1, -1.1, 1.65) * p + vec2(4.7, 1.9);
    amp *= 0.5;
  }
  return value;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float size = clamp(u_size, 0.65, 1.4);
  float goldenFactor = 1.0 + u_golden * 0.08;
  float dormantFactor = 1.0 - u_dormant * 0.48;
  float surgeFactor = 1.0 + u_surge * 0.22;
  float height = (0.58 + u_heat * 0.16) * size * goldenFactor * dormantFactor * surgeFactor;
  float width = (0.235 + u_heat * 0.065) * size * (1.0 + u_golden * 0.06) * (1.0 - u_dormant * 0.30) * (1.0 + u_surge * 0.10);
  float x = (uv.x - 0.5) * aspect / width;
  float y = (uv.y - 0.17) / height;
  if (abs(x) > 2.1 || y < -0.18 || y > 1.8) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float t = u_time * 0.72;
  float sway = sin(t * 0.73 + y * 3.3) * 0.11 * max(y, 0.0);
  float drift = fbm(vec2(x * 1.25 + 7.2, y * 2.1 - t * 0.72));
  float warpedX = x + sway + (drift - 0.5) * (0.22 + y * 0.34);
  float flowing = fbm(vec2(warpedX * 2.15 + 1.0, y * 3.3 - t * 1.65));
  float fine = fbm(vec2(warpedX * 4.4 - 3.0, y * 5.6 - t * 2.25 + flowing));
  float rootNarrowing = 1.0 - smoothstep(0.0, 0.22, y);
  float envelope = 1.08 - y * 1.02 - abs(warpedX) * (0.72 + max(y, 0.0) * 0.92 + rootNarrowing * 2.4);
  float field = envelope + (flowing - 0.5) * (1.05 + max(y, 0.0) * 0.36) + (fine - 0.5) * 0.38;
  float ground = smoothstep(-0.035, 0.09, y);
  float fire = smoothstep(-0.06, 0.10, field) * ground;
  float core = clamp(field * 1.55, 0.0, 1.0);
  float ripples = 0.92 + 0.08 * fine;

  vec3 col = mix(vec3(0.48, 0.035, 0.008), vec3(0.98, 0.23, 0.016), smoothstep(0.0, 0.45, core));
  col = mix(col, vec3(1.0, 0.65, 0.10), smoothstep(0.38, 0.83, core));
  col = mix(col, vec3(1.0, 0.93, 0.65), smoothstep(0.78, 1.0, core) * 0.75);

  // Golden serene hearth: rich warm gold for completed / accomplished projects
  vec3 goldenCol = mix(vec3(0.62, 0.28, 0.03), vec3(1.0, 0.80, 0.20), smoothstep(0.0, 0.50, core));
  goldenCol = mix(goldenCol, vec3(1.0, 0.96, 0.78), smoothstep(0.50, 1.0, core) * 0.90);
  col = mix(col, goldenCol, u_golden * 0.85);

  // Dormant deep ember: deep red ash glow for shelved projects
  vec3 dormantCol = mix(vec3(0.18, 0.02, 0.005), vec3(0.55, 0.07, 0.01), smoothstep(0.0, 0.60, core));
  col = mix(col, dormantCol, u_dormant * 0.88);

  // Stoke surge flare highlight
  col = mix(col, vec3(1.0, 0.95, 0.80), u_surge * 0.35 * smoothstep(0.35, 0.95, core));

  col *= ripples;
  col = mix(col, col * vec3(0.88, 0.71, 0.68), u_day * 0.28);
  float body = fire * (0.90 + (u_response + u_surge * 0.4) * 0.10);
  body *= mix(1.0, 0.60 + 0.15 * sin(t * 0.8), u_dormant);
  float glow = exp(-dot(vec2(x * 1.5, (y - 0.20) * 2.15), vec2(x * 1.5, (y - 0.20) * 2.15)) * 2.0) * 0.12 * ground;
  float alpha = clamp(body + glow * (1.0 - body), 0.0, 0.93);
  vec3 glowColor = mix(vec3(0.88, 0.20, 0.025), vec3(0.95, 0.55, 0.08), u_golden * 0.6);
  col = mix(glowColor, col, fire);

  float textureHeight = (0.68 + u_heat * 0.14) * size * (1.0 + (u_response + u_surge * 0.6) * 0.14) * goldenFactor * dormantFactor;
  float tx = 0.5 + (uv.x - 0.5) * aspect / (textureHeight * 1.12);
  float ty = (uv.y - 0.12) / textureHeight;
  float lift = smoothstep(0.0, 0.35, ty);
  vec2 distortion = vec2((drift - 0.5) * 0.44 + sin(t * 1.4 + ty * 7.0) * 0.055,
                         (fine - 0.5) * 0.24 + sin(t * 1.2 + tx * 6.0) * 0.04) * lift;
  vec2 tex = vec2(tx, ty) + distortion;
  vec4 photo = vec4(0.0);
  if (tex.x > 0.0 && tex.x < 1.0 && tex.y > 0.0 && tex.y < 1.0) {
    photo = texture2D(u_flame, tex);
    float edgeFade = smoothstep(0.0, 0.05, tex.x) * (1.0 - smoothstep(0.95, 1.0, tex.x)) * smoothstep(0.0, 0.03, tex.y) * (1.0 - smoothstep(0.95, 1.0, tex.y));
    photo *= edgeFade;
  }
  float crossFlow = fbm(vec2(tx * 3.1 - 4.0, ty * 3.2 - t * 1.32));
  vec2 secondTex = vec2(0.5 + (tx - 0.5) * 1.12, ty * 1.08 + 0.035)
    + vec2((crossFlow - 0.5) * 0.26, (flowing - 0.5) * 0.13) * lift;
  vec4 second = vec4(0.0);
  if (secondTex.x > 0.0 && secondTex.x < 1.0 && secondTex.y > 0.0 && secondTex.y < 1.0) {
    second = texture2D(u_flame, secondTex);
    float secondEdgeFade = smoothstep(0.0, 0.05, secondTex.x) * (1.0 - smoothstep(0.95, 1.0, secondTex.x)) * smoothstep(0.0, 0.03, secondTex.y) * (1.0 - smoothstep(0.95, 1.0, secondTex.y));
    second *= secondEdgeFade;
  }
  float flicker = 0.88 + 0.12 * noise(vec2(tx * 4.0 + t, ty * 4.0 - t * 2.0));
  flicker = mix(flicker, 0.96 + 0.04 * sin(t * 1.2), u_golden * 0.7);
  vec3 nightGrade = vec3(1.0, 0.83, 0.66);
  vec3 dayGrade = vec3(0.90, 0.77, 0.69);
  vec3 grade = mix(nightGrade, dayGrade, u_day);
  grade = mix(grade, vec3(1.10, 0.94, 0.70), u_golden * 0.85);
  grade = mix(grade, vec3(0.72, 0.36, 0.24), u_dormant * 0.90);
  vec3 photoColor = photo.rgb * grade * flicker;
  vec3 secondColor = second.rgb * grade * flicker;
  float photoAlpha = min(1.0, photo.a * (1.0 + (u_response + u_surge * 0.5) * 0.25)) * mix(0.94, 0.90, u_day) * (1.0 - u_dormant * 0.45) * u_textureReady;
  float secondAlpha = second.a * 0.26 * (1.0 - u_dormant * 0.45) * u_textureReady;
  float proceduralAlpha = alpha * mix(1.0, 0.035, u_textureReady);
  float combined = photoAlpha + secondAlpha * (1.0 - photoAlpha) + proceduralAlpha * (1.0 - photoAlpha) * (1.0 - secondAlpha);
  vec3 combinedColor = (photoColor * photoAlpha + secondColor * secondAlpha * (1.0 - photoAlpha)
    + col * proceduralAlpha * (1.0 - photoAlpha) * (1.0 - secondAlpha)) / max(combined, 0.0001);
  gl_FragColor = vec4(combinedColor, combined);
}
`;

// Point-sprite particle shader for floating sparks & embers
const sparkVertex = `
attribute vec2 a_spark_pos;
attribute float a_spark_size;
attribute float a_spark_alpha;
attribute vec3 a_spark_col;
varying float v_alpha;
varying vec3 v_col;
void main() {
  gl_Position = vec4(a_spark_pos, 0.0, 1.0);
  gl_PointSize = a_spark_size;
  v_alpha = a_spark_alpha;
  v_col = a_spark_col;
}
`;

const sparkFragment = `
precision mediump float;
varying float v_alpha;
varying vec3 v_col;
void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;
  float glow = smoothstep(0.5, 0.0, dist);
  gl_FragColor = vec4(v_col * glow, v_alpha * glow);
}
`;

export function createFlameRenderer(canvas: globalThis.HTMLCanvasElement, onTextureReady: () => void = () => {}): FlameRenderer | null {
  const gl = (() => {
    try { return canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' }); }
    catch { return null; }
  })();
  if (!gl) return null;

  const compile = (kind: number, source: string): globalThis.WebGLShader | null => {
    const shader = gl.createShader(kind);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
    return shader;
  };

  const vs = compile(gl.VERTEX_SHADER, vertex);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) { if (vs) gl.deleteShader(vs); if (fs) gl.deleteShader(fs); return null; }

  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!program || !buffer || !texture) {
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    return null;
  }
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs); return null;
  }

  // Sparks shader setup
  const sVs = compile(gl.VERTEX_SHADER, sparkVertex);
  const sFs = compile(gl.FRAGMENT_SHADER, sparkFragment);
  let sparksProgram: globalThis.WebGLProgram | null = null;
  let sparksBuffer: globalThis.WebGLBuffer | null = null;
  if (sVs && sFs) {
    const sp = gl.createProgram();
    const sb = gl.createBuffer();
    if (sp && sb) {
      gl.attachShader(sp, sVs);
      gl.attachShader(sp, sFs);
      gl.linkProgram(sp);
      if (gl.getProgramParameter(sp, gl.LINK_STATUS)) {
        sparksProgram = sp;
        sparksBuffer = sb;
      } else {
        gl.deleteProgram(sp);
        gl.deleteBuffer(sb);
      }
    }
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resolution = gl.getUniformLocation(program, 'u_resolution');
  const time = gl.getUniformLocation(program, 'u_time');
  const heat = gl.getUniformLocation(program, 'u_heat');
  const size = gl.getUniformLocation(program, 'u_size');
  const response = gl.getUniformLocation(program, 'u_response');
  const day = gl.getUniformLocation(program, 'u_day');
  const flame = gl.getUniformLocation(program, 'u_flame');
  const textureReadyUniform = gl.getUniformLocation(program, 'u_textureReady');
  const goldenUniform = gl.getUniformLocation(program, 'u_golden');
  const dormantUniform = gl.getUniformLocation(program, 'u_dormant');
  const surgeUniform = gl.getUniformLocation(program, 'u_surge');

  let textureReady = false;
  let disposed = false;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

  const image = new window.Image();
  image.onload = () => {
    if (disposed || gl.isContextLost()) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    textureReady = true;
    onTextureReady();
  };
  image.onerror = () => {
    if (disposed) return;
    textureReady = false;
  };
  image.src = flameTextureUrl;
  if (image.complete && image.naturalWidth > 0) {
    try {
      image.onload(new Event('load') as unknown as globalThis.Event);
    } catch { /* proceed via async event */ }
  }

  // Sparks particle state
  const MAX_SPARKS = 80;
  const sparks: Spark[] = [];
  const sparkData = new Float32Array(MAX_SPARKS * 7); // [x, y, size, alpha, r, g, b]
  let lastTime = 0;
  let lastAmbientSpark = 0;

  const triggerSparks = (count = 28) => {
    if (disposed || gl.isContextLost()) return;
    const addCount = Math.min(count, MAX_SPARKS - sparks.length);
    for (let i = 0; i < addCount; i++) {
      const isGold = Math.random() > 0.4;
      sparks.push({
        x: (Math.random() - 0.5) * 0.22,
        y: -0.62 + (Math.random() - 0.5) * 0.18,
        vx: (Math.random() - 0.5) * 0.16,
        vy: 0.52 + Math.random() * 0.65,
        size: 7.0 + Math.random() * 9.0,
        alpha: 0.85 + Math.random() * 0.15,
        life: 1.4 + Math.random() * 0.8,
        maxLife: 1.4 + Math.random() * 0.8,
        r: isGold ? 1.0 : 0.98,
        g: isGold ? 0.85 + Math.random() * 0.12 : 0.48 + Math.random() * 0.25,
        b: isGold ? 0.32 : 0.08,
        sway: Math.random() * Math.PI * 2,
      });
    }
  };

  const resize = () => {
    const factor = Math.min(1, 900 / Math.max(1, canvas.clientWidth));
    const width = Math.max(1, Math.round(canvas.clientWidth * factor));
    const height = Math.max(1, Math.round(canvas.clientHeight * factor));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
  };

  const draw = (frame: FlameFrame) => {
    if (gl.isContextLost()) return;

    // 1. Draw Living Fire Quad
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(resolution, canvas.width, canvas.height);
    gl.uniform1f(time, frame.time);
    gl.uniform1f(heat, frame.heat);
    gl.uniform1f(size, frame.size);
    gl.uniform1f(response, Math.max(0, Math.min(1, frame.attention + frame.pulse + frame.waiting)));
    gl.uniform1f(day, frame.day);
    gl.uniform1f(goldenUniform, frame.golden ?? 0);
    gl.uniform1f(dormantUniform, frame.dormant ?? 0);
    gl.uniform1f(surgeUniform, frame.surge ?? 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(flame, 0);
    gl.uniform1f(textureReadyUniform, textureReady ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2. Ambient and Active Sparks Simulation
    const dt = lastTime > 0 ? Math.min(0.08, Math.max(0, frame.time - lastTime)) : 0.016;
    lastTime = frame.time;

    // Ambient gentle spark every ~1.6s if not in deep dormant mode
    if ((frame.dormant ?? 0) < 0.6 && frame.time - lastAmbientSpark > 1.6) {
      lastAmbientSpark = frame.time;
      if (sparks.length < MAX_SPARKS) {
        const isGold = (frame.golden ?? 0) > 0.4 || Math.random() > 0.5;
        sparks.push({
          x: (Math.random() - 0.5) * 0.16,
          y: -0.58 + (Math.random() - 0.5) * 0.12,
          vx: (Math.random() - 0.5) * 0.08,
          vy: 0.38 + Math.random() * 0.35,
          size: 5.0 + Math.random() * 6.0,
          alpha: 0.75,
          life: 1.2 + Math.random() * 0.6,
          maxLife: 1.2 + Math.random() * 0.6,
          r: isGold ? 1.0 : 0.96,
          g: isGold ? 0.88 : 0.45,
          b: isGold ? 0.35 : 0.08,
          sway: Math.random() * Math.PI * 2,
        });
      }
    }

    if (sparksProgram && sparksBuffer && sparks.length > 0) {
      let activeCount = 0;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= dt;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.y += s.vy * dt;
        s.x += s.vx * dt + Math.sin(frame.time * 3.8 + s.sway) * 0.003;
        s.vy *= 0.985;
        s.vx *= 0.98;
        const fade = s.life / s.maxLife;
        s.alpha = fade * Math.min(1.0, (s.maxLife - s.life) / 0.18);

        const offset = activeCount * 7;
        sparkData[offset + 0] = s.x;
        sparkData[offset + 1] = s.y;
        sparkData[offset + 2] = s.size;
        sparkData[offset + 3] = s.alpha;
        sparkData[offset + 4] = s.r;
        sparkData[offset + 5] = s.g;
        sparkData[offset + 6] = s.b;
        activeCount++;
      }

      if (activeCount > 0) {
        gl.useProgram(sparksProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, sparksBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, sparkData.subarray(0, activeCount * 7), gl.DYNAMIC_DRAW);

        const sPos = gl.getAttribLocation(sparksProgram, 'a_spark_pos');
        const sSize = gl.getAttribLocation(sparksProgram, 'a_spark_size');
        const sAlpha = gl.getAttribLocation(sparksProgram, 'a_spark_alpha');
        const sCol = gl.getAttribLocation(sparksProgram, 'a_spark_col');

        const stride = 7 * 4;
        gl.enableVertexAttribArray(sPos);
        gl.vertexAttribPointer(sPos, 2, gl.FLOAT, false, stride, 0);

        gl.enableVertexAttribArray(sSize);
        gl.vertexAttribPointer(sSize, 1, gl.FLOAT, false, stride, 2 * 4);

        gl.enableVertexAttribArray(sAlpha);
        gl.vertexAttribPointer(sAlpha, 1, gl.FLOAT, false, stride, 3 * 4);

        gl.enableVertexAttribArray(sCol);
        gl.vertexAttribPointer(sCol, 3, gl.FLOAT, false, stride, 4 * 4);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, activeCount);
        gl.disable(gl.BLEND);
      }
    }
  };

  return {
    resize,
    draw,
    triggerSparks,
    dispose: () => {
      disposed = true;
      image.onload = null;
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (sparksProgram) gl.deleteProgram(sparksProgram);
      if (sparksBuffer) gl.deleteBuffer(sparksBuffer);
      if (sVs) gl.deleteShader(sVs);
      if (sFs) gl.deleteShader(sFs);
    },
  };
}
