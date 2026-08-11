import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { FOCUSABLE_SELECTOR } from "./focusable.js";
import { useClickOutside, type OutsideInteraction } from "./useClickOutside.js";
import { attachFixedOverlayLifecycle, getFixedOverlayViewport } from "../utils/fixed-overlay-lifecycle.js";

const VIEWPORT_PAD_PX = 8;

const HIDDEN_FIXED_PANEL: CSSProperties = { position: "fixed", visibility: "hidden" };

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
}

/** Open/close state, click-outside, Escape-to-close, first-`menuitem` focus, and `position:
 * fixed` placement (viewport-clamped, closes on an ancestor scroll) for a small trigger-button
 * + popover panel — was duplicated between the Attendee Detail page's Revoke menu and the
 * Attendees list's Export menu before being extracted here.
 *
 * The panel is `position: fixed` with coordinates computed from the trigger's own
 * `getBoundingClientRect()` (the DeliveryRowMenu/DatePicker/TimezoneSelect pattern -
 * `attachFixedOverlayLifecycle`), NOT `position: absolute` inside a `position: relative`
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
  const { gap = 4, align = "start", matchTriggerWidth = false, minWidth } = options;
  const [open, setOpen] = useState(false);
  // Whether the panel is anchored above the trigger instead of below it - set once per open,
  // see the layout effect below. Consumers that need more than the `top`/`left` from
  // `panelStyle` (e.g. SearchableSelect/PhoneCountrySelect reversing their child order so the
  // search box stays next to the trigger) add their own modifier class for that when this is
  // true; the hook only computes the decision, it doesn't know each consumer's class names.
  const [openUpward, setOpenUpward] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(HIDDEN_FIXED_PANEL);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<TTrigger>(null);
  const panelRef = useRef<TPanel>(null);

  useEffect(() => {
    if (!open) return;
    openDropdownCount += 1;
    return () => {
      openDropdownCount -= 1;
    };
  }, [open]);

  // `reason === "focus"`/`"scroll"` mean, respectively, that the user already moved focus
  // elsewhere on purpose (e.g. Tab to the next control) or that an ancestor scroll closed this
  // fixed panel out from under itself - forcing focus back to the trigger would either trap
  // keyboard navigation or yank the page back to the trigger and undo that scroll. Every other
  // close path (Escape, selecting an item, an outside pointerdown, a direct close() call)
  // restores focus as normal.
  const close = (reason?: OutsideInteraction) => {
    setOpen(false);
    setPanelStyle(HIDDEN_FIXED_PANEL);
    if (reason !== "focus" && reason !== "scroll") triggerRef.current?.focus({ preventScroll: true });
  };

  useClickOutside(rootRef, open, close);

  // Places the panel with `position: fixed`, computed from the trigger's own
  // getBoundingClientRect() - see this hook's own doc comment for why fixed (not absolute)
  // coordinates, not a CSS class, are what escape a scrollable modal body. Flips above the
  // trigger when the panel doesn't fit below (a trigger near the bottom of a tall, scrolled
  // page/modal otherwise opens a panel that renders mostly or entirely off-screen), and clamps
  // horizontally to the viewport. Recomputed on open and again on resize/ancestor-scroll
  // (`attachFixedOverlayLifecycle`) - decided once per *content* otherwise, same as before:
  // the reported bug was about the initial position, not the trigger moving while the panel is
  // already open with the same content.
  useLayoutEffect(() => {
    if (!open) {
      setOpenUpward(false);
      setPanelStyle(HIDDEN_FIXED_PANEL);
      return;
    }
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    // Type-narrowing only: triggerRef's element always renders regardless of `open`, and
    // panelRef's `{open && <div ref={panelRef}>}` has already committed by the time this
    // layout effect runs (it fires synchronously after DOM mutations, keyed on the same
    // `open` this effect reads) - so both are already set whenever this line is reached.
    /* v8 ignore if */
    if (!trigger || !panel) return;

    const updatePlacement = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const panelWidth = matchTriggerWidth
        ? Math.max(minWidth ?? 0, triggerRect.width)
        : panel.getBoundingClientRect().width;
      // `scrollHeight` stays natural after this effect applies a maxHeight, while the bounding
      // rect covers test environments and panels whose content has no scroll container.
      const panelHeight = Math.max(panel.scrollHeight, panel.getBoundingClientRect().height);
      const viewport = getFixedOverlayViewport();
      const spaceBelow = viewport.height - triggerRect.bottom;
      const spaceAbove = triggerRect.top;
      // Only flip when upward genuinely has more room - never flip into an even tighter fit.
      const above = panelHeight > spaceBelow && spaceAbove > spaceBelow;
      const available = Math.max(0, (above ? spaceAbove : spaceBelow) - gap - VIEWPORT_PAD_PX);
      const maxHeight = panelHeight > available ? Math.max(160, available) : undefined;
      const usedHeight = Math.min(panelHeight, maxHeight ?? panelHeight);
      const top = above ? triggerRect.top - usedHeight - gap : triggerRect.bottom + gap;

      let left = align === "end" ? triggerRect.right - panelWidth : triggerRect.left;
      left = Math.min(left, viewport.width - VIEWPORT_PAD_PX - panelWidth);
      left = Math.max(left, VIEWPORT_PAD_PX);

      setOpenUpward(above);
      setPanelStyle({
        position: "fixed",
        top,
        left,
        width: matchTriggerWidth ? panelWidth : undefined,
        maxHeight: maxHeight ? `${maxHeight}px` : undefined,
        overflowY: maxHeight ? "auto" : undefined,
        visibility: "visible",
      });
    };

    updatePlacement();
    const detachOverlayLifecycle = attachFixedOverlayLifecycle(panel, updatePlacement, () => close("scroll"));

    // Re-run placement when the panel's own rendered size changes, not just on window resize -
    // SearchableSelect/PhoneCountrySelect's list shrinks by hundreds of pixels as the user types
    // into the search box, and a panel flipped above the trigger anchors its `top` from that
    // height (`top = triggerRect.top - panelHeight - gap`); without this, the stale `top` stays
    // put while the shorter content renders under it, opening a growing gap between the panel's
    // own bottom edge and the trigger it's meant to hug (bot review finding). Guarded, not
    // assumed present - real browsers all support it, but jsdom (this hook's ~200 other tests)
    // does not and has no reason to.
    if (typeof ResizeObserver === "undefined") return detachOverlayLifecycle;
    const resizeObserver = new ResizeObserver(updatePlacement);
    resizeObserver.observe(panel);
    return () => {
      detachOverlayLifecycle();
      resizeObserver.disconnect();
    };
  }, [open, align, gap, matchTriggerWidth, minWidth]);

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

  return { open, setOpen, close, openUpward, panelStyle, rootRef, triggerRef, panelRef };
}
