import flameTextureUrl from '../assets/living-fire.png';

/** A single transparent, bounded fire field. It contains no application data. */
export interface FlameFrame {
  time: number;
  heat: number;
  size: number;
  attention: number;
  pulse: number;
  waiting: number;
  day: number;
}

export interface FlameRenderer {
  resize: () => void;
  draw: (frame: FlameFrame) => void;
  dispose: () => void;
}

const vertex = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

// Advected, multi-scale turbulence forms the flame itself; nothing is painted
// at the room's edges. Alpha makes the same fire work on white and black.
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
  float height = (0.58 + u_heat * 0.16) * size;
  float width = (0.235 + u_heat * 0.065) * size;
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
  col *= ripples;
  // On white, an amber edge remains legible rather than disappearing into white.
  col = mix(col, col * vec3(0.88, 0.71, 0.68), u_day * 0.28);
  float body = fire * (0.90 + u_response * 0.10);
  float glow = exp(-dot(vec2(x * 1.5, (y - 0.20) * 2.15), vec2(x * 1.5, (y - 0.20) * 2.15)) * 2.0) * 0.12 * ground;
  float alpha = clamp(body + glow * (1.0 - body), 0.0, 0.93);
  vec3 glowColor = vec3(0.88, 0.20, 0.025);
  col = mix(glowColor, col, fire);
  // A photo-like flame texture is continuously advected by the same
  // rising turbulence. Procedural wisps add motion between its fine filaments.
  float textureHeight = (0.68 + u_heat * 0.14) * size * (1.0 + u_response * 0.14);
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
  // A second, offset current moves independently through the first: the
  // outline and inner strands keep changing rather than moving as one picture.
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
  vec3 nightGrade = vec3(1.0, 0.83, 0.66);
  vec3 dayGrade = vec3(0.90, 0.77, 0.69);
  vec3 grade = mix(nightGrade, dayGrade, u_day);
  vec3 photoColor = photo.rgb * grade * flicker;
  vec3 secondColor = second.rgb * grade * flicker;
  float photoAlpha = min(1.0, photo.a * (1.0 + u_response * 0.25)) * mix(0.94, 0.90, u_day) * u_textureReady;
  float secondAlpha = second.a * 0.26 * u_textureReady;
  float proceduralAlpha = alpha * mix(1.0, 0.035, u_textureReady);
  float combined = photoAlpha + secondAlpha * (1.0 - photoAlpha) + proceduralAlpha * (1.0 - photoAlpha) * (1.0 - secondAlpha);
  vec3 combinedColor = (photoColor * photoAlpha + secondColor * secondAlpha * (1.0 - photoAlpha)
    + col * proceduralAlpha * (1.0 - photoAlpha) * (1.0 - secondAlpha)) / max(combined, 0.0001);
  gl_FragColor = vec4(combinedColor, combined);
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
  let textureReady = false;
  let disposed = false;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
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
  const resize = () => {
    // Limit the fragment workload on high-DPI desktops.
    const factor = Math.min(1, 900 / Math.max(1, canvas.clientWidth));
    const width = Math.max(1, Math.round(canvas.clientWidth * factor));
    const height = Math.max(1, Math.round(canvas.clientHeight * factor));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
  };
  const draw = (frame: FlameFrame) => {
    if (gl.isContextLost()) return;
    gl.useProgram(program);
    gl.uniform2f(resolution, canvas.width, canvas.height);
    gl.uniform1f(time, frame.time);
    gl.uniform1f(heat, frame.heat);
    gl.uniform1f(size, frame.size);
    gl.uniform1f(response, Math.max(0, Math.min(1, frame.attention + frame.pulse + frame.waiting)));
    gl.uniform1f(day, frame.day);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(flame, 0); gl.uniform1f(textureReadyUniform, textureReady ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  return { resize, draw, dispose: () => { disposed = true; image.onload = null; gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs); } };
}
