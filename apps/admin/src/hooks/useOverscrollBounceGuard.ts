import { useEffect, type RefObject } from "react";

/**
 * Stops a wheel gesture from pushing scroll past a scrollable element's own
 * top/bottom edge. `overscroll-behavior: contain` only stops the gesture from
 * chaining into the page behind the element — it doesn't suppress the
 * element's own rubber-band bounce in every browser, so a hard trackpad swipe
 * can still overscroll past the edge before springing back (visible as a gap
 * with a hard edge mid-gesture). Blocking the wheel event right at the
 * boundary prevents that bounce from engaging at all.
 *
 * `open` re-runs the effect once the caller's dialog actually mounts its scroll element -
 * a stable `useRef` object never changes identity, so a dialog that renders `null` while
 * closed (the scroll element doesn't exist yet) would otherwise see `ref.current` as `null`
 * on this hook's first run and never register the listener at all once it later opens.
 * Defaults to `true` for callers that always render their scroll element (a routed page or
 * embedded panel, not a conditionally-mounted dialog), where the element already exists by
 * the time this hook's own effect first runs and there's no re-mount to wait for. */
export function useOverscrollBounceGuard(ref: RefObject<HTMLElement | null>, open: boolean = true): void {
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      // A menu/list rendered inside a modal is still a DOM descendant even when it is
      // position: fixed. Do not cancel its wheel gesture merely because the modal itself is
      // at an edge: that would prevent its own scroll container from ever receiving it.
      // Nested controls use overscroll-behavior: contain, so skipping the guard here does not
      // let their end-of-list gesture chain into the page behind the modal.
      let nested = event.target instanceof Element ? event.target : null;
      while (nested && nested !== el) {
        const overflowY = window.getComputedStyle(nested).overflowY;
        if ((overflowY === "auto" || overflowY === "scroll") && nested.scrollHeight > nested.clientHeight) return;
        nested = nested.parentElement;
      }
      // 2px tolerance for sub-pixel scroll positions (same as useScrollFade) —
      // an exact >= comparison can miss either edge by a fraction of a pixel.
      const atTop = el.scrollTop <= 2;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      if ((atTop && event.deltaY < 0) || (atBottom && event.deltaY > 0)) {
        event.preventDefault();
      }
    };

    // Non-passive: React's synthetic onWheel is passive by default, which would
    // silently ignore preventDefault() here.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, open]);
}
