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
//
// SCROLL RESTORATION ON REFRESH:
//   `Layout.astro` sets `history.scrollRestoration = 'manual'` as early as
//   possible, in a plain synchronous inline script that runs before this
//   module (which is deferred, per `type="module"` semantics) and before
//   the browser would otherwise attempt its own native scroll restoration.
//   That hands full control of "where does this page start scrolled to"
//   over to us, so there's no longer a race to lose: the browser will never
//   restore scroll out from under us, and we never have to guess whether it
//   already has by the time we sync Lenis.
//
//   In its place, `restoreScrollPosition()` below does the restoring itself
//   — reading a per-path position we've saved to `sessionStorage` — but only
//   for reload/back-forward navigations (matching what native restoration
//   would have done); a fresh navigation to a page (e.g. clicking a link)
//   always starts at the top, even if a stale position for that path is
//   sitting in `sessionStorage` from earlier in the session.
//
//   That restore happens synchronously, before the Lenis instance is even
//   constructed, so `initLenis()` can sync Lenis to the exact value it just
//   restored — no re-reading `window.scrollY` and hoping it's settled.

import Lenis from 'lenis';

const SCROLL_POSITION_STORAGE_PREFIX = 'lenis:scrollY:';

/** Per-path sessionStorage key, so each page tracks its own scroll position. */
function getStorageKey(): string {
  return `${SCROLL_POSITION_STORAGE_PREFIX}${window.location.pathname}`;
}

/**
 * Determines how this page load was reached ('navigate' | 'reload' |
 * 'back_forward' | 'prerender'), preferring the modern Navigation Timing
 * Level 2 API and falling back to the deprecated `performance.navigation`
 * for engines that don't support it. Defaults to 'navigate' (the safest,
 * "start at the top" assumption) if neither is available.
 */
function getNavigationType(): string {
  try {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (entry?.type) {
      return entry.type;
    }
  } catch {
    // Navigation Timing Level 2 unsupported — fall through to the legacy API.
  }

  try {
    // eslint-disable-next-line deprecation/deprecation -- intentional legacy fallback
    const legacyType = (performance as any).navigation?.type;
    if (legacyType === 1) return 'reload';
    if (legacyType === 2) return 'back_forward';
  } catch {
    // Neither API available.
  }

  return 'navigate';
}

function readSavedScrollY(): number | null {
  try {
    const raw = sessionStorage.getItem(getStorageKey());
    if (raw === null) return null;
    const y = Number(raw);
    return Number.isFinite(y) ? y : null;
  } catch {
    // sessionStorage can throw in some private-browsing modes — treat as
    // "nothing saved" rather than letting it break the page.
    return null;
  }
}

function saveScrollY(y: number): void {
  try {
    sessionStorage.setItem(getStorageKey(), String(y));
  } catch {
    // Non-fatal (private mode, storage quota, etc.) — worst case, restoration
    // silently doesn't happen next time.
  }
}

function clearSavedScrollY(): void {
  try {
    sessionStorage.removeItem(getStorageKey());
  } catch {
    // Non-fatal.
  }
}

/**
 * Restores scroll position synchronously for reload/back-forward
 * navigations only. Fresh navigations (e.g. following a link) always start
 * at the top and drop any stale saved position for the path, so a later
 * reload of that page doesn't unexpectedly jump somewhere old.
 *
 * @returns The Y position actually restored to (0 for fresh navigations, or
 *   when nothing was saved), so callers can sync other scroll-aware state
 *   (Lenis) to that exact value without re-reading `window.scrollY`.
 */
function restoreScrollPosition(): number {
  const navigationType = getNavigationType();
  const isRestorableNavigation = navigationType === 'reload' || navigationType === 'back_forward';

  if (!isRestorableNavigation) {
    clearSavedScrollY();
    return 0;
  }

  const savedY = readSavedScrollY();
  if (savedY === null) {
    return 0;
  }

  window.scrollTo(0, savedY);
  return window.scrollY;
}

/**
 * Persists the current scroll position for this path (per-path
 * `sessionStorage` key) so it can be restored on the next reload/
 * back-forward navigation, now that native scroll restoration is disabled.
 *
 * Listens on `scroll` (rAF-throttled, so it's cheap even with Lenis's own
 * scroll-driven updates running) and on `pagehide`, which — unlike
 * `beforeunload` — fires reliably on reload, navigation, and tab close
 * across Chrome, Safari, and Firefox, including bfcache scenarios.
 *
 * @returns A cleanup function that removes both listeners.
 */
function trackScrollPosition(): () => void {
  let ticking = false;

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      saveScrollY(window.scrollY);
      ticking = false;
    });
  };

  const onPageHide = () => {
    saveScrollY(window.scrollY);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', onPageHide);

  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pagehide', onPageHide);
  };
}

/**
 * Initializes the sitewide Lenis smooth-scroll instance and drives it via
 * its own `requestAnimationFrame` loop, per Lenis's standard usage pattern.
 *
 * Also owns manual scroll-position restoration on refresh (see the
 * module-level doc comment above) — this runs regardless of the
 * reduced-motion preference below, since restoring scroll position is
 * independent of whether Lenis's smooth-scroll animation is active.
 *
 * @returns A cleanup function that cancels the rAF loop, destroys the Lenis
 *   instance, and stops scroll-position tracking, matching the
 *   cleanup-function pattern `scroll-reveal.ts` and `tilt-card.ts` already
 *   use (even though this particular call site, a single sitewide init in
 *   Layout.astro, never needs to invoke it).
 */
export function initLenis(): () => void {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Restore first, synchronously, before Lenis (or anything else) touches
  // scroll state — see the module-level doc comment for why this is now
  // race-free. `restoredY` is the ground truth for "where this page starts",
  // whether that's a restored position or 0 for a fresh navigation.
  const restoredY = restoreScrollPosition();
  const stopTrackingScroll = trackScrollPosition();

  if (prefersReducedMotion) {
    return stopTrackingScroll;
  }

  const lenis = new Lenis({
    duration: 1.2,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    wheelMultiplier: 1,
    touchMultiplier: 1,
  });

  // Sync Lenis's internal scroll state to the position we just finished
  // restoring above — not a fresh read of `window.scrollY` — so this can't
  // race against anything: our own restore already happened, synchronously,
  // before this line ever runs. `immediate` skips the animation and `force`
  // applies it even though Lenis hasn't been scrolled yet, so this is an
  // instant, invisible sync, not a smooth-scroll animation.
  lenis.scrollTo(restoredY, { immediate: true, force: true });

  let rafId: number;

  const raf = (time: number) => {
    lenis.raf(time);
    rafId = requestAnimationFrame(raf);
  };

  rafId = requestAnimationFrame(raf);

  return () => {
    cancelAnimationFrame(rafId);
    lenis.destroy();
    stopTrackingScroll();
  };
}
