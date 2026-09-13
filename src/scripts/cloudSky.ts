// src/scripts/cloudSky.ts
//
// Vanilla WebGL port of the "Cloud Sky" Originkit/Framer component
// (see cloud-sky-preview.html) — an animated cumulus/cirrus sky shader
// rendered as a single full-viewport triangle. This project has no
// React and no Framer runtime, so only the actual WebGL setup and the
// vertex/fragment shader algorithm were kept: `compile`, `parseColor`,
// the uniform-driven per-frame render loop, and the near/far/cirrus
// drift math. Everything React-specific (props, useRef, useEffect, the
// `__OriginkitBase_CloudSky` / `CloudSky` wrapper split) and everything
// tied to a props/control-panel system was stripped, following the same
// approach used for `starfield.ts`'s "Glitter Wrap" port.
//
// There's no control panel here, so the reference's resolved defaults
// (its base component defaults merged with its own
// `__originkitPresetProps` override) are hard-coded below as constants
// instead of being passed in as props — see the two-tier
// PROP-LEVEL-CONSTANTS -> `CFG` derivation, which mirrors the source's
// own `{ ...defaults, ...clouds }` / `{ ...defaults, ...sun }` merges
// followed by its `clampN`/`num`-based scaling in `vRef.current`.
//
// `uParallax` is hardcoded to `(0, 0)` every frame below because that's
// what the source itself does — `cloud-sky-preview.html` never wires up
// any pointer/mouse listener to `pointer.parallax`/`wind`/`damping`, so
// those three resolved values are dead in the original and are not
// reproduced here.
//
// Sizing follows `starfield.ts`'s approach (a `ResizeObserver` on
// `canvas.parentElement`, DPR-aware backing-buffer sizing capped at the
// source's own `MAX_DPR`) instead of the original's `width`/`height`
// props, which don't exist in this vanilla context.
//
// USAGE (same cleanup-function convention as `starfield.ts`/`lenis.ts`):
//   import { initCloudSky } from '../../scripts/cloudSky';
//   const cleanup = initCloudSky(canvasEl);
//   // ...later, if ever needed: cleanup();

// ---- Constants carried verbatim from the reference shader/algorithm ----
const MAX_DPR = 2;

// Found on a parameter grid; the look depends on these, so they are named.
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

// Pure utility — module scope, never re-created. Verbatim from the
// reference (generic hex/`rgb[a]()` string parser with a fallback).
function parseColor(input: string | undefined, fb: RGBA): RGBA {
  if (!input) return fb;
  const str = String(input).trim();
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
    return fb;
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
  return fb;
}

function num(v: unknown, fb: number): number {
  return typeof v === 'number' && isFinite(v) ? v : fb;
}

