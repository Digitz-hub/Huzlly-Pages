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
//   - NEW: a directional box-shadow now follows the tilt instead of using
//     Card.astro's static `hover:shadow-lg` (which always sits in the same
//     fixed direction no matter which way the card is actually tilting).
//     The shadow offset is driven by the exact same cursor-relative px/py
//     values used for rotateX/rotateY, so it tracks whichever side the
//     card is currently tilting/lifting toward — same cursor position that
//     drives the tilt, just re-used for a second purpose. This is set via
//     inline `box-shadow`, which naturally overrides Card.astro's
//     class-based `hover:shadow-lg` (inline style wins over an external
//     stylesheet rule for the same property, no `!important` needed) for
//     as long as the tilt script is actively driving it; on mouseleave it's
//     cleared back to `''`, handing shadow control back to whatever
//     Card.astro/CSS would otherwise show at rest.
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
//
// FIX — scroll-under-stationary-cursor (see this file's changelog):
//   `mousemove`/`mouseleave` only fire when the CURSOR moves relative to
//   the viewport. During a scroll, the cursor doesn't move at all — the
//   page (and the card) slides underneath it — so a card that scrolls
//   into/out of the stationary cursor's position never got a mousemove or
//   mouseleave and just sat flat/stuck until the mouse was nudged. Fixed
//   by tracking the last known pointer position (one shared window-level
//   `mousemove` listener) and, on every scroll (rAF-throttled), checking
//   each card's current `getBoundingClientRect()` against that last
//   position to synthesize the same apply/reset the real mouse events
//   would have triggered.

export interface TiltCardOptions {
  /** Max tilt angle in degrees on each axis. Defaults to 10. */
  maxTilt?: number;
  /** Scale applied while tilted (hover "lift" feel). Defaults to 1.03. */
  scale?: number;
  /** Transition duration (ms) used while actively tracking the cursor. Defaults to 150. */
  trackMs?: number;
  /** Transition duration (ms) used when the cursor leaves, easing back to flat. Defaults to 600. */
  leaveMs?: number;
  /** CSS perspective distance in px. Defaults to 800. */
  perspective?: number;
  /** Max shadow offset in px on each axis, at full tilt. Defaults to 22. */
  shadowMaxOffset?: number;
  /** Shadow blur radius in px. Defaults to 36. */
  shadowBlur?: number;
  /** Shadow color, any valid CSS color (include alpha here, e.g. rgba). Defaults to a soft ink-tinted shadow matching the site's ink color (#14110F). */
  shadowColor?: string;
}

/**
 * Wires up the mouse-follow 3D tilt effect (rotation + directional shadow)
 * for a set of card elements.
 *
 * @param target A CSS selector, a single Element, or a NodeList/array of
 *   Elements — same flexible-target convention as `initScrollReveal`.
 * @returns A cleanup function that removes the listeners and resets each
 *   card's inline transform/transition/box-shadow, for components that need
 *   to tear down (e.g. view transitions/SPA navigation). Safe to ignore for
 *   static pages.
 */
