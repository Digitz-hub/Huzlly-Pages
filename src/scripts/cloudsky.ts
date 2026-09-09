// src/scripts/cloudsky.ts
//
// Vanilla WebGL port of the "Cloud Sky" Originkit/React component (see
// cloud-sky-preview.html) — a layered, drifting cumulus-and-cirrus sky
// rendered as a single fullscreen-triangle fragment shader. This project
// has no React, so only the actual rendering algorithm was kept:
// `parseColor`, the shader `compile`/link setup, the fullscreen-triangle
// buffer, and the per-frame uniform-update/draw loop. Everything
// React-specific (props, `useRef`/`useEffect`, preset/prop merging) was
// stripped.
//
// There's no control panel here, so the reference's resolved values
// (its base component defaults merged with its `__originkitPresetProps`
// override, with no further overrides) are hard-coded below as constants
// instead of being passed in as props. The reference's `pointer`
// (wind/damping/parallax) props are dead code for this visual — its own
// render loop hardcodes `uParallax` to `(0, 0)` and never wires up
// pointer tracking — so no pointer/mouse handling was ported either.
//
// USAGE (same cleanup-function convention as starfield.ts / lenis.ts):
//   import { initCloudSky } from '../../scripts/cloudsky';
//   const cleanup = initCloudSky(canvasEl);
//   // ...later, if ever needed: cleanup();

// ---- Hard-coded configuration (reference file's shader-tuning constants) ----
const MAX_DPR = 2;

const PUFF_UP = 0.34; // ellipse radius above the puff centre
const PUFF_DOWN = 0.19; // ...and below it. The gap IS the flat cumulus base.
const ERODE = 0.7; // how hard the fbm eats into the blob edge
const SHADOW_STEP = 0.085; // how far above a pixel the self-shadow samples
const NEAR_CELL = 1.05; // cells across the short side, near layer
const FAR_CELL = 2.15; // ...and far layer
const FAR_MIX = 0.55; // aerial perspective: far cloud mixed toward the sky
const NEAR_DRIFT = 0.055; // cells/sec at Speed 50
const FAR_DRIFT = 0.026;
const CIRRUS_DRIFT = 0.014;
const PUFF_WMAX = 2.15;
const SHADE_BLEND = 12.0;

// ---- Hard-coded resolved uniform values (reference's own preset defaults) ----
const U_COVERAGE = 1.0;
const U_SIZE = 1.3;
const U_SOFTNESS = 2.25;
const U_SHADOW = 0.7;
const U_CIRRUS = 1.0;
const U_SUN: [number, number] = [1.0, 1.0];
const U_ZENITH = '#0075FF'; // background
const U_HORIZON = '#B4D2F0'; // baseColor
const U_CLOUD = '#FFFFFF'; // accentColor
const RATE = 0.8; // speed rate multiplier (same role as starfield's rate)

const VERT_SRC = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;
uniform float uNearX, uFarX, uCirrusX;
uniform float uCoverage, uSize, uSoftness, uShadow, uCirrus;
uniform vec3 uZenith, uHorizon, uCloud;
uniform vec4 uGlow;
uniform vec2 uSun;
uniform vec2 uParallax;

