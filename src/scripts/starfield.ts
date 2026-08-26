// src/scripts/starfield.ts
//
// Vanilla canvas port of the "Glitter Wrap" Originkit/Framer component
// (see GlitterWrap-reference.tsx) — an animated starfield warp-tunnel
// with glittering sparkle flashes. This project has no React and no
// Framer runtime, so only the actual simulation/rendering algorithm was
// kept: `parseColor`, the `Star` type and its physics (`resetStar`, the
// per-frame update/respawn logic, turbulence, glitter flash timing,
// trail fade via `destination-out` compositing, additive `lighter`
// blending), and the resize/`ResizeObserver` handling. Everything
// Framer-specific (the `RenderTarget` mock, the export/thumbnail static-
// render branch, the `@framerSupportedLayoutWidth`-style annotations)
// and everything React-specific (props/useRef/useEffect) was stripped.
//
// There's no control panel here, so the reference's resolved defaults
// (its base `COMPONENT_DEFAULTS` merged with its `__originkitPresetProps`
// override) are hard-coded below as constants instead of being passed in
// as props.
//
// USAGE (same cleanup-function convention as `lenis.ts`):
//   import { initStarfield } from '../../scripts/starfield';
//   const cleanup = initStarfield(canvasEl);
//   // ...later, if ever needed: cleanup();

// ---- Hard-coded configuration (reference file's resolved defaults) ----
const PARTICLE_COUNT = 1000;
const COLOR_1 = '#ffffff';
const COLOR_2 = '#ffffff';
const COLOR_3 = '#ffffff';
const SPEED = 2;
const DENSITY = 100;
const STAR_SIZE = 5;
const FOCAL_DEPTH = 14;
const TURBULENCE = 0;
const BRIGHTNESS = 100;
const GLITTER_INTENSITY = 2;
const TRAIL_AMOUNT = 70;
const REVERSE = true;

type RGBA = [number, number, number, number];

// Pure utility — module scope, never re-created.
function parseColor(input: string): RGBA {
  if (!input) return [255, 255, 255, 1];
  const s = input.trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }
    const num = parseInt(hex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255, 1];
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] == null ? 1 : parts[3]];
  }
  return [255, 255, 255, 1];
}

type Star = {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  seed: number;
  vmul: number;
  colorIdx: number;
  flashUntil: number;
  nextFlash: number;
};

// Resolved, pre-scaled config derived from the hard-coded constants
// above — mirrors the reference's `cfg()` closure.
const CFG = {
  reverse: REVERSE,
  density: DENSITY,
  stepZ: SPEED * 0.0008,
  focalDepth: FOCAL_DEPTH / 100,
  starScale: STAR_SIZE * 0.15,
  turbulence: TURBULENCE * 0.2,
  glitter: GLITTER_INTENSITY * 0.1,
  brightness: Math.min(1, BRIGHTNESS / 100),
  trail: TRAIL_AMOUNT / 100,
};

