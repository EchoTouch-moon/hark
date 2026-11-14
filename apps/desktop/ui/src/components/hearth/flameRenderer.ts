import flameTextureUrl from "../../assets/living-fire.png";
import type { FlameStage } from "../../bridge/HarkBridge";

export interface FlameShape {
  width: number;
  height: number;
  opacity: number;
  center: number;
  rate: number;
  heat: number;
  golden: number;
  dormant: number;
  sparkInterval: number;
}

export interface FlameFrame {
  time: number;
  heat: number;
  size: number;
  focus: number;
  pulse: number;
  waiting: number;
  day: number;
  golden: number;
  dormant: number;
  surge: number;
}

export interface FlameRenderer {
  resize: () => void;
  draw: (frame: FlameFrame, shape: FlameShape) => void;
  triggerSparks: (count?: number) => void;
  dispose: () => void;
}

export const R1_FLAME_STAGE_SHAPES: Readonly<Record<FlameStage, Readonly<FlameShape>>> = {
  neutral: {
    width: 0.42,
    height: 0.36,
    opacity: 0.56,
    center: 0.36,
    rate: 0.72,
    heat: 0.2,
    golden: 0,
    dormant: 0.2,
    sparkInterval: 1.4,
  },
  ember: {
    width: 0.58,
    height: 0.48,
    opacity: 0.74,
    center: 0.37,
    rate: 0.82,
    heat: 0.38,
    golden: 0,
    dormant: 0.45,
    sparkInterval: 0.95,
  },
  gentle: {
    width: 0.78,
    height: 0.68,
    opacity: 0.88,
    center: 0.4,
    rate: 1.0,
    heat: 0.62,
    golden: 0,
    dormant: 0,
    sparkInterval: 0.62,
  },
  bright: {
    width: 0.98,
    height: 0.88,
    opacity: 0.96,
    center: 0.43,
    rate: 1.18,
    heat: 0.86,
    golden: 0.15,
    dormant: 0,
    sparkInterval: 0.42,
  },
  milestone: {
    width: 1.06,
    height: 0.94,
    opacity: 1.0,
    center: 0.44,
    rate: 1.12,
    heat: 0.96,
    golden: 0.88,
    dormant: 0,
    sparkInterval: 0.36,
  },
};

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

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FRAGMENT_SHADER = `
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
uniform float u_shapeWidth;
uniform float u_shapeHeight;
uniform float u_shapeOpacity;
uniform float u_shapeCenter;

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
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  float size = clamp(u_size, 0.65, 1.45);
  float dormantFactor = 1.0 - u_dormant * 0.36;
  float surgeFactor = 1.0 + u_surge * 0.24;

  float height = (0.56 + u_heat * 0.18) * size * u_shapeHeight * dormantFactor * surgeFactor;
  float width = (0.24 + u_heat * 0.075) * size * u_shapeWidth * (1.0 - u_dormant * 0.22) * (1.0 + u_surge * 0.10);
  float x = (uv.x - 0.5) * aspect / max(width, 0.001);
  float y = (uv.y - (u_shapeCenter - 0.28 * size * u_shapeHeight)) / max(height, 0.001);
  if (abs(x) > 2.2 || y < -0.20 || y > 1.85) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float t = u_time * 0.78;
  float sway = sin(t * 0.85 + y * 3.4) * 0.12 * max(y, 0.0);
  float drift = fbm(vec2(x * 1.25 + 7.2, y * 2.15 - t * 0.82));
  float warpedX = x + sway + (drift - 0.5) * (0.24 + y * 0.36);
  float flowing = fbm(vec2(warpedX * 2.15 + 1.0, y * 3.35 - t * 1.75));
  float fine = fbm(vec2(warpedX * 4.4 - 3.0, y * 5.6 - t * 2.35 + flowing));
  float rootNarrowing = 1.0 - smoothstep(0.0, 0.22, y);
  float envelope = 1.08 - y * 1.0 - abs(warpedX) * (0.70 + max(y, 0.0) * 0.90 + rootNarrowing * 2.2);
  float field = envelope + (flowing - 0.5) * (1.06 + max(y, 0.0) * 0.38) + (fine - 0.5) * 0.40;
  float ground = smoothstep(-0.04, 0.10, y);
  float fire = smoothstep(-0.06, 0.10, field) * ground;
  float core = clamp(field * 1.58, 0.0, 1.0);
  float ripples = 0.91 + 0.09 * fine;

  vec3 col = mix(vec3(0.62, 0.09, 0.015), vec3(0.96, 0.28, 0.03), smoothstep(0.0, 0.44, core));
  col = mix(col, vec3(1.0, 0.58, 0.10), smoothstep(0.36, 0.82, core));
  col = mix(col, vec3(1.0, 0.88, 0.48), smoothstep(0.76, 1.0, core) * 0.72);

  vec3 goldHue = vec3(0.93, 0.68, 0.24);
  float coalMask = 1.0 - smoothstep(0.05, 0.55, core);
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  float goldLuma = max(dot(goldHue, vec3(0.299, 0.587, 0.114)), 0.001);
  vec3 goldTinted = goldHue * (luma / goldLuma);
  col = mix(col, goldTinted, u_golden * coalMask * 0.82);

  vec3 dormantCol = mix(vec3(0.38, 0.08, 0.02), vec3(0.82, 0.26, 0.05), smoothstep(0.0, 0.65, core));
  col = mix(col, dormantCol, u_dormant * 0.65);

  col = mix(col, vec3(1.0, 0.90, 0.62), u_surge * 0.35 * smoothstep(0.35, 0.95, core));
  col *= ripples;
  // Day paper tone: keep warm orange-amber saturation rich so it stands out on #f7f4ee
  col = mix(col, col * vec3(0.94, 0.72, 0.52), u_day * 0.32);

  float body = fire * (0.88 + (u_response + u_surge * 0.45) * 0.12);
  float glow = exp(-dot(vec2(x * 1.45, (y - 0.18) * 2.0), vec2(x * 1.45, (y - 0.18) * 2.0)) * 1.9) * 0.18 * ground;
  float alpha = clamp(body + glow * (1.0 - body), 0.0, 0.94);

  float textureBase = (0.72 + u_heat * 0.16) * size * (1.0 + (u_response + u_surge * 0.6) * 0.16) * dormantFactor;
  float textureHeight = textureBase * u_shapeHeight;
  float textureWidth = textureBase * u_shapeWidth;
  float tx = 0.5 + (uv.x - 0.5) * aspect / max(textureWidth * 1.15, 0.001);
  float ty = (uv.y - (u_shapeCenter - 0.32 * size * u_shapeHeight)) / max(textureHeight, 0.001);
  float lift = smoothstep(0.0, 0.35, ty);
  vec2 distortion = vec2((drift - 0.5) * 0.44 + sin(t * 1.45 + ty * 7.0) * 0.06,
                         (fine - 0.5) * 0.24 + sin(t * 1.25 + tx * 6.0) * 0.045) * lift;
  vec2 tex = vec2(tx, ty) + distortion;
  vec4 photo = vec4(0.0);
  if (tex.x > 0.0 && tex.x < 1.0 && tex.y > 0.0 && tex.y < 1.0) {
    photo = texture2D(u_flame, tex);
    photo.rgb = photo.a > 0.0001 ? photo.rgb / photo.a : vec3(0.0);
    float edgeFade = smoothstep(0.0, 0.05, tex.x) * (1.0 - smoothstep(0.95, 1.0, tex.x))
                   * smoothstep(0.0, 0.03, tex.y) * (1.0 - smoothstep(0.95, 1.0, tex.y));
    photo.a *= edgeFade;
  }

  float crossFlow = fbm(vec2(tx * 3.1 - 4.0, ty * 3.2 - t * 1.38));
  vec2 secondTex = vec2(0.5 + (tx - 0.5) * 1.12, ty * 1.08 + 0.035)
    + vec2((crossFlow - 0.5) * 0.26, (flowing - 0.5) * 0.13) * lift;
  vec4 second = vec4(0.0);
  if (secondTex.x > 0.0 && secondTex.x < 1.0 && secondTex.y > 0.0 && secondTex.y < 1.0) {
    second = texture2D(u_flame, secondTex);
    second.rgb = second.a > 0.0001 ? second.rgb / second.a : vec3(0.0);
    float secondEdgeFade = smoothstep(0.0, 0.05, secondTex.x) * (1.0 - smoothstep(0.95, 1.0, secondTex.x))
                         * smoothstep(0.0, 0.03, secondTex.y) * (1.0 - smoothstep(0.95, 1.0, secondTex.y));
    second.a *= secondEdgeFade;
  }

  float flicker = 0.88 + 0.12 * noise(vec2(tx * 4.0 + t, ty * 4.0 - t * 2.0));
  vec3 nightGrade = vec3(1.0, 0.84, 0.62);
  vec3 dayGrade = vec3(0.95, 0.62, 0.34);
  vec3 grade = mix(nightGrade, dayGrade, u_day);
  grade = mix(grade, vec3(0.88, 0.44, 0.22), u_dormant * 0.72);
  grade = mix(grade, vec3(0.98, 0.74, 0.28), u_golden * 0.35);

  vec3 photoColor = photo.rgb * grade * flicker;
  vec3 secondColor = second.rgb * grade * flicker;
  float photoAlpha = min(1.0, photo.a * (1.0 + (u_response + u_surge * 0.55) * 0.28)) * mix(0.94, 0.88, u_day) * (1.0 - u_dormant * 0.35) * u_textureReady;
  float secondAlpha = second.a * 0.30 * (1.0 - u_dormant * 0.35) * u_textureReady;
  float proceduralAlpha = alpha * mix(1.0, 0.18, u_textureReady);
  float combined = photoAlpha + secondAlpha * (1.0 - photoAlpha) + proceduralAlpha * (1.0 - photoAlpha) * (1.0 - secondAlpha);
  vec3 combinedColor = (photoColor * photoAlpha + secondColor * secondAlpha * (1.0 - photoAlpha)
    + col * proceduralAlpha * (1.0 - photoAlpha) * (1.0 - secondAlpha)) / max(combined, 0.0001);
  gl_FragColor = vec4(combinedColor, combined * u_shapeOpacity);
}
`;