vec2 hash22(vec2 p){
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

float hash12(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 x){
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++){
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

vec2 blobs(vec2 uv, float seed){
  vec2 id = floor(uv), f = fract(uv);
  float best = -1e4;
  float wsum = 0.0, ysum = 0.0;
  float wMax = min(${PUFF_WMAX.toFixed(3)}, 0.72 * uSize);
  float reach = min(2.0, ceil(wMax + 0.85) - 1.0);
  for (int j = -2; j <= 2; j++){
    for (int i = -2; i <= 2; i++){
      vec2 o = vec2(float(i), float(j));
      if (max(abs(o.x), abs(o.y)) > reach) continue;
      vec2 h = hash22(id + o + seed);
      if (fract(h.x * 37.1) > uCoverage) continue;
      vec2 c = o + 0.15 + h * 0.7;
      float w = min(${PUFF_WMAX.toFixed(3)}, (0.30 + 0.42 * fract(h.y * 19.7)) * uSize);
      vec2 d = f - c;
      float ry = (d.y > 0.0 ? ${PUFF_UP.toFixed(3)} : ${PUFF_DOWN.toFixed(3)}) * uSize * (0.8 + 0.5 * fract(h.y * 7.3));
      float e = length(vec2(d.x / max(w, 1e-3), d.y / max(ry, 1e-3)));
      float val = 1.0 - e;
      float yN = d.y / max(ry, 1e-3);
      if (val > best){
        float k = exp(${SHADE_BLEND.toFixed(1)} * (best - val));
        wsum = wsum * k + 1.0;
        ysum = ysum * k + yN;
        best = val;
      } else {
        float g = exp(${SHADE_BLEND.toFixed(1)} * (val - best));
        wsum += g;
        ysum += g * yN;
      }
    }
  }
  return vec2(best, ysum / max(wsum, 1e-4));
}

vec2 cloudField(vec2 uv, float seed, float detailScale){
  vec2 b = blobs(uv, seed);
  float n = fbm(uv * detailScale + seed * 3.1) * 0.72
          + fbm(uv * detailScale * 3.3 + seed * 7.7) * 0.28;
  return vec2(b.x - (1.0 - n) * ${ERODE.toFixed(3)}, b.y);
}

vec3 shadeCloud(float dyNorm, vec3 sky){
  float t = smoothstep(-0.95, 0.25, dyNorm);
  vec3 base = mix(uCloud * 0.52, sky, 0.34);
  return mix(mix(uCloud, base, uShadow), uCloud, t);
}

void main(){
  vec2 frag = gl_FragCoord.xy / max(uRes.y, 1.0);
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = vec2(frag.x, frag.y);

  vec3 sky = mix(uHorizon, uZenith, smoothstep(-0.15, 1.05, p.y));
  vec2 sunP = vec2(uSun.x * aspect, uSun.y);
  float sd = length(p - sunP);
  sky += uGlow.rgb * uGlow.a * exp(-sd * 3.4) * 0.30;

  vec3 col = sky;

  if (uCirrus > 0.0) {
    vec2 cuv = vec2(p.x * 1.4 + uCirrusX, p.y * 5.5);
    float veil = fbm(cuv) * fbm(cuv * 2.3 + 9.0);
    veil = smoothstep(0.24, 0.55, veil) * smoothstep(0.15, 0.7, p.y);
    col = mix(col, uCloud, veil * uCirrus * 0.5);
  }

  vec2 fuv = vec2(p.x + uFarX, p.y) * ${FAR_CELL.toFixed(3)} + uParallax * 0.4;
  vec2 fd = cloudField(fuv, 17.0, 11.0);
  float fa = clamp(fd.x * uSoftness, 0.0, 1.0);
  if (fa > 0.0) {
    vec3 lit = shadeCloud(fd.y, sky);
    col = mix(col, mix(lit, sky, ${FAR_MIX.toFixed(3)}), fa);
  }

  vec2 nuv = vec2(p.x + uNearX, p.y) * ${NEAR_CELL.toFixed(3)} + uParallax;
  vec2 nd = cloudField(nuv, 3.0, 8.5);
  float na = clamp(nd.x * uSoftness, 0.0, 1.0);
  if (na > 0.0) {
    vec3 lit = shadeCloud(nd.y, sky);
    float above = clamp(cloudField(nuv + vec2(0.0, ${SHADOW_STEP.toFixed(3)}), 3.0, 8.5).x * uSoftness, 0.0, 1.0);
    lit *= 1.0 - 0.18 * uShadow * above;
    lit += uGlow.rgb * uGlow.a * 0.22 * exp(-length(p - sunP) * 1.6);
    col = mix(col, lit, na);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

type RGBA = [number, number, number, number];

// Pure utility — module scope, never re-created. Ported as-is from the
// reference's `parseColor` (hex + rgba() string parsing, normalized 0-1).
function parseColor(input: string, fallback: RGBA): RGBA {
  if (!input) return fallback;
  const str = input.trim();
  if (str.charAt(0) === '#') {
    let hex = str.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + (hex.length === 4 ? hex[3] + hex[3] : '');
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return [r / 255, g / 255, b / 255, a];
    }
    return fallback;
  }
  const m = str.match(/[\d.]+/g);
  if (m && m.length >= 3) {
    return [
      Math.min(255, parseFloat(m[0])) / 255,
      Math.min(255, parseFloat(m[1])) / 255,
      Math.min(255, parseFloat(m[2])) / 255,
      m.length >= 4 ? Math.min(1, parseFloat(m[3])) : 1,
    ];
  }
  return fallback;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('CloudSky shader:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * Initializes the Cloud Sky WebGL background on the given canvas element
 * and drives it via its own `requestAnimationFrame` loop.
 *
 * Respects `prefers-reduced-motion: reduce`: draws a single settled-
 * looking static frame and stops, rather than continuously animating.
 *
 * @returns A cleanup function that cancels the rAF loop and disconnects
 *   the ResizeObserver, mirroring the `cleanup-function` convention used
 *   by `starfield.ts` / `lenis.ts`.
 */
export function initCloudSky(canvas: HTMLCanvasElement): () => void {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
  if (!gl) {
    console.error('CloudSky: WebGL unavailable');
    return () => {};
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return () => {};

  const prog = gl.createProgram();
  if (!prog) return () => {};
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('CloudSky link:', gl.getProgramInfoLog(prog));
    return () => {};
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const locs: Record<string, WebGLUniformLocation | null> = {};
  const u = (name: string) => {
    if (!(name in locs)) locs[name] = gl.getUniformLocation(prog, name);
    return locs[name];
  };

  // Resolved colors, parsed once — the reference re-parses every frame
  // to react to prop changes, but nothing here is ever reactive.
  const zen = parseColor(U_ZENITH, [0.369, 0.576, 0.824, 1]);
  const hor = parseColor(U_HORIZON, [0.706, 0.824, 0.941, 1]);
  const cld = parseColor(U_CLOUD, [1, 1, 1, 1]);
  const glow: RGBA = [1, 1, 1, 1];

  // Static uniforms — set once, never change without a control panel.
  gl.uniform1f(u('uCoverage'), U_COVERAGE);
  gl.uniform1f(u('uSize'), U_SIZE);
  gl.uniform1f(u('uSoftness'), U_SOFTNESS);
  gl.uniform1f(u('uShadow'), U_SHADOW);
  gl.uniform1f(u('uCirrus'), U_CIRRUS);
  gl.uniform2f(u('uSun'), U_SUN[0], U_SUN[1]);
  gl.uniform2f(u('uParallax'), 0, 0);
  gl.uniform3f(u('uZenith'), zen[0], zen[1], zen[2]);
  gl.uniform3f(u('uHorizon'), hor[0], hor[1], hor[2]);
  gl.uniform3f(u('uCloud'), cld[0], cld[1], cld[2]);
  gl.uniform4f(u('uGlow'), glow[0], glow[1], glow[2], glow[3]);

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const sizeRef = { w: 0, h: 0, dpr: 1 };

  const resize = (entry?: ResizeObserverEntry) => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const cr = entry?.contentRect;
    const rectW = cr?.width || canvas.parentElement?.clientWidth || canvas.getBoundingClientRect().width;
    const rectH = cr?.height || canvas.parentElement?.clientHeight || canvas.getBoundingClientRect().height;
    const w = Math.max(1, Math.floor(rectW) || 1200);
    const h = Math.max(1, Math.floor(rectH) || 800);

    const prev = sizeRef;
    if (prev.w === w && prev.h === h && prev.dpr === dpr) return;

    sizeRef.w = w;
    sizeRef.h = h;
    sizeRef.dpr = dpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u('uRes'), canvas.width, canvas.height);
  };

  resize();

  const container = canvas.parentElement;
  const ro = new ResizeObserver((entries) => resize(entries[0]));
  if (container) ro.observe(container);

  let nearX = 0;
  let farX = 0;
  let cirrusX = 0;

  const drawFrame = (dt: number) => {
    nearX = (nearX - NEAR_DRIFT * RATE * dt) % 1000;
    farX = (farX - FAR_DRIFT * RATE * dt) % 1000;
    cirrusX = (cirrusX - CIRRUS_DRIFT * RATE * dt) % 1000;

    gl.uniform1f(u('uNearX'), nearX);
    gl.uniform1f(u('uFarX'), farX);
    gl.uniform1f(u('uCirrusX'), cirrusX);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  let rafId: number | null = null;

  if (prefersReducedMotion) {
    // Draw a single settled-looking static frame and stop — no
    // animation loop.
    drawFrame(0);
    return () => {
      ro.disconnect();
    };
  }

  let lastT = performance.now();
  const loop = (t: number) => {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    drawFrame(dt);
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  return () => {
    if (rafId != null) cancelAnimationFrame(rafId);
    ro.disconnect();
  };
}