function clampN(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
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

// ---- Resolved config (reference file's defaults merged with its own
// `__originkitPresetProps`, read directly from cloud-sky-preview.html) ----
//
// Prop-level values, after `{ ...__OriginkitBase_CloudSky defaults,
// ...__originkitPresetProps }` — every field below is overridden by the
// preset except BACKGROUND/BASE_COLOR/ACCENT_COLOR/DENSITY/SIZE, which
// the preset never touches and which fall through to the component's
// own defaults.
const BACKGROUND = '#0075FF'; // background default (untouched by preset)
const BASE_COLOR = '#B4D2F0'; // baseColor default (untouched by preset)
const ACCENT_COLOR = '#FFFFFF'; // accentColor default (untouched by preset)
const DENSITY = 100; // density default (untouched by preset)
const SPEED = 40; // preset override (default was 64)
const SIZE = 130; // size default (untouched by preset)
const CLOUD_SOFTNESS = 200; // preset clouds.softness override (default 100)
const CLOUD_SHADOW = 70; // preset clouds.shadow override (default 100)
const CLOUD_CIRRUS = 100; // preset clouds.cirrus override (default 45)
const SUN_X = 100; // preset sun.x override (default 78)
const SUN_Y = 100; // preset sun.y override (default 92)
const SUN_GLOW = '#FFFFFF'; // preset sun.glow override (default "rgba(232, 243, 255, 0.9)")
//
// The preset also overrides `pointer.parallax`/`wind`/`damping` (to 300,
// 300, 50), but those three resolved values are never read anywhere in
// the reference's render loop — `uParallax` is hardcoded to `(0, 0)`
// regardless of `v.parallax`, and nothing reads `v.wind`/`v.damping` at
// all — so they're intentionally not reproduced here.

// Resolved, pre-scaled config derived from the constants above — mirrors
// the reference's own `vRef.current` derivation (its `clampN`/`num`
// calls applied to the merged prop values).
const CFG = {
  zenith: BACKGROUND,
  horizon: BASE_COLOR,
  cloud: ACCENT_COLOR,
  glow: SUN_GLOW,
  coverage: clampN(num(DENSITY, 55), 0, 100) / 100,
  speed: clampN(num(SPEED, 50), 0, 100) / 50,
  size: clampN(num(SIZE, 100), 20, 300) / 100,
  softness: 4.5 / Math.max(0.15, clampN(num(CLOUD_SOFTNESS, 100), 20, 300) / 100),
  shadow: clampN(num(CLOUD_SHADOW, 100), 0, 200) / 100,
  cirrus: clampN(num(CLOUD_CIRRUS, 45), 0, 100) / 100,
  sunX: clampN(num(SUN_X, 78), 0, 100) / 100,
  sunY: clampN(num(SUN_Y, 92), 0, 100) / 100,
};

const DEFAULT_ZENITH: RGBA = [0.369, 0.576, 0.824, 1];
const DEFAULT_HORIZON: RGBA = [0.706, 0.824, 0.941, 1];
const DEFAULT_CLOUD: RGBA = [1, 1, 1, 1];
const DEFAULT_GLOW: RGBA = [0.91, 0.953, 1, 0.9];

/**
 * Initializes the CloudSky WebGL shader animation on the given canvas
 * element and drives it via its own `requestAnimationFrame` loop.
 *
 * Respects `prefers-reduced-motion: reduce`: renders a settled-looking
 * frame (the drift loop advanced a little, same as the shader would
 * look mid-animation) and stops, rather than continuously animating.
 *
 * @returns A cleanup function that cancels the rAF loop and disconnects
 *   the ResizeObserver, mirroring the reference component's own
 *   `useEffect` cleanup and the convention used by `starfield.ts`.
 */
export function initCloudSky(canvas: HTMLCanvasElement): () => void {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false }) as WebGLRenderingContext | null;
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

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sizing follows starfield.ts's ResizeObserver-driven approach instead
  // of the reference's width/height props, which don't exist here.
  const sizeRef = { w: 0, h: 0 };
  const resize = (entry?: ResizeObserverEntry) => {
    const cr = entry?.contentRect;
    const rectW = cr?.width || canvas.parentElement?.clientWidth || canvas.getBoundingClientRect().width;
    const rectH = cr?.height || canvas.parentElement?.clientHeight || canvas.getBoundingClientRect().height;
    sizeRef.w = Math.max(1, Math.floor(rectW) || 1200);
    sizeRef.h = Math.max(1, Math.floor(rectH) || 800);
  };
  resize();

  const container = canvas.parentElement;
  const ro = new ResizeObserver((entries) => resize(entries[0]));
  if (container) ro.observe(container);

  let nearX = 0;
  let farX = 0;
  let cirrusX = 0;

  const drawFrame = (dt: number) => {
    const rate = CFG.speed;
    nearX = (nearX - NEAR_DRIFT * rate * dt) % 1000;
    farX = (farX - FAR_DRIFT * rate * dt) % 1000;
    cirrusX = (cirrusX - CIRRUS_DRIFT * rate * dt) % 1000;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const cw = sizeRef.w || canvas.clientWidth || 1200;
    const ch = sizeRef.h || canvas.clientHeight || 800;
    const bw = Math.max(1, Math.round(cw * dpr));
    const bh = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    gl.viewport(0, 0, bw, bh);

    const zen = parseColor(CFG.zenith, DEFAULT_ZENITH);
    const hor = parseColor(CFG.horizon, DEFAULT_HORIZON);
    const cld = parseColor(CFG.cloud, DEFAULT_CLOUD);
    const glow = parseColor(CFG.glow, DEFAULT_GLOW);

    gl.uniform2f(u('uRes'), bw, bh);
    gl.uniform1f(u('uNearX'), nearX);
    gl.uniform1f(u('uFarX'), farX);
    gl.uniform1f(u('uCirrusX'), cirrusX);
    gl.uniform1f(u('uCoverage'), CFG.coverage);
    gl.uniform1f(u('uSize'), CFG.size);
    gl.uniform1f(u('uSoftness'), CFG.softness);
    gl.uniform1f(u('uShadow'), CFG.shadow);
    gl.uniform1f(u('uCirrus'), CFG.cirrus);
    gl.uniform2f(u('uSun'), CFG.sunX, CFG.sunY);
    // No pointer/mouse listener exists in the source — uParallax is
    // hardcoded to (0, 0) every frame there too, so it is here as well.
    gl.uniform2f(u('uParallax'), 0, 0);
    gl.uniform3f(u('uZenith'), zen[0], zen[1], zen[2]);
    gl.uniform3f(u('uHorizon'), hor[0], hor[1], hor[2]);
    gl.uniform3f(u('uCloud'), cld[0], cld[1], cld[2]);
    gl.uniform4f(u('uGlow'), glow[0], glow[1], glow[2], glow[3]);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  if (prefersReducedMotion) {
    // Draw a settled-looking frame and stop — no animation loop. Advance
    // the drift a little first so it doesn't look like frame zero.
    for (let i = 0; i < 80; i++) drawFrame(1 / 60);
    return () => {
      ro.disconnect();
    };
  }

  let rafId = 0;
  let lastT = performance.now();
  const loop = (t: number) => {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    drawFrame(dt);
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(rafId);
    ro.disconnect();
  };
}