export function initTiltCard(
  target: string | Element | NodeListOf<Element> | Element[],
  options: TiltCardOptions = {}
): () => void {
  const maxTilt = options.maxTilt ?? 10;
  const scale = options.scale ?? 1.03;
  const trackMs = options.trackMs ?? 150;
  const leaveMs = options.leaveMs ?? 600;
  const perspective = options.perspective ?? 800;
  const shadowMaxOffset = options.shadowMaxOffset ?? 22;
  const shadowBlur = options.shadowBlur ?? 36;
  const shadowColor = options.shadowColor ?? 'rgba(20, 17, 15, 0.22)';

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
  // Cards that also carry a scroll-reveal system (currently
  // `initScrollReveal` from `scroll-reveal.ts`, e.g. HeroDashboardPreview's
  // `.dp-reveal-*` cards) drive their own `--dp-progress` custom property
  // and let `.dp-reveal-left/-right/-up`'s CSS `transform` (a translateX/Y
  // slide) read it. `transform` can only have ONE source of truth on a
  // given element — an inline `style.transform` set by this script would
  // either fight or permanently shadow that CSS rule (inline always beats
  // a stylesheet, even after being "reset" to a neutral value). So for
  // THOSE cards specifically, this script never touches `transform`
  // directly at all — instead it writes `--tilt-rx` / `--tilt-ry` /
  // `--tilt-scale` / `--tilt-perspective`, which scroll-reveal.css's
  // `.dp-reveal-*` rules already compose into their own `transform`
  // alongside the live reveal translate (see the TILT COMPOSITION note in
  // scroll-reveal.css). That lets reveal and tilt run fully concurrently —
  // a card can slide in AND tilt under the cursor at the same time,
  // mid-scroll — with neither ever overwriting the other. Detected once
  // per card via the `dp-reveal` base class (always present alongside a
  // direction modifier on any reveal card); cards without it use the
  // original simpler approach below, setting `transform` directly, exactly
  // as before — there's no conflict to avoid there.
  const cleanups: Array<() => void> = [];

  // --- Scroll-under-stationary-cursor fix: shared pointer tracking ---
  // One window-level `mousemove` listener (shared across every card this
  // call handles) keeps the last known pointer position up to date. This
  // is what lets the scroll handler below know where the cursor "is" even
  // though scroll events themselves carry no coordinates.
  let lastClientX = 0;
  let lastClientY = 0;
  let hasPointer = false;

  const onWindowMouseMove = (e: MouseEvent) => {
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    hasPointer = true;
  };
  window.addEventListener('mousemove', onWindowMouseMove, { passive: true });
  cleanups.push(() => window.removeEventListener('mousemove', onWindowMouseMove));

  // Each card registers a "recheck" callback here; the shared scroll
  // listener below calls all of them, rAF-throttled, on every scroll.
  const scrollRechecks: Array<() => void> = [];

  elements.forEach((card) => {
    const hasScrollReveal = card.classList.contains('dp-reveal');
    let isHovering = false;

    card.style.willChange = 'transform, box-shadow';

    if (hasScrollReveal) {
      // Perspective is fixed config, not something that changes per
      // mousemove — set once, no transition needed on it.
      card.style.setProperty('--tilt-perspective', `${perspective}px`);
    }

    // Applies tilt/shadow for a given cursor position, at a given
    // transition speed (trackMs while actively hovering/tracking, leaveMs
    // is only ever used by resetTilt below). Shared by the real mousemove
    // handler AND the scroll-recheck handler, so both paths behave
    // identically.
    const applyTilt = (clientX: number, clientY: number) => {
      const rect = card.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const px = x / rect.width - 0.5;
      const py = y / rect.height - 0.5;
      const rotateX = (-py * maxTilt * 2).toFixed(2);
      const rotateY = (px * maxTilt * 2).toFixed(2);

      // Shadow offset reuses the exact same px/py the rotation above is
      // built from, so it always points toward whichever side the card is
      // currently tilting/lifting toward (the cursor's side) rather than
      // sitting in one fixed direction like a plain CSS hover:shadow does.
      const shadowX = (px * shadowMaxOffset).toFixed(1);
      const shadowY = (py * shadowMaxOffset).toFixed(1);

      if (hasScrollReveal) {
        card.style.transition = `--tilt-rx ${trackMs}ms ease-out, --tilt-ry ${trackMs}ms ease-out, --tilt-scale ${trackMs}ms ease-out, box-shadow ${trackMs}ms ease-out`;
        card.style.setProperty('--tilt-rx', `${rotateX}deg`);
        card.style.setProperty('--tilt-ry', `${rotateY}deg`);
        card.style.setProperty('--tilt-scale', `${scale}`);
      } else {
        card.style.transition = `transform ${trackMs}ms ease-out, box-shadow ${trackMs}ms ease-out`;
        card.style.transform = `perspective(${perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`;
      }
      card.style.boxShadow = `${shadowX}px ${shadowY}px ${shadowBlur}px ${shadowColor}`;
    };

    const resetTilt = () => {
      if (hasScrollReveal) {
        card.style.transition = `--tilt-rx ${leaveMs}ms ease-out, --tilt-ry ${leaveMs}ms ease-out, --tilt-scale ${leaveMs}ms ease-out, box-shadow ${leaveMs}ms ease-out`;
        card.style.setProperty('--tilt-rx', '0deg');
        card.style.setProperty('--tilt-ry', '0deg');
        card.style.setProperty('--tilt-scale', '1');
      } else {
        card.style.transition = `transform ${leaveMs}ms ease-out, box-shadow ${leaveMs}ms ease-out`;
        card.style.transform = flatTransform;
      }
      card.style.boxShadow = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
      isHovering = true;
      applyTilt(e.clientX, e.clientY);
    };

    const onMouseLeave = () => {
      isHovering = false;
      resetTilt();
    };

    card.addEventListener('mousemove', onMouseMove);
    card.addEventListener('mouseleave', onMouseLeave);

    // Scroll recheck: with the cursor held still, figure out from the
    // last known pointer position whether this card is now under it (or
    // no longer is) and synthesize whatever a real mousemove/mouseleave
    // would have done.
    scrollRechecks.push(() => {
      if (!hasPointer) return;

      const rect = card.getBoundingClientRect();
      const inside =
        lastClientX >= rect.left &&
        lastClientX <= rect.right &&
        lastClientY >= rect.top &&
        lastClientY <= rect.bottom;

      if (inside) {
        isHovering = true;
        applyTilt(lastClientX, lastClientY);
      } else if (isHovering) {
        isHovering = false;
        resetTilt();
      }
    });

    cleanups.push(() => {
      card.removeEventListener('mousemove', onMouseMove);
      card.removeEventListener('mouseleave', onMouseLeave);
      card.style.transition = '';
      if (hasScrollReveal) {
        card.style.removeProperty('--tilt-perspective');
        card.style.removeProperty('--tilt-rx');
        card.style.removeProperty('--tilt-ry');
        card.style.removeProperty('--tilt-scale');
      } else {
        card.style.transform = '';
      }
      card.style.boxShadow = '';
      card.style.willChange = '';
    });
  });

  // Single rAF-throttled scroll listener shared by every card this call
  // handles — avoids stacking N raw scroll listeners for N cards.
  let scrollScheduled = false;
  const onScroll = () => {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      scrollRechecks.forEach((recheck) => recheck());
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  cleanups.push(() => window.removeEventListener('scroll', onScroll));

  return () => cleanups.forEach((fn) => fn());
}
