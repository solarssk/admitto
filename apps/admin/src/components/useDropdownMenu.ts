import { useEffect, useRef, useState } from "react";
import { FOCUSABLE_SELECTOR } from "./focusable.js";
import { useFocusRecovery } from "./useFocusRecovery.js";
import { useClickOutside, type OutsideInteraction } from "./useClickOutside.js";
import { useFloatingPlacement } from "./useFloatingPlacement.js";

// Module-level, not React state: read synchronously from useModalFocusTrap's native capture-
// phase keydown listener, which runs before any state update from this hook's own render cycle
// could reach it. Tracks how many dropdown menus are open anywhere in the app (not just inside
// one modal instance) so a modal's Escape handler can defer to a nested picker's own Escape
// handler instead of closing the whole modal (or opening its discard-confirmation) out from
// under an open SearchableSelect/PhoneCountrySelect panel (bot review finding, #755).
let openDropdownCount = 0;

/** Whether any `useDropdownMenu`-based popover is currently open. */
export function isAnyDropdownMenuOpen(): boolean {
  return openDropdownCount > 0;
}

export interface UseDropdownMenuOptions {
  /** Gap between trigger and panel, in px. Default 4. */
  gap?: number;
  /** "start" anchors the panel's left edge under the trigger's left edge (comboboxes:
   * SearchableSelect, PhoneCountrySelect). "end" anchors its right edge under the trigger's
   * right edge (every menu-style consumer: More actions, Export, Filters, User menu). */
  align?: "start" | "end";
  /** "start" alignment only: the panel's width tracks the trigger's own width (falling back to
   * `minWidth` when the trigger is narrower) instead of the panel's own natural/CSS width. */
  matchTriggerWidth?: boolean;
  /** Floor for the panel width when `matchTriggerWidth` is set. */
  minWidth?: number;
  /** While true, the panel stays rendered (`open` unchanged) but this hook stops counting
   * itself in `openDropdownCount` and stops listening for its own Escape/arrow-key handling -
   * the same "suspend the parent while a child modal is open" pattern AGENTS.md documents for
   * `useModalFocusTrap`, applied here for a `ConfirmDialog` opened from inside a dropdown panel
   * (e.g. NotificationBell's "Clear all"). Without this, the panel staying open the whole time
   * the dialog is up means `isAnyDropdownMenuOpen()` stays true, so the dialog's own Escape
   * handler always steps aside for what it thinks is a nested combobox - instead the dropdown's
   * bubble-phase Escape handler fires, closing the panel out from under the still-open dialog. */
  escapeSuspended?: boolean;
}

/** Open/close state, click-outside, Escape-to-close, first-`menuitem` focus, and `position:
 * fixed` placement (viewport-clamped, closes on an ancestor scroll) for a small trigger-button
 * + popover panel — was duplicated between the Attendee Detail page's Revoke menu and the
 * Attendees list's Export menu before being extracted here.
 *
 * The panel is `position: fixed`, placed by Floating UI (`computePosition` with offset, flip, shift
 * and size, applied as a `transform`) relative to the trigger's own rect, NOT `position: absolute`
 * inside a `position: relative`
 * wrapper. A plain `absolute` panel is clipped by - and inflates the scroll height of - the
 * nearest ancestor with `overflow: auto`/`hidden` (e.g. a modal's own scrolling body), which
 * turns the popover into part of the scrollable content instead of floating over it (PO
 * report: the Invite/Edit user role picker grew a scrollbar and "bounced" on close because
 * closing it shrank that inflated scroll height out from under the current scroll position).
 * `position: fixed`'s containing block is the viewport (not the nearest scrolling ancestor), so
 * this escapes that clipping without a portal - `useClickOutside`'s DOM-containment check
 * (`rootRef`) keeps working unmodified since the panel is still a normal DOM child. */
export function useDropdownMenu<
  TTrigger extends HTMLElement = HTMLButtonElement,
  TPanel extends HTMLElement = HTMLDivElement,
>(options: UseDropdownMenuOptions = {}) {
  const { gap = 4, align = "start", matchTriggerWidth = false, minWidth, escapeSuspended = false } = options;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<TTrigger>(null);
  const panelRef = useRef<TPanel>(null);
  // A control in the panel that goes away (a button hidden once its job is done) must not leave focus on <body>.
  useFocusRecovery(panelRef, open);

  useEffect(() => {
    if (!open || escapeSuspended) return;
    openDropdownCount += 1;
    return () => {
      openDropdownCount -= 1;
    };
  }, [open, escapeSuspended]);

  // `reason === "focus"`/`"scroll"` mean, respectively, that the user already moved focus
  // elsewhere on purpose (e.g. Tab to the next control) or that an ancestor scroll closed this
  // fixed panel out from under itself - forcing focus back to the trigger would either trap
  // keyboard navigation or yank the page back to the trigger and undo that scroll. Every other
  // close path (Escape, selecting an item, an outside pointerdown, a direct close() call)
  // restores focus as normal.
  const close = (reason?: OutsideInteraction) => {
    setOpen(false);
    if (reason !== "focus" && reason !== "scroll") triggerRef.current?.focus({ preventScroll: true });
  };

  useClickOutside(rootRef, open, close);

  // `openUpward` is for consumers that need more than the position from `panelStyle` (SearchableSelect
  // and PhoneCountrySelect reverse their children so the search box stays next to the trigger): the
  // hook only decides, it doesn't know each consumer's class names.
  const { openUpward, panelStyle } = useFloatingPlacement({
    open,
    anchorRef: triggerRef,
    panelRef,
    onScrollClose: () => close("scroll"),
    gap,
    align,
    matchWidth: matchTriggerWidth,
    minWidth,
  });


  useEffect(() => {
    if (!open || escapeSuspended) return;
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
  }, [open, escapeSuspended]);

  return { open, setOpen, close, openUpward, panelStyle, rootRef, triggerRef, panelRef };
}
