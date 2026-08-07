import { useEffect, useRef, type RefObject } from "react";

/** Why `onOutside` fired — callers that restore focus to their own trigger on close (most
 * of them do) must skip that specifically for `"focus"` and `"scroll"`: `"focus"` means the
 * user already moved focus somewhere else on purpose (e.g. Tab to the next control), and
 * `"scroll"` means an ancestor scroll closed a fixed overlay — restoring focus would scroll
 * the page/modal back to the trigger and undo that scroll. `"pointer"` (or calling the
 * callback directly, e.g. after selecting a value, or Escape) is unaffected. */
export type OutsideInteraction = "pointer" | "focus" | "scroll";

/** True when `target` is inside `container`, or is a `<label for="...">` whose labelled control
 * lives inside `container` (a `showLabel={false}` caller's own external caption for this exact
 * trigger, e.g. AuditLogPanel's "Action" filter). A plain `container.contains()` check treats a
 * mousedown on that label as outside (it's a DOM sibling of the trigger, not a descendant) and
 * closes the panel - but a `<label for>` click also natively re-dispatches a click at its
 * labelled control a moment later, which for an open trigger's own toggle button reopens what
 * this very listener just closed, flickering closed-then-open on every click near the label
 * (PO report). Recognizing the label's target as "inside" skips that close, leaving the single
 * native forwarded click as the only thing toggling the trigger - the same clean open/close a
 * direct click on the trigger itself already gets. */
function resolvesInsideContainer(target: EventTarget | null, container: HTMLElement | null): boolean {
  if (!container || !(target instanceof Node)) return false;
  if (container.contains(target)) return true;
  const forId = target instanceof Element ? target.closest("label")?.htmlFor : undefined;
  const labelled = forId ? document.getElementById(forId) : null;
  return !!labelled && container.contains(labelled);
}

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
      if (!resolvesInsideContainer(event.target, containerRef.current)) {
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
