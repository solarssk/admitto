import { lazy, useSyncExternalStore, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Knows when the code of a not-yet-visited page is being downloaded. React Router wraps
 * navigations in a transition, so the old page stays on screen while the new chunk loads and
 * nothing tells the user their click was received; this feeds the top progress bar.
 */
let pending = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Count one in-flight chunk request until it settles (either way). */
export function trackChunk<T>(promise: Promise<T>): Promise<T> {
  pending += 1;
  emit();
  const settle = () => {
    pending -= 1;
    emit();
  };
  promise.then(settle, settle);
  return promise;
}

/**
 * `React.lazy` whose download is tracked. Background preloads (`preloadLazyRoute`) call the raw
 * loader instead, so they never show the bar; only a page the user actually opened does.
 */
// `any` mirrors React's own `lazy<T extends ComponentType<any>>`: a narrower props type rejects
// class components and pages with required props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRoute<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => trackChunk(load()));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while any page chunk the user asked for is still downloading. */
export function useChunkLoading(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pending > 0,
    () => false,
  );
}
