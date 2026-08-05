import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FOCUSABLE_SELECTOR } from "./focusable.js";
import { useClickOutside, type OutsideInteraction } from "./useClickOutside.js";

/** Open/close state, click-outside, Escape-to-close, and first-`menuitem` focus for a small
 * trigger-button + `role="menu"` popover — was duplicated between the Attendee Detail page's
 * Revoke menu and the Attendees list's Export menu before being extracted here. */
export function useDropdownMenu<
  TTrigger extends HTMLElement = HTMLButtonElement,
  TPanel extends HTMLElement = HTMLDivElement,
>() {
  const [open, setOpen] = useState(false);
  // Whether the panel should anchor above the trigger instead of below it - set once per open,
  // see the layout effect below. Consumers add their own modifier class (e.g.
  // `searchable-select__panel--up`) when this is true; the hook only computes the decision, it
  // doesn't know each consumer's panel class names.
  const [openUpward, setOpenUpward] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<TTrigger>(null);
  const panelRef = useRef<TPanel>(null);

  // `reason === "focus"` means the user already moved focus elsewhere on purpose (e.g. Tab
  // to the next control) — forcing it back to this trigger would trap keyboard navigation,
  // so only restore focus for every other close path (Escape, selecting an item, an
  // outside pointerdown, or a direct programmatic close() call).
  const close = (reason?: OutsideInteraction) => {
    setOpen(false);
    // preventScroll: the trigger is already on-screen (the user just interacted with it) -
    // without this, a trigger near the bottom of a tall, scrolled page (e.g. a card at the
    // end of Active sessions) could get yanked back into view, jumping the whole page.
    if (reason !== "focus") triggerRef.current?.focus({ preventScroll: true });
  };

  useClickOutside(rootRef, open, close);

  // Flip the panel above the trigger when it doesn't fit below - a trigger near the bottom of
  // a tall, scrolled page (e.g. Active sessions' bulk-revoke card, or any Filters button once
  // the page is scrolled down) otherwise opens a panel that renders mostly or entirely below
  // the viewport, forcing an extra manual scroll just to see it. Runs before paint (layout
  // effect, not a regular effect) so the flip never flashes downward-then-upward for a frame.
  // Decided once per open, not continuously - the reported bug is about the initial position,
  // not the trigger moving while the panel is already open.
  useLayoutEffect(() => {
    if (!open) {
      setOpenUpward(false);
      return;
    }
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const triggerRect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const panelHeight = panel.getBoundingClientRect().height;
    // Only flip when upward genuinely has more room - never flip into an even tighter fit.
    setOpenUpward(panelHeight > spaceBelow && spaceAbove > spaceBelow);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Move focus into the popover: the first `menuitem` for a role="menu" popover (Export,
    // More actions), or the first focusable control for a non-menu popover of native form
    // controls (the Attendees list's Filters panel) — without this fallback, focus stayed on
    // the trigger button and nothing told keyboard/screen-reader users the panel had opened
    // (CodeRabbit review).
    const panel = panelRef.current;
    const firstMenuItem = panel?.querySelector<HTMLElement>('[role="menuitem"]');
    // preventScroll: the panel is already positioned right next to its trigger, which the user
    // just clicked - it's already on-screen, so the browser's default "scroll into view" on
    // focus has nothing useful to do here and only risks jumping a long, scrolled page.
    (firstMenuItem ?? panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus({ preventScroll: true });

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
      if (e.key === "ArrowDown") items[(activeIndex + 1) % items.length]?.focus({ preventScroll: true });
      else if (e.key === "ArrowUp") items[(activeIndex - 1 + items.length) % items.length]?.focus({ preventScroll: true });
      else if (e.key === "Home") items[0]?.focus({ preventScroll: true });
      else items.at(-1)?.focus({ preventScroll: true });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return { open, setOpen, close, openUpward, rootRef, triggerRef, panelRef };
}
