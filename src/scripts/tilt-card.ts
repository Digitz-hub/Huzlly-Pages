// src/scripts/tilt-card.ts
//
// Shared mouse-follow 3D tilt engine — extracted from FeaturesSummary's
// original inline <script> (the "how it works" stage cards) so any other
// component can opt into the same hover-tilt feel without copy-pasting the
// mousemove/rotation math into its own <script> block every time. One
// import + one function call wires up an entire group of cards, same
// pattern as `initScrollReveal` in `src/scripts/scroll-reveal.ts`.
//
// BEHAVIOR (unchanged from the FeaturesSummary version this was extracted
// from):
//   - On mousemove, cursor position relative to the card's own center is
//     mapped to a small rotateX/rotateY (max ±MAX_TILT degrees, configurable)
//     — cursor near the top tilts the card's top edge toward the viewer,
//     giving a "looking down at it" perspective feel. X drives rotateY
//     (inverted) so the card leans toward the cursor's side.
//   - `perspective(...)` is applied inline in the same transform (not on a
//     parent), so no extra wrapper div is needed around the card's own root
//     element.
//   - A slight `scale(...)` is layered in so the card also lifts slightly.
//   - A short CSS transition stays ON at all times (including during
//     tracking, not just enter/leave) — this is what makes the very first
//     mousemove after entering ease into position instead of snapping
//     instantly (a `transition: none` during tracking was the original
//     jhatka/snap bug in the first version of this effect). Leave gets a
//     slightly longer, gentler ease back to flat.
//
// USAGE:
//   Add a class (e.g. `js-tilt-card`) to each card's root element, then call
//   `initTiltCard('.js-tilt-card')` from that component's own <script> tag —
//   or scope the selector to the component's own root the same way
//   HeroDashboardPreview scopes `initScrollReveal` via
//   `[data-dashboard-preview] .dp-reveal`, if multiple tilt groups end up on
//   the same page with different settings. Safe to call multiple times
//   across different components/selectors on the same page.
//
// Guards (baked in, not opt-out — see rationale on each below):
//   - `prefers-reduced-motion`: skips the effect entirely.
//   - `matchMedia('(pointer: fine)')`: skips on touch devices, which fire
//     synthetic/awkward mouse events on tap and would otherwise get a stuck
//     or jittery tilt instead of a real hover gesture. Those elements keep
//     whatever plain CSS hover (shadow, etc.) they already have.

export interface TiltCardOptions {
  /** Max tilt angle in degrees on each axis. Defaults to 10. */
  maxTilt?: number;
  /** Scale applied while tilted (hover "lift" feel). Defaults to 1.03. */
  scale?: number;
  /** Transition duration (ms) used while actively tracking the cursor. Defaults to 150. */
  trackMs?: number;
  /** Transition duration (ms) used when the cursor leaves, easing back to flat. Defaults to 350. */
  leaveMs?: number;
  /** CSS perspective distance in px. Defaults to 800. */
  perspective?: number;
}

/**
 * Wires up the mouse-follow 3D tilt effect for a set of card elements.
 *
 * @param target A CSS selector, a single Element, or a NodeList/array of
 *   Elements — same flexible-target convention as `initScrollReveal`.
 * @returns A cleanup function that removes the listeners and resets each
 *   card's inline transform/transition, for components that need to tear
 *   down (e.g. view transitions/SPA navigation). Safe to ignore for static
 *   pages.
 */
export function initTiltCard(
  target: string | Element | NodeListOf<Element> | Element[],
  options: TiltCardOptions = {}
): () => void {
  const maxTilt = options.maxTilt ?? 10;
  const scale = options.scale ?? 1.03;
  const trackMs = options.trackMs ?? 150;
  const leaveMs = options.leaveMs ?? 350;
  const perspective = options.perspective ?? 800;

  const elements: HTMLElement[] =
    typeof target === 'string'
      ? Array.from(document.querySelectorAll<HTMLElement>(target))
      : target instanceof Element
        ? [target as HTMLElement]
        : Array.from(target as NodeListOf<Element>).map((el) => el as HTMLElement);

  if (elements.length === 0) {
    return () => {};
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasFinePointer = window.matchMedia('(pointer: fine)').matches;

  if (prefersReducedMotion || !hasFinePointer) {
    return () => {};
  }

  const flatTransform = `perspective(${perspective}px) rotateX(0deg) rotateY(0deg) scale(1)`;
  const cleanups: Array<() => void> = [];

  elements.forEach((card) => {
    card.style.willChange = 'transform';
    // Always-on short transition — see the BEHAVIOR note above on why this
    // must never be toggled to 'none' during tracking.
    card.style.transition = `transform ${trackMs}ms ease-out`;

    const onMouseMove = (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const px = x / rect.width - 0.5;
      const py = y / rect.height - 0.5;
      const rotateX = (-py * maxTilt * 2).toFixed(2);
      const rotateY = (px * maxTilt * 2).toFixed(2);

      card.style.transition = `transform ${trackMs}ms ease-out`;
      card.style.transform = `perspective(${perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`;
    };

    const onMouseLeave = () => {
      card.style.transition = `transform ${leaveMs}ms ease-out`;
      card.style.transform = flatTransform;
    };

    card.addEventListener('mousemove', onMouseMove);
    card.addEventListener('mouseleave', onMouseLeave);

    cleanups.push(() => {
      card.removeEventListener('mousemove', onMouseMove);
      card.removeEventListener('mouseleave', onMouseLeave);
      card.style.transition = '';
      card.style.transform = '';
      card.style.willChange = '';
    });
  });

  return () => cleanups.forEach((fn) => fn());
}
