/**
 * One animation clock shared by every logo loader (the static splash in `index.html`, the boot
 * loader, the event loader, a route fallback). Each of those is a separate element, so on their own
 * each would start its draw-in from the beginning and the tick would keep restarting as one
 * loader is swapped for the next. Giving every loader the same phase makes the animation carry on
 * across the swap.
 */

/** Length of one loader animation cycle. Keep in step with `loader.css` and the splash in `apps/admin/index.html`. */
export const LOADER_CYCLE_MS = 2000;

/** Time after which the first draw-in of the tick is finished and has been on screen for a beat. */
export const LOADER_FIRST_DRAW_MS = 650;

let origin = 0;
let hasSplash = false;

/**
 * Align the shared clock with the static splash that is on screen before React mounts. Call it once,
 * right before the first render, while the splash element is still in the DOM.
 */
export function syncLoaderClockToSplash(root: ParentNode = document): void {
  const svg = root.querySelector(".at-splash svg");
  if (!svg) return;
  hasSplash = true;
  const animations = typeof svg.getAnimations === "function" ? svg.getAnimations({ subtree: true }) : [];
  const elapsed = Number(animations[0]?.currentTime);
  if (Number.isFinite(elapsed)) origin = performance.now() - elapsed;
}

/** Milliseconds on the shared loader timeline (counted from when the splash started drawing). */
export function loaderElapsedMs(): number {
  return Math.max(0, performance.now() - origin);
}

/** True when a splash started the clock, i.e. the app is booting from `index.html`. */
export function bootHandoverEnabled(): boolean {
  return hasSplash;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * How much longer to keep the boot loader on screen so the tick is drawn in full before the app
 * replaces it. Zero once the first draw-in has happened, without a splash (tests, dev), or when the
 * user asked for reduced motion (there is no draw-in to wait for).
 */
export function firstDrawRemainingMs(): number {
  if (!hasSplash || prefersReducedMotion()) return 0;
  return Math.max(0, LOADER_FIRST_DRAW_MS - loaderElapsedMs());
}

/** Tests only: forget any splash sync. */
export function resetLoaderClockForTests(): void {
  origin = 0;
  hasSplash = false;
}
