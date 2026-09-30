import { lazy, useSyncExternalStore, type ComponentType, type LazyExoticComponent } from "react";
import { LOAD_TIMEOUT_MS } from "./loading-timing.js";

/**
 * Knows when the code of a not-yet-visited page is being downloaded. React Router wraps
 * navigations in a transition, so the old page stays on screen while the new chunk loads and
 * nothing tells the user their click was received; this feeds the top progress bar.
 *
 * A download is counted only for the navigation it was started in. Once a newer page has rendered
 * (`supersedePendingChunks`), downloads still running from before it belong to a navigation the user
 * has left, and no longer hold the bar (or its "taking longer" line) up; they still settle on their own.
 */
let epoch = 0;
const pendingByEpoch = new Map<number, number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function adjust(forEpoch: number, by: number): void {
  const next = (pendingByEpoch.get(forEpoch) ?? 0) + by;
  if (next > 0) pendingByEpoch.set(forEpoch, next);
  else pendingByEpoch.delete(forEpoch);
  emit();
}

/** Count one in-flight chunk request until it settles (either way), for the current navigation. */
export function trackChunk<T>(promise: Promise<T>): Promise<T> {
  const mine = epoch;
  adjust(mine, 1);
  const settle = () => adjust(mine, -1);
  promise.then(settle, settle);
  return promise;
}

/** A page has rendered: downloads still running from earlier navigations stop counting. */
export function supersedePendingChunks(): void {
  epoch += 1;
  emit();
}

/**
 * Reject `promise` if it has not settled within `ms`. A download that stalls without ever failing
 * would otherwise keep `pending` above zero (the top bar running) and leave the page suspended forever.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Loading this page timed out. Check your connection and reload.")),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * `React.lazy` whose download is tracked, and abandoned after `LOAD_TIMEOUT_MS`: the rejection lands
 * in the app's error boundary, which offers a reload. Background preloads (`preloadLazyRoute`) call
 * the raw loader instead, so they never show the bar; only a page the user actually opened does.
 */
// `any` mirrors React's own `lazy<T extends ComponentType<any>>`: a narrower props type rejects
// class components and pages with required props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRoute<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => trackChunk(withTimeout(load(), LOAD_TIMEOUT_MS)));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while a page chunk the user asked for, in the navigation now in progress, is still downloading. */
export function useChunkLoading(): boolean {
  return useSyncExternalStore(subscribe, () => (pendingByEpoch.get(epoch) ?? 0) > 0);
}
