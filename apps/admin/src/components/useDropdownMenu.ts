import { useEffect, useRef, useState } from "react";
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
    // Move focus into the menu when it opens.
    panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return { open, setOpen, close, rootRef, triggerRef, panelRef };
}
