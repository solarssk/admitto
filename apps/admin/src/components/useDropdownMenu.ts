import { computePosition, flip, offset, shift, size, type Placement } from "@floating-ui/dom";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { FOCUSABLE_SELECTOR } from "./focusable.js";
import { useFocusRecovery } from "./useFocusRecovery.js";
import { useClickOutside, type OutsideInteraction } from "./useClickOutside.js";
import { attachFixedOverlayLifecycle, getFixedOverlayViewport } from "../utils/fixed-overlay-lifecycle.js";

const VIEWPORT_PAD_PX = 8;

// `left: 0; top: 0` on purpose: a fixed panel is placed with `transform` (below), so its box never
// depends on a position next to the trigger. Without them its width is capped by the room between
// that static position and the viewport's right edge, and it is measured too narrow near that edge.
//
// Not `visibility: hidden` while it waits for its position: that takes the panel out of the
// accessibility tree, and the position is computed a microtask after the panel mounts.
const HIDDEN_FIXED_PANEL: CSSProperties = { position: "fixed", left: 0, top: 0, opacity: 0, pointerEvents: "none" };

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
    setPanelStyle(HIDDEN_FIXED_PANEL);
    if (reason !== "focus" && reason !== "scroll") triggerRef.current?.focus({ preventScroll: true });
  };

  useClickOutside(rootRef, open, close);

  // Places the panel with Floating UI (`computePosition`: offset, flip, shift, size) in `position:
  // fixed` coordinates, applied with `transform` - see this hook's own doc comment for why fixed
  // (not absolute) is what escapes a scrollable modal body. The visible area is the visual
  // viewport (`getFixedOverlayViewport`), so a mobile keyboard or a pinch-zoom is respected, and
  // everything keeps `VIEWPORT_PAD_PX` from its edges. Recomputed on open, on a window/visual
  // viewport resize, and when the panel's own size changes.
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

    // Which side the panel opens on is decided on open and again only when the *available space*
    // changes (a real window/visual viewport resize, e.g. a mobile keyboard opening), not every time
    // the panel's own content changes size. Without this lock, SearchableSelect's list shrinking as
    // the user types (a search narrowing to one result) flips a panel that opened upward - because
    // the full option list did not fit below - down under the trigger the moment the shorter list
    // does fit there, yanking it out from under the user mid-keystroke (PO report).
    let lockedSide: "top" | "bottom" | undefined;
    let latestRun = 0;
    let disposed = false;

    const updatePlacement = async (relock: boolean) => {
      if (relock) lockedSide = undefined;
      const run = ++latestRun;
      const viewport = getFixedOverlayViewport();
      const rootBoundary = { x: viewport.left, y: viewport.top, width: viewport.width, height: viewport.height };
      const maxWidth = Math.max(0, viewport.width - 2 * VIEWPORT_PAD_PX);
      // Measure the panel at its natural height: a max-height from the previous run is a clamp, not
      // the size the content wants.
      panel.style.maxHeight = "";
      panel.style.overflowY = "";
      const placement: Placement = `${lockedSide ?? "bottom"}-${align === "end" ? "end" : "start"}`;
      const result = await computePosition(trigger, panel, {
        strategy: "fixed",
        placement,
        middleware: [
          offset(gap),
          ...(lockedSide ? [] : [flip({ rootBoundary, padding: VIEWPORT_PAD_PX, crossAxis: false, fallbackAxisSideDirection: "none" })]),
          shift({ rootBoundary, padding: VIEWPORT_PAD_PX }),
          size({
            rootBoundary,
            padding: VIEWPORT_PAD_PX,
            apply({ availableHeight, rects, elements }) {
              const el = elements.floating;
              el.style.maxWidth = `${maxWidth}px`;
              // A CSS `min-width` beats `max-width`, so a panel whose minimum is wider than the padded
              // viewport (pinch-zoomed, or a very narrow phone) would still overflow: cap that too.
              el.style.minWidth = "";
              if (Number.parseFloat(getComputedStyle(el).minWidth) > maxWidth) el.style.minWidth = `${maxWidth}px`;
              if (matchTriggerWidth) {
                el.style.width = `${Math.min(Math.max(minWidth ?? 0, rects.reference.width), maxWidth)}px`;
              }
              // `scrollHeight` is the content's natural height, also while a max-height clamps the box
              // (the box's own height would make a clamped panel look like it fits and unclamp it).
              const clamp = el.scrollHeight > availableHeight;
              el.style.maxHeight = clamp ? `${availableHeight}px` : "";
              el.style.overflowY = clamp ? "auto" : "";
            },
          }),
        ],
      });
      // A newer run, or the panel closing, owns the element now.
      if (disposed || run !== latestRun) return;
      const upward = result.placement.startsWith("top");
      lockedSide = upward ? "top" : "bottom";
      // Put the position on the element in the same task, before React applies `panelStyle`, so a
      // remeasure of a visible panel is never painted in between.
      const transform = `translate(${Math.round(result.x)}px, ${Math.round(result.y)}px)`;
      panel.style.transform = transform;
      panel.style.opacity = "";
      panel.style.pointerEvents = "";
      setOpenUpward(upward);
      setPanelStyle({ position: "fixed", left: 0, top: 0, transform });
    };

    void updatePlacement(true);
    const detachOverlayLifecycle = attachFixedOverlayLifecycle(
      panel,
      () => void updatePlacement(true),
      () => close("scroll"),
    );

    // Re-run placement when the panel's own rendered size changes, not just on window resize:
    // SearchableSelect/PhoneCountrySelect's list shrinks by hundreds of pixels as the user types, and
    // a panel above the trigger is anchored by its bottom edge, so the position has to follow. Guarded,
    // not assumed present: real browsers all support it, but jsdom does not.
    if (typeof ResizeObserver === "undefined") {
      return () => {
        disposed = true;
        detachOverlayLifecycle();
      };
    }
    const resizeObserver = new ResizeObserver(() => void updatePlacement(false));
    resizeObserver.observe(panel);
    return () => {
      disposed = true;
      detachOverlayLifecycle();
      resizeObserver.disconnect();
    };
  }, [open, align, gap, matchTriggerWidth, minWidth]);

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
