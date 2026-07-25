import { useEffect, type RefObject } from "react";

/**
 * Stops a wheel gesture from pushing scroll past a scrollable element's own
 * top/bottom edge. `overscroll-behavior: contain` only stops the gesture from
 * chaining into the page behind the element — it doesn't suppress the
 * element's own rubber-band bounce in every browser, so a hard trackpad swipe
 * can still overscroll past the edge before springing back (visible as a gap
 * with a hard edge mid-gesture). Blocking the wheel event right at the
 * boundary prevents that bounce from engaging at all.
 */
export function useOverscrollBounceGuard(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
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
  }, [ref]);
}
