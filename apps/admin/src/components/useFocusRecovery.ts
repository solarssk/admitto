import { useEffect, type RefObject } from "react";
import { FOCUSABLE_SELECTOR } from "./focusable.js";

/** Where focus goes when the control that held it is removed from the panel: the first control, as when
 * the panel opened, or the panel itself when nothing in it can take focus. */
function moveFocusIntoPanel(panel: HTMLElement) {
  const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  if (first) {
    first.focus();
    return;
  }
  panel.tabIndex = -1;
  panel.focus();
}

/**
 * Keeps focus in an open panel (a modal, or a popover such as a menu) when the control that holds it goes away.
 * A browser drops focus on `<body>` then, and the next Tab would start from the page behind the panel:
 * - the control is removed (a Retry whose notice goes away once the retry worked, a button that is hidden once
 *   its job is done): focus moves to the first control in the panel;
 * - the control only becomes disabled while it works (it stays in the DOM): a browser drops its focus the same
 *   way, so it gets it back once it is enabled again.
 * Focus that went to another element (a nested dialog, a portalled menu) is left alone.
 */
export function useFocusRecovery(panelRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    if (!panel) return;

    // The control inside the panel that last held focus.
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
  }, [active, panelRef]);
}
