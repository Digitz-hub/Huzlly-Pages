// src/scripts/typewriter-reveal.ts
//
// Scroll-scrubbed character-by-character "typewriter" reveal for the "How
// it works" section's headline + body text (see HowItWorks.astro). Reuses
// the exact same bottom-of-viewport → viewport-center progress formula as
// `initScrollReveal()` in src/scripts/scroll-reveal.ts (see that file's
// header comment for the full derivation) — including the same
// `atPageTop` snap-to-0 special case, the same above-center clamp-at-1,
// and the same `prefers-reduced-motion` handling — but drives per-
// character visibility instead of a single `--dp-progress` CSS var, and
// computes progress independently per tracked element, the same way
// `initScrollReveal` tracks each of the 4 illustration boxes independently
// rather than sharing one shared progress value across all of them.
//
// This is a deliberate small duplication of that formula, not a shared
// import from scroll-reveal.ts — scroll-reveal.ts and scroll-reveal.css
// are out of scope for this feature and are left untouched.
//
// BEHAVIOR:
//   - Each tracked element's own text content (read once, before this
//     replaces it with per-character spans) is the source text.
//   - As the element's center travels from the bottom of the viewport up
//     to viewport-center, the fraction of characters "typed" (revealed)
//     tracks scroll progress 0 → 1 live, same bottom→center journey
//     `initScrollReveal` uses (shrunk by `completionFraction`, same knob,
//     same meaning, default 1).
//   - Scrolling back down un-types characters in exact reverse, frame for
//     frame — this is a pure function of scroll position each frame, no
//     one-shot/sticky "already played" state, exactly like
//     `initScrollReveal`.
//   - `prefers-reduced-motion: reduce` snaps straight to fully revealed
//     (every character shown immediately, no animation), same as
//     `initScrollReveal`.
//
// ACCESSIBILITY: this script only ever operates on an `aria-hidden="true"`
// visual-only copy of each headline/body — see HowItWorks.astro, where
// each headline/body has a `.sr-only` sibling span holding the real, full
// text for assistive tech, completely untouched by this script regardless
// of scroll position. The elements this script targets (`.js-typewriter`)
// must always be the aria-hidden visual copy, never the `.sr-only` one.
//
// USAGE:
//   <h3>
//     <span class="sr-only">{headline}</span>
//     <span class="js-typewriter" aria-hidden="true">{headline}</span>
//   </h3>
//   <script>
//     import { initTypewriterReveal } from '../../scripts/typewriter-reveal';
//     initTypewriterReveal('[data-my-component] .js-typewriter');
//   </script>
//
// Pair with the `.tw-char` / `.tw-revealed` / `.tw-caret` classes in
// src/styles/typewriter-reveal.css, which this script applies to the
// per-character spans it creates.

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface TypewriterRevealOptions {
  /**
   * Same knob/meaning as `ScrollRevealOptions.completionFraction` in
   * scroll-reveal.ts: how far along the bottom→center journey the element
   * should reach full (all-characters-typed) progress, expressed as a
   * fraction of that journey. Defaults to 1. Must be > 0.
   */
  completionFraction?: number;
}

interface TrackedElement {
  el: HTMLElement;
  chars: HTMLElement[];
  total: number;
  lastRevealed: number;
}

/**
 * Wires up the scroll-scrubbed typewriter reveal for a set of elements.
 * Each matched element's current text content is split into one <span>
 * per character (preserving the original text as the source of truth) and
 * progressively revealed/un-revealed in sync with scroll position, using
 * the same bottom→center formula as `initScrollReveal`.
 *
 * @param target A CSS selector (scoped to a root container, matching the
 *   `initScrollReveal`/`initTiltCard` calling convention), a single
 *   Element, or a NodeList/array of Elements.
 * @returns A cleanup function that removes the scroll/resize listeners.
 *   Safe to ignore for static pages.
 */
export function initTypewriterReveal(
  target: string | Element | NodeListOf<Element> | Element[],
  options: TypewriterRevealOptions = {}
): () => void {
  const completionFraction = options.completionFraction ?? 1;

  const rawElements: Element[] =
    typeof target === 'string'
      ? Array.from(document.querySelectorAll(target))
      : target instanceof Element
        ? [target]
        : Array.from(target);

  if (rawElements.length === 0) {
    return () => {};
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Build the per-character spans once, up front, for every tracked
  // element — same "set up once, then just toggle state per frame" shape
  // as initScrollReveal (which writes one CSS var per frame; here we
  // instead toggle a class across the delta range of characters, so a
  // frame's cost scales with how many characters changed, not with total
  // character count).
  const tracked: TrackedElement[] = rawElements.map((element) => {
    const el = element as HTMLElement;
    const text = el.textContent ?? '';
    el.textContent = '';
    el.setAttribute('aria-hidden', 'true');

    const chars = Array.from(text).map((ch) => {
      const span = document.createElement('span');
      span.className = 'tw-char';
      // Regular spaces collapse when isolated alone in their own inline
      // element in some engines — swap to a non-breaking space, which
      // renders identically for a plain ' ' character but keeps its width
      // reliably even on its own.
      span.textContent = ch === ' ' ? '\u00A0' : ch;
      el.appendChild(span);
      return span;
    });

    return { el, chars, total: chars.length, lastRevealed: 0 };
  });

  if (prefersReducedMotion) {
    tracked.forEach(({ chars }) => {
      chars.forEach((span) => span.classList.add('tw-revealed'));
    });
    return () => {};
  }

  let ticking = false;

  const setRevealed = (t: TrackedElement, count: number) => {
    const nextRevealed = clamp(count, 0, t.total);
    if (nextRevealed === t.lastRevealed) return;

    if (nextRevealed > t.lastRevealed) {
      for (let i = t.lastRevealed; i < nextRevealed; i++) {
        t.chars[i].classList.add('tw-revealed');
      }
    } else {
      for (let i = nextRevealed; i < t.lastRevealed; i++) {
        t.chars[i].classList.remove('tw-revealed');
      }
    }

    // Blinking caret sits on the most recently revealed character's
    // trailing edge — move it off the previous edge before placing it on
    // the new one, so at most one character ever carries it, and none do
    // once the whole element is fully typed.
    if (t.lastRevealed > 0 && t.lastRevealed <= t.total) {
      t.chars[t.lastRevealed - 1].classList.remove('tw-caret');
    }
    if (nextRevealed > 0 && nextRevealed < t.total) {
      t.chars[nextRevealed - 1].classList.add('tw-caret');
    }

    t.lastRevealed = nextRevealed;
  };

  const update = () => {
    const viewportHeight = window.innerHeight;
    const viewportCenter = viewportHeight / 2;

    // Same literal-page-top special case as initScrollReveal: force every
    // tracked element back to zero characters typed at scrollY 0, even if
    // an element is already partway into the viewport at that scroll
    // position on first load.
    const atPageTop = window.scrollY <= 0;

    tracked.forEach((t) => {
      const rect = t.el.getBoundingClientRect();
      const elCenter = rect.top + rect.height / 2;

      // Bottom → center live 0 -> 1, center → bottom live 1 -> 0 in exact
      // reverse; clamps at 1 once at/above center — identical formula to
      // initScrollReveal's `update()`, just feeding a character count
      // instead of a CSS custom property.
      const progress = atPageTop
        ? 0
        : clamp(
            (viewportHeight - elCenter) / ((viewportHeight - viewportCenter) * completionFraction),
            0,
            1
          );

      setRevealed(t, Math.round(progress * t.total));
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
