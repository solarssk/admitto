import { useEffect, useRef, type RefObject } from "react";
import { FOCUSABLE_SELECTOR } from "./focusable.js";

/** Trap focus inside a modal panel, close on Escape, lock body scroll while open. */
export function useModalFocusTrap(
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  onCancel: () => void,
): void {
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const queryFocusables = (): HTMLElement[] =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
    queryFocusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      // Re-queried on every Tab press, not snapshotted once at mount: a confirm button
      // that starts disabled (e.g. `ConfirmDialog`'s `disableConfirm`/typed-confirmation)
      // is excluded from `:not([disabled])` at that point, so a stale snapshot would trap
      // keyboard focus between the remaining elements even after the button becomes enabled.
      const focusables = queryFocusables();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables.at(-1);

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          event.stopPropagation();
          last?.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        event.stopPropagation();
        first?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, panelRef]);
}
