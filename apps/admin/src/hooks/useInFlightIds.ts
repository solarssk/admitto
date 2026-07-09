import { useCallback, useRef, useState } from "react";

/**
 * Double-submit guard for per-id actions (list-row toggles, per-item buttons,
 * a single-button flow via a fixed sentinel id).
 *
 * Owns both halves of the guard so call sites don't hand-roll a ref+state pair:
 * an internal ref mirrors the state Set and is checked-and-set synchronously, so
 * a same-tick double-click is blocked before React commits the re-render that
 * flips `disabled`; the state Set (`ids`) still drives that `disabled`/`aria-busy`
 * on the next render. `start(id)` returns whether the caller should proceed
 * (`false` = already in flight, bail immediately without touching state):
 *
 *     if (!start(id)) return;
 *     doWork().finally(() => finish(id));
 */
export function useInFlightIds() {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  // Ref (not state) so the check below sees a click from the same tick: `ids`
  // only reflects a newly-added id after the next render commits, one tick too
  // late to stop a second synchronous click.
  const inFlightRef = useRef<Set<string>>(new Set());

  const start = useCallback((id: string): boolean => {
    if (inFlightRef.current.has(id)) return false;
    inFlightRef.current.add(id);
    setIds((prev) => new Set(prev).add(id));
    return true;
  }, []);

  const finish = useCallback((id: string) => {
    inFlightRef.current.delete(id);
    setIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return { ids, start, finish };
}
