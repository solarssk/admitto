import { useEffect, useRef, type RefObject } from "react";

/** Why `onOutside` fired — callers that restore focus to their own trigger on close (most
 * of them do) must skip that specifically for `"focus"` and `"scroll"`: `"focus"` means the
 * user already moved focus somewhere else on purpose (e.g. Tab to the next control), and
 * `"scroll"` means an ancestor scroll closed a fixed overlay — restoring focus would scroll
 * the page/modal back to the trigger and undo that scroll. `"pointer"` (or calling the
 * callback directly, e.g. after selecting a value, or Escape) is unaffected. */
export type OutsideInteraction = "pointer" | "focus" | "scroll";

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
  onOutside: (reason: OutsideInteraction) => void,
): void {
  const onOutsideRef = useRef(onOutside);
  useEffect(() => {
    onOutsideRef.current = onOutside;
  });

  useEffect(() => {
    if (!open) return;
    const onOutsideInteraction = (event: PointerEvent | FocusEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onOutsideRef.current(event.type === "focusin" ? "focus" : "pointer");
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
