import { useEffect, useRef, type RefObject } from "react";

/**
 * Calls onOutside on any pointerdown outside the given container while open.
 * Was three independent copies of this same pattern (DatePicker,
 * TimezoneSelect, the Revoke menu on Attendee Detail) before being
 * extracted here.
 */
export function useClickOutside(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
  onOutside: () => void,
): void {
  const onOutsideRef = useRef(onOutside);
  useEffect(() => {
    onOutsideRef.current = onOutside;
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onOutsideRef.current();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, containerRef]);
}
