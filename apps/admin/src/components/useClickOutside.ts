import { useEffect, useRef, type RefObject } from "react";

/**
 * Calls onOutside on any pointerdown outside the given container while open, or when
 * focus itself moves outside it (e.g. Tab from this trigger straight to another
 * dropdown's trigger, with no pointerdown in between — two independent dropdowns on the
 * same page would otherwise both stay open at once, since neither ever "clicks away"
 * from the other for a keyboard-only user).
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
    const onOutsideInteraction = (event: PointerEvent | FocusEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onOutsideRef.current();
      }
    };
    document.addEventListener("pointerdown", onOutsideInteraction);
    document.addEventListener("focusin", onOutsideInteraction);
    return () => {
      document.removeEventListener("pointerdown", onOutsideInteraction);
      document.removeEventListener("focusin", onOutsideInteraction);
    };
  }, [open, containerRef]);
}
