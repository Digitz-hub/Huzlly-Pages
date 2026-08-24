// src/scripts/lenis.ts
//
// Sitewide smooth-scroll engine, powered by the `lenis` package. Wired up
// once, globally, from `src/layouts/Layout.astro` — the only file that owns
// <body>/the document shell per this repo's convention — so every page gets
// the same inertia-scroll feel without each page/component having to opt in
// individually.
//
// USAGE:
//   Call `initLenis()` from Layout.astro's own <script> tag. Safe to call
//   only once per page load (it drives the single sitewide scroll
//   container); nothing else in this repo should call it again.
//
// Respects `prefers-reduced-motion: reduce` the same way
// `scroll-reveal.ts`'s `initScrollReveal` does: if the user has that
// preference, Lenis is never constructed at all and native scroll behavior
// is left completely untouched.
//
// Lenis's default (non-virtual) mode still scrolls the real document — it
// wraps native scroll rather than replacing it — so `window.scrollY`,
// `getBoundingClientRect()`, and native `scroll`/`resize` events (which
// `scroll-reveal.ts` and `tilt-card.ts` both depend on) keep firing/
// updating correctly with Lenis active.

import Lenis from 'lenis';

/**
 * Initializes the sitewide Lenis smooth-scroll instance and drives it via
 * its own `requestAnimationFrame` loop, per Lenis's standard usage pattern.
 *
 * @returns A cleanup function that cancels the rAF loop and destroys the
 *   Lenis instance, matching the cleanup-function pattern `scroll-reveal.ts`
 *   and `tilt-card.ts` already use (even though this particular call site,
 *   a single sitewide init in Layout.astro, never needs to invoke it).
 */
export function initLenis(): () => void {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    return () => {};
  }

  const lenis = new Lenis({
    duration: 1.2,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    wheelMultiplier: 1,
    touchMultiplier: 1,
  });

  let rafId: number;

  const raf = (time: number) => {
    lenis.raf(time);
    rafId = requestAnimationFrame(raf);
  };

  rafId = requestAnimationFrame(raf);

  return () => {
    cancelAnimationFrame(rafId);
    lenis.destroy();
  };
}
