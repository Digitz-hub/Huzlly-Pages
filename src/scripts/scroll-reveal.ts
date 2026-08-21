// src/scripts/scroll-reveal.ts
//
// Shared scroll-scrub reveal engine — extracted from HeroDashboardPreview's
// original inline <script> so any component can opt into the same
// animation without copy-pasting the scroll math into its own <script>
// block every time. One import + one function call wires up an entire
// group of elements.
//
// BEHAVIOR (unchanged from the HeroDashboardPreview version this was
// extracted from, plus a new optional `completionFraction` knob — see
// ScrollRevealOptions below):
//   - Pure function of current scroll position each frame, no stored/
//     sticky state.
//   - Bottom → center: as an element's center travels from the BOTTOM
//     edge of the viewport up to viewport-center, `--dp-progress`
//     interpolates 0 → 1 live. With `completionFraction` below 1, that
//     0 → 1 interpolation completes over only that fraction of the
//     bottom→center distance, so the reveal finishes earlier/lower on
//     screen instead of requiring the element to reach dead-center.
//   - Center → bottom (scrolling back up): `--dp-progress` interpolates
//     1 → 0 in exact reverse, frame for frame.
//   - Above-center clamp: once an element's center is at or above
//     viewport-center — including fully above/past the top of the
//     viewport — `--dp-progress` clamps at 1, so it never hides/
//     exit-animates at the top.
//
// USAGE:
//   Pair with the `.dp-reveal` / `.dp-reveal-left` / `.dp-reveal-right` /
//   `.dp-reveal-up` classes in `src/styles/scroll-reveal.css` (imported
//   globally), then call `initScrollReveal('[data-my-component]')` from
//   any component's own <script> tag, passing a selector scoped to that
//   component's root (matches the existing `[data-dashboard-preview]`
//   pattern) — or pass an Element/NodeList directly if you already have
//   a reference. Safe to call multiple times across different components
//   on the same page; each call only touches the elements it's given.
//
// `.dp-reveal` itself intentionally carries NO direction — it just wires
// up `opacity: var(--dp-progress)`. Pick a direction modifier
// (`-left` / `-right` / `-up`) per element, same as HeroDashboardPreview's
// cards, or add your own modifier class in scroll-reveal.css following the
// same `calc((1 - var(--dp-progress)) * <offset>)` pattern.

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface ScrollRevealOptions {
  /** CSS custom property written to each element. Defaults to '--dp-progress'. */
  property?: string;
  /**
   * How far along the bottom→center journey the element should reach
   * full progress (1), expressed as a fraction of that journey. Defaults
   * to 1 (finishes exactly at viewport-center, the original behavior).
   * e.g. 0.7 finishes the reveal 30% "early" — once the element's center
   * has covered 70% of the distance from the viewport bottom to
   * viewport-center — instead of requiring it to reach center itself.
   * Must be > 0.
   */
  completionFraction?: number;
}

/**
 * Wires up the bottom→center scroll-scrub reveal for a set of elements.
 *
 * @param target A CSS selector (scoped to a root container, e.g.
 *   '[data-my-section] .reveal-item'), a single Element, or a NodeList/
 *   array of Elements.
 * @returns A cleanup function that removes the scroll/resize listeners,
 *   for components that need to tear down (e.g. view transitions/SPA
 *   navigation). Safe to ignore for static pages.
 */
export function initScrollReveal(
  target: string | Element | NodeListOf<Element> | Element[],
  options: ScrollRevealOptions = {}
): () => void {
  const property = options.property ?? '--dp-progress';
  const completionFraction = options.completionFraction ?? 1;

  const elements: Element[] =
    typeof target === 'string'
      ? Array.from(document.querySelectorAll(target))
      : target instanceof Element
        ? [target]
        : Array.from(target);

  if (elements.length === 0) {
    return () => {};
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    elements.forEach((el) => (el as HTMLElement).style.setProperty(property, '1'));
    return () => {};
  }

  let ticking = false;

  const update = () => {
    const viewportHeight = window.innerHeight;
    const viewportCenter = viewportHeight / 2;

    // At literal page-top (scrollY 0), force every element's progress to
    // 0 — full hidden, no partial fade — even if an element is already
    // partway into the viewport at that scroll position (e.g. a tall
    // hero where the dashboard preview peeks in at the bottom edge on
    // first load). Anything above 0 hands off to the normal bottom→
    // center formula as usual.
    const atPageTop = window.scrollY <= 0;

    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const elCenter = rect.top + rect.height / 2;

      // Bottom → center live 0 -> 1, center → bottom live 1 -> 0 in exact
      // reverse; clamps at 1 once at/above center so it never hides again
      // just for being above the fold. `completionFraction` shrinks the
      // denominator so progress hits 1 before elCenter actually reaches
      // viewport-center, if set below 1 (default 1 = original behavior,
      // full journey required).
      const progress = atPageTop
        ? 0
        : clamp(
            (viewportHeight - elCenter) / ((viewportHeight - viewportCenter) * completionFraction),
            0,
            1
          );

      (el as HTMLElement).style.setProperty(property, progress.toFixed(3));
    });

    ticking = false;
  };

  const onScrollOrResize = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  update();
  window.addEventListener('scroll', onScrollOrResize, { passive: true });
  window.addEventListener('resize', onScrollOrResize);

  return () => {
    window.removeEventListener('scroll', onScrollOrResize);
    window.removeEventListener('resize', onScrollOrResize);
  };
}
