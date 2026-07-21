import { useEffect, useRef, useState } from "react";
import { FOCUSABLE_SELECTOR } from "./focusable.js";
import { useClickOutside } from "./useClickOutside.js";

/** Open/close state, click-outside, Escape-to-close, and first-`menuitem` focus for a small
 * trigger-button + `role="menu"` popover — was duplicated between the Attendee Detail page's
 * Revoke menu and the Attendees list's Export menu before being extracted here. */
export function useDropdownMenu<TTrigger extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<TTrigger>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useClickOutside(rootRef, open, close);

  useEffect(() => {
    if (!open) return;
    // Move focus into the popover: the first `menuitem` for a role="menu" popover (Export,
    // More actions), or the first focusable control for a non-menu popover of native form
    // controls (the Attendees list's Filters panel) — without this fallback, focus stayed on
    // the trigger button and nothing told keyboard/screen-reader users the panel had opened
    // (CodeRabbit review).
    const panel = panelRef.current;
    const firstMenuItem = panel?.querySelector<HTMLElement>('[role="menuitem"]');
    (firstMenuItem ?? panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus();

    // Roving focus between menuitems (WAI-ARIA menu pattern) - Escape alone isn't enough
    // keyboard support for a role="menu"/menuitem popover.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;

      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);

      e.preventDefault();
      if (e.key === "ArrowDown") items[(activeIndex + 1) % items.length]?.focus();
      else if (e.key === "ArrowUp") items[(activeIndex - 1 + items.length) % items.length]?.focus();
      else if (e.key === "Home") items[0]?.focus();
      else items[items.length - 1]?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return { open, setOpen, close, rootRef, triggerRef, panelRef };
}