const PALETTE: RGBA[] = [parseColor(COLOR_1), parseColor(COLOR_2), parseColor(COLOR_3)];
const RGB_STRS = PALETTE.map((c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`);

/**
 * Initializes the starfield animation on the given canvas element and
 * drives it via its own `requestAnimationFrame` loop.
 *
 * Respects `prefers-reduced-motion: reduce`: draws a single static frame
 * and stops, rather than continuously animating.
 *
 * @returns A cleanup function that cancels the rAF loop and disconnects
 *   the ResizeObserver, mirroring the reference component's own cleanup
 *   and the `cleanup-function` convention used by `lenis.ts`.
 */
export function initStarfield(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stars: Star[] = [];
  let elapsed = 0;
  let lastT = performance.now();
  const sizeRef = { w: 0, h: 0, dpr: 1 };

  const resetStar = (s: Star, initial = false) => {
    const { density, reverse, focalDepth, glitter } = CFG;
    const angle = Math.random() * Math.PI * 2;
    const radius = (0.2 + Math.random() * 0.8) * (density / 15);
    s.x = Math.cos(angle) * radius;
    s.y = Math.sin(angle) * radius;
    if (reverse) {
      s.z = initial ? focalDepth + Math.random() * (1 - focalDepth) : focalDepth;
    } else {
      s.z = initial ? Math.random() : 1.0;
    }
    s.px = NaN;
    s.py = NaN;
    s.seed = Math.random() * 1000;
    s.vmul = 0.6 + Math.random() * 0.8;
    s.colorIdx = Math.floor(Math.random() * 3);
    s.flashUntil = 0;
    s.nextFlash = elapsed + 1 + Math.random() * 4 * (1 / Math.max(0.0001, glitter));
  };

  const makeStar = (): Star => ({
    x: 0,
    y: 0,
    z: 0,
    px: NaN,
    py: NaN,
    seed: 0,
    vmul: 1,
    colorIdx: 0,
    flashUntil: 0,
    nextFlash: 0,
  });

  const syncCount = () => {
    const count = Math.max(1, Math.floor(PARTICLE_COUNT));
    if (stars.length === count) return;
    if (stars.length > count) {
      stars.length = count;
    } else {
      while (stars.length < count) {
        const s = makeStar();
        resetStar(s, true);
        stars.push(s);
      }
    }
  };

  const resize = (entry?: ResizeObserverEntry) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cr = entry?.contentRect;
    const rectW = cr?.width || canvas.parentElement?.clientWidth || canvas.getBoundingClientRect().width;
    const rectH = cr?.height || canvas.parentElement?.clientHeight || canvas.getBoundingClientRect().height;
    const w = Math.max(1, Math.floor(rectW) || 600);
    const h = Math.max(1, Math.floor(rectH) || 400);

    const prev = sizeRef;
    if (prev.w === w && prev.h === h && prev.dpr === dpr) return;

    sizeRef.w = w;
    sizeRef.h = h;
    sizeRef.dpr = dpr;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
  };

  syncCount();
  resize();

  const container = canvas.parentElement;
  const ro = new ResizeObserver((entries) => resize(entries[0]));
  if (container) ro.observe(container);

  const drawFrame = (deltaSec: number) => {
    const { reverse, stepZ, focalDepth, starScale, turbulence, glitter, brightness, trail } = CFG;

    syncCount();

    const { w, h } = sizeRef;
    const cx = w / 2;
    const cy = h / 2;
    const projScale = Math.min(w, h) * 0.9;

    const dt = Math.max(0.001, Math.min(0.1, deltaSec)) * 60;

    const keep = Math.pow(Math.min(0.98, Math.max(0, trail)), dt);
    const trailAlpha = Math.max(0.02, 1 - keep);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0, 0, 0, ${trailAlpha})`;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];

      const vz = stepZ * s.vmul * dt;
      if (reverse) {
        s.z += vz;
        if (s.z >= 1.0) {
          resetStar(s);
          continue;
        }
      } else {
        s.z -= vz;
        if (s.z <= focalDepth) {
          resetStar(s);
          continue;
        }
      }

      let tx = s.x;
      let ty = s.y;
      if (turbulence > 0) {
        const t = elapsed * 1.2 + s.seed;
        const amp = turbulence * (1 - s.z) * 0.25;
        tx += Math.sin(t + s.seed) * amp;
        ty += Math.cos(t * 1.13 + s.seed * 0.7) * amp;
      }

      const persp = focalDepth / Math.max(s.z, 0.0001);
      const sx = cx + tx * persp * projScale;
      const sy = cy + ty * persp * projScale;

      if (!reverse && (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20)) {
        resetStar(s);
        continue;
      }

      let flashMult = 1;
      if (glitter > 0) {
        if (elapsed >= s.nextFlash && s.flashUntil < elapsed) {
          s.flashUntil = elapsed + 0.04 + Math.random() * 0.07;
          s.nextFlash = elapsed + 1 + Math.random() * 4 * (1 / Math.max(0.0001, glitter));
        }
        if (elapsed <= s.flashUntil) {
          flashMult = 1 + 2.5 * glitter;
        }
      }

      const sizePersp = Math.min(2.5, (focalDepth / Math.max(s.z, 0.0001)) * 0.6);
      const baseR = Math.max(0.25, starScale * (0.4 + sizePersp));
      const maxR = 1 + starScale * 2.5;
      const r = Math.min(baseR * flashMult, maxR);

      const lifeT = reverse ? s.z : 1 - s.z;
      const fadeIn = reverse ? Math.min(1, (s.z - focalDepth) / (1 - focalDepth) / 0.12) : 1;
      const a =
        Math.min(1, reverse ? 0.85 - lifeT * 0.6 : lifeT * 0.9 + 0.05) *
        fadeIn *
        brightness *
        (flashMult > 1 ? 1 : 0.85);

      const colStr = RGB_STRS[s.colorIdx];

      if (!Number.isNaN(s.px) && !Number.isNaN(s.py)) {
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = colStr;
        ctx.lineWidth = Math.max(0.4, r * 0.4);
        ctx.beginPath();
        ctx.moveTo(s.px, s.py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }

      ctx.globalAlpha = a;
      ctx.fillStyle = colStr;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);

      if (flashMult > 1) {
        const rf = Math.min(r * 1.4, maxR * 1.4);
        ctx.globalAlpha = a * 0.5;
        ctx.fillRect(sx - rf, sy - rf, rf * 2, rf * 2);
      }

      s.px = sx;
      s.py = sy;
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    elapsed += Math.min(0.1, Math.max(0, deltaSec));
  };

  let rafId: number | null = null;

  if (prefersReducedMotion) {
    // Draw a single static-looking frame and stop — no animation loop.
    for (let i = 0; i < 80; i++) drawFrame(1 / 60);
    return () => {
      ro.disconnect();
    };
  }

  const loop = (t: number) => {
    const deltaSec = (t - lastT) / 1000;
    lastT = t;
    drawFrame(deltaSec);
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  return () => {
    if (rafId != null) cancelAnimationFrame(rafId);
    ro.disconnect();
  };
}
