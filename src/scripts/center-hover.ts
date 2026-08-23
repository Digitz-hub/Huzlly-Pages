// src/scripts/center-hover.ts
//
// Shared touch-equivalent hover engine — generalizes the "viewport-center-
// crossing" trick that tilt-card.ts's touch branch uses (see the TOUCH
// EQUIVALENT note in that file) into a standalone, reusable helper for ANY
// plain CSS `:hover`-only effect, not just tilt. Same pattern as
// `initScrollReveal` in `src/scripts/scroll-reveal.ts` and `initTiltCard`
// in `src/scripts/tilt-card.ts`: one import + one function call wires up
// an entire group of elements.
//
// WHY THIS EXISTS:
//   Plain CSS `:hover` rules (e.g. `.some-card:hover { ... }`) never fire
//   on touch/tablet devices — there's no cursor to hover with, and tap
//   would be the wrong gesture anyway (it's a click, not a hover, and
//   would leave the effect stuck "on" with no natural way to turn it back
//   off). tilt-card.ts solved this exact problem for its own tilt effect
//   by treating "the viewport's vertical center currently sits inside this
//   element's rect" as the touch-equivalent of "the cursor is hovering
//   this element" — i.e. scrolling an element through the middle of the
//   screen IS the touch gesture that stands in for a mouse hover. This
//   file extracts that same trigger into a generic, effect-agnostic form:
//   instead of driving tilt-card.ts's specific rotate/scale/shadow math,
//   it just toggles a plain CSS class (`activeClass`, default
//   `is-center-active`) on/off as each element crosses that center line —
//   any component can then write ordinary `.is-center-active { ... }` CSS
//   (scoped under `@media (hover: none), (pointer: coarse)`, see
//   `src/styles/center-hover.css`) to get its own touch-equivalent hover
//   effect, the same way it'd write a `:hover` rule for desktop.
//
// BEHAVIOR:
//   - Only activates when the device lacks real hover/fine-pointer
//     capability (same touch-detection condition as tilt-card.ts's touch
//     branch: `!window.matchMedia('(pointer: fine)').matches`) AND
//     `prefers-reduced-motion` is not set. On any device with real hover
//     (or with reduced motion requested), this is a pure no-op — the
//     elements are left completely untouched and a no-op cleanup function
//     is returned immediately, so it's always safe to call unconditionally
//     alongside a plain CSS `:hover` rule without double-driving the
//     effect on desktop.
//   - On scroll (rAF-throttled, single shared listener per call, same
//     pattern as `initScrollReveal`/`initTiltCard`) plus once on initial
//     mount (in case an element is already centered before the user ever
//     scrolls), checks for each target element whether the viewport's
//     vertical center (`window.innerHeight / 2`) falls inside its current
//     `getBoundingClientRect()` (top..bottom). Toggles `activeClass` on/off
//     accordingly as elements cross in and out of that center line.
//
// USAGE:
//   Call `initCenterHover('.js-some-card')` from a component's own
//   <script> tag — or pass an Element/NodeList directly if you already
//   have a reference, same flexible-target convention as
//   `initScrollReveal`/`initTiltCard`. Pair with an
//   `.is-center-active` (or custom `activeClass`) rule scoped under
//   `@media (hover: none), (pointer: coarse)` in
//   `src/styles/center-hover.css` (imported globally via global.css) that
//   mirrors whatever the element's desktop `:hover` rule already does.
//   Safe to call multiple times across different components/selectors on
//   the same page.

export interface CenterHoverOptions {
  /** CSS class toggled on each element while it's "center-active". Defaults to 'is-center-active'. */
  activeClass?: string;
}

/**
 * Wires up the touch-equivalent hover trigger (viewport-center-crossing)
 * for a set of elements, toggling a plain CSS class as each element
 * crosses the vertical center of the viewport.
 *
 * @param target A CSS selector, a single Element, or a NodeList/array of
 *   Elements — same flexible-target convention as `initScrollReveal`/
 *   `initTiltCard`.
 * @returns A cleanup function that removes the scroll listener and strips
 *   `activeClass` from every element, for components that need to tear
 *   down (e.g. view transitions/SPA navigation). Safe to ignore for
 *   static pages.
 */
export function initCenterHover(
  target: string | Element | NodeListOf<Element> | Element[],
  options: CenterHoverOptions = {}
): () => void {
  const activeClass = options.activeClass ?? 'is-center-active';

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
  const hasFinePointer = window.matchMedia('(pointer: fine)').matches;

  // Same touch-detection condition as tilt-card.ts's touch branch: only
  // devices without real hover/fine-pointer capability get this trigger.
  // Anything else (real mouse, or reduced motion requested) is a no-op —
  // elements are left untouched.
  if (hasFinePointer || prefersReducedMotion) {
    return () => {};
  }

  const activeElements = new Set<Element>();

  const checkCenterCross = () => {
    const viewportCenterY = window.innerHeight / 2;

    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const inside = viewportCenterY >= rect.top && viewportCenterY <= rect.bottom;

      if (inside && !activeElements.has(el)) {
        activeElements.add(el);
        el.classList.add(activeClass);
      } else if (!inside && activeElements.has(el)) {
        activeElements.delete(el);
        el.classList.remove(activeClass);
      }
    });
  };

  // Single rAF-throttled scroll listener, same pattern as
  // initScrollReveal/initTiltCard — avoids stacking N raw scroll listeners
  // for N elements.
  let scrollScheduled = false;
  const onScroll = () => {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      checkCenterCross();
    });
  };

  // Run once on mount in case an element is already centered in the
  // viewport before any scroll event ever fires (e.g. it's the first
  // thing in view on load).
  checkCenterCross();
  window.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    window.removeEventListener('scroll', onScroll);
    elements.forEach((el) => el.classList.remove(activeClass));
    activeElements.clear();
  };
}