const SPARK_VERTEX_SHADER = `
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

const SPARK_FRAGMENT_SHADER = `
precision mediump float;
varying float v_alpha;
varying vec3 v_col;
void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;
  float glow = smoothstep(0.5, 0.0, dist);
  gl_FragColor = vec4(v_col, v_alpha * glow);
}
`;

export function createFlameRenderer(
  canvas: HTMLCanvasElement,
  onTextureReady: () => void = () => {}
): FlameRenderer | null {
  const gl = (() => {
    try {
      return canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: false,
        powerPreference: "low-power",
      });
    } catch {
      return null;
    }
  })();
  if (!gl) return null;

  const compile = (kind: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(kind);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }

  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!program || !buffer || !texture) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }

  const sVs = compile(gl.VERTEX_SHADER, SPARK_VERTEX_SHADER);
  const sFs = compile(gl.FRAGMENT_SHADER, SPARK_FRAGMENT_SHADER);
  let sparksProgram: WebGLProgram | null = null;
  let sparksBuffer: WebGLBuffer | null = null;
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
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resolution = gl.getUniformLocation(program, "u_resolution");
  const time = gl.getUniformLocation(program, "u_time");
  const heat = gl.getUniformLocation(program, "u_heat");
  const size = gl.getUniformLocation(program, "u_size");
  const response = gl.getUniformLocation(program, "u_response");
  const day = gl.getUniformLocation(program, "u_day");
  const flame = gl.getUniformLocation(program, "u_flame");
  const textureReadyUniform = gl.getUniformLocation(program, "u_textureReady");
  const goldenUniform = gl.getUniformLocation(program, "u_golden");
  const dormantUniform = gl.getUniformLocation(program, "u_dormant");
  const surgeUniform = gl.getUniformLocation(program, "u_surge");
  const shapeWidthUniform = gl.getUniformLocation(program, "u_shapeWidth");
  const shapeHeightUniform = gl.getUniformLocation(program, "u_shapeHeight");
  const shapeOpacityUniform = gl.getUniformLocation(program, "u_shapeOpacity");
  const shapeCenterUniform = gl.getUniformLocation(program, "u_shapeCenter");

  let textureReady = false;
  let disposed = false;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0])
  );

  const image = new window.Image();
  image.onload = () => {
    if (disposed || gl.isContextLost()) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
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
      image.onload(new Event("load"));
    } catch {
      // handled asynchronously
    }
  }

  const MAX_SPARKS = 140;
  const sparks: Spark[] = [];
  const sparkData = new Float32Array(MAX_SPARKS * 7);
  let lastTime = 0;
  let lastAmbientSpark = 0;

  const pushSpark = (burst: boolean, goldenRatio: number) => {
    if (sparks.length >= MAX_SPARKS) {
      sparks.shift();
    }
    const kind = Math.random();
    const isGold = goldenRatio > 0.4 || kind < 0.45;
    sparks.push({
      x: (Math.random() - 0.5) * (burst ? 0.34 : 0.24),
      y: -0.68 + (Math.random() - 0.5) * 0.14,
      vx: (Math.random() - 0.5) * (burst ? 0.28 : 0.12),
      vy: (burst ? 0.52 : 0.34) + Math.random() * (burst ? 0.68 : 0.36),
      size: (burst ? 7.5 : 5.5) + Math.random() * (burst ? 9.5 : 6.5),
      alpha: burst ? 0.96 : 0.86,
      life: (burst ? 1.5 : 1.7) + Math.random() * 0.9,
      maxLife: (burst ? 1.5 : 1.7) + Math.random() * 0.9,
      r: isGold ? 0.96 : 0.92,
      g: isGold ? 0.56 + Math.random() * 0.18 : 0.3 + Math.random() * 0.14,
      b: isGold ? 0.12 : 0.04,
      sway: Math.random() * Math.PI * 2,
    });
  };

  const triggerSparks = (count = 28) => {
    if (disposed || gl.isContextLost()) return;
    const addCount = Math.min(Math.max(1, count), 48);
    for (let i = 0; i < addCount; i++) {
      pushSpark(true, 0.3);
    }
  };

  const resize = () => {
    if (disposed || gl.isContextLost()) return;
    const factor = Math.min(1, 900 / Math.max(1, canvas.clientWidth));
    const width = Math.max(1, Math.round(canvas.clientWidth * factor));
    const height = Math.max(1, Math.round(canvas.clientHeight * factor));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  };

  const draw = (frame: FlameFrame, shape: FlameShape) => {
    if (disposed || gl.isContextLost()) return;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const focusVal = frame.focus ?? 0;
    gl.uniform2f(resolution, canvas.width, canvas.height);
    gl.uniform1f(time, frame.time);
    gl.uniform1f(heat, frame.heat);
    gl.uniform1f(size, frame.size);
    gl.uniform1f(response, Math.max(0, Math.min(1, focusVal + frame.pulse + frame.waiting)));
    gl.uniform1f(day, frame.day);
    gl.uniform1f(goldenUniform, frame.golden ?? 0);
    gl.uniform1f(dormantUniform, frame.dormant ?? 0);
    gl.uniform1f(surgeUniform, frame.surge ?? 0);
    gl.uniform1f(shapeWidthUniform, shape.width);
    gl.uniform1f(shapeHeightUniform, shape.height);
    gl.uniform1f(shapeOpacityUniform, shape.opacity);
    gl.uniform1f(shapeCenterUniform, shape.center);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(flame, 0);
    gl.uniform1f(textureReadyUniform, textureReady ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const dt = lastTime > 0 ? Math.min(0.08, Math.max(0, frame.time - lastTime)) : 0.016;
    lastTime = frame.time;

    const interval = Math.max(0.24, shape.sparkInterval * (frame.waiting > 0.05 ? 0.65 : 1));
    if (frame.time - lastAmbientSpark > interval) {
      lastAmbientSpark = frame.time;
      pushSpark(false, frame.golden ?? 0);
    }

    if (sparksProgram && sparksBuffer && sparks.length > 0) {
      let activeCount = 0;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dt;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.y += s.vy * dt;
        s.x += s.vx * dt + Math.sin(frame.time * 3.8 + s.sway) * 0.0028;
        s.vy *= 0.988;
        s.vx *= 0.985;
        const fade = Math.pow(Math.max(0, s.life / s.maxLife), 1.3);
        s.alpha = fade * Math.min(1.0, (s.maxLife - s.life) / 0.14);

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

        const sPos = gl.getAttribLocation(sparksProgram, "a_spark_pos");
        const sSize = gl.getAttribLocation(sparksProgram, "a_spark_size");
        const sAlpha = gl.getAttribLocation(sparksProgram, "a_spark_alpha");
        const sCol = gl.getAttribLocation(sparksProgram, "a_spark_col");

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
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
      image.onerror = null;
      sparks.length = 0;
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.useProgram(null);
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
