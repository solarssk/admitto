import { useEffect, useRef, type RefObject } from "react";
import { FOCUSABLE_SELECTOR } from "./focusable.js";
import { isAnyDropdownMenuOpen } from "./useDropdownMenu.js";

/** Where focus goes when the control that held it is removed from the panel: the first control, as when
 * the dialog opened, or the panel itself when nothing in it can take focus. */
function moveFocusIntoPanel(panel: HTMLElement) {
  const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  if (first) {
    first.focus();
    return;
  }
  panel.tabIndex = -1;
  panel.focus();
}

/** Trap focus inside a modal panel, close on Escape, lock body scroll while open. Keeps focus in the
 * panel when the control that holds it goes away: removed (a Retry whose notice goes away once the retry
 * worked), the browser drops focus on `<body>` and the next Tab would start from the page behind the dialog,
 * so it moves to the first control; or only disabled while it works (a busy button), the browser drops it
 * the same way, so it goes back to that control once it is enabled again.
 *
 * `focusWhenReady` is for a panel whose real content loads asynchronously after the
 * modal itself mounts (e.g. an always-routed editor showing a spinner first, unlike
 * a conditionally-opened dialog that already has its content at mount) — pass the
 * value that changes once that content exists (e.g. a `view`/`loadState` variable)
 * so initial focus is re-attempted then, instead of finding nothing focusable and
 * never trying again. Most callers don't need this and can omit it. */
export function useModalFocusTrap(
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  onCancel: () => void,
  focusWhenReady: unknown = null,
): void {
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
  }, [open, panelRef, focusWhenReady]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    // The control inside the panel that last held focus. Browsers drop focus on <body> when that control is
    // removed, or when it becomes disabled (it stays in the DOM, like a Retry that is busy). Removed: focus
    // goes to the first control. Disabled: it gets focus back once it is enabled again. Focus that went to
    // another element (a nested dialog, a portalled menu) is left alone.
    let held = panel.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    let heldWasDisabled = false;
    const onFocusIn = (event: FocusEvent) => {
      held = event.target as HTMLElement;
      heldWasDisabled = false;
    };
    const observer = new MutationObserver(() => {
      if (!held) return;
      const focusIsNowhere = !document.activeElement || document.activeElement === document.body;
      if (!held.isConnected) {
        if (focusIsNowhere) {
          held = null;
          moveFocusIntoPanel(panel);
        }
      } else if (held.matches(":disabled")) {
        heldWasDisabled = true;
      } else {
        if (heldWasDisabled && focusIsNowhere) held.focus();
        heldWasDisabled = false;
      }
    });
    panel.addEventListener("focusin", onFocusIn);
    observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    return () => {
      panel.removeEventListener("focusin", onFocusIn);
      observer.disconnect();
    };
  }, [open, panelRef]);

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const queryFocusables = (): HTMLElement[] =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // A nested SearchableSelect/PhoneCountrySelect panel handles its own Escape on the
        // bubble phase, but this listener runs on the capture phase and would otherwise always
        // win the race, closing the whole modal (or opening its discard-confirmation) instead of
        // just the picker sitting open on top of it (bot review finding, #755). Step aside and
        // let the event continue to that bubble-phase handler when one is open.
        if (isAnyDropdownMenuOpen()) return;
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
