import { computePosition, flip, offset, shift, size, type Placement } from "@floating-ui/dom";
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { attachFixedOverlayLifecycle, getFixedOverlayViewport } from "../utils/fixed-overlay-lifecycle.js";

const VIEWPORT_PAD_PX = 8;

// `left: 0; top: 0` on purpose: a fixed panel is placed with `transform` (below), so its box never
// depends on a position next to its anchor. Without them its width is capped by the room between
// that static position and the viewport's right edge, and it is measured too narrow near that edge.
//
// Not `visibility: hidden` while it waits for its position: that takes the panel out of the
// accessibility tree, and the position is computed a microtask after the panel mounts.
const HIDDEN_FIXED_PANEL: CSSProperties = { position: "fixed", left: 0, top: 0, opacity: 0, pointerEvents: "none" };

export interface FloatingPlacementOptions {
  /** The panel is rendered (and has been committed) while this is true. */
  open: boolean;
  /** The element the panel follows. */
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  /** Called when a scroll outside the panel moves the anchor out from under it. */
  onScrollClose: () => void;
  /** Gap between anchor and panel, in px. Default 4. */
  gap?: number;
  /** "start" puts the panel's left edge under the anchor's left edge (comboboxes, pickers), "end" its
   * right edge under the anchor's right edge (menus). */
  align?: "start" | "end";
  /** Let the panel switch to the other alignment when it does not fit the way `align` puts it (a
   * field near the right edge of the viewport). */
  flipAlignment?: boolean;
  /** The panel's width follows the anchor's (falling back to `minWidth` when the anchor is narrower). */
  matchWidth?: boolean;
  /** Floor for the panel width when `matchWidth` is set. */
  minWidth?: number;
  /** With `matchWidth`: also at least as wide as this element (a field wider than its trigger). */
  widthFloorRef?: RefObject<HTMLElement | null>;
  /** The scrolling list is never taller than this. */
  maxHeight?: number;
  /** The scrolling list is never shorter than this, even when there is less room (it then overflows). */
  minMaxHeight?: number;
  /** Stacking order of the panel. */
  zIndex?: number;
  /** Where the panel is anchored when that is not the anchor's own rect (a field whose input is the
   * vertical anchor but whose width the panel follows). */
  getReferenceRect?: () => { left: number; top: number; width: number; height: number };
  /** Change this to measure again when something other than the panel's own size changed. */
  remeasureKey?: unknown;
}

/** Places a `position: fixed` panel next to an anchor with Floating UI: offset, flip, shift and size
 * against the visual viewport (`getFixedOverlayViewport`), applied as a `transform`. Spread
 * `panelStyle` on the panel and use `openUpward`/`alignedEnd` for classes.
 *
 * Fixed, not absolute, so a scrolling ancestor (a modal body) neither clips the panel nor grows its
 * scroll height around it. Recomputed on open, on a window/visual viewport resize, and when the
 * panel's own size changes. Closes through `onScrollClose` when an ancestor scrolls. */
export function useFloatingPlacement({
  open,
  anchorRef,
  panelRef,
  onScrollClose,
  gap = 4,
  align = "start",
  flipAlignment = false,
  matchWidth = false,
  minWidth,
  widthFloorRef,
  maxHeight: maxHeightCap,
  minMaxHeight = 0,
  zIndex,
  getReferenceRect,
  remeasureKey,
}: FloatingPlacementOptions) {
  // Whether the panel is anchored above the anchor instead of below it. Consumers that need more than
  // `panelStyle` (SearchableSelect reversing its children so the search box stays next to the trigger)
  // add their own modifier class for it.
  const [openUpward, setOpenUpward] = useState(false);
  const [alignedEnd, setAlignedEnd] = useState(align === "end");
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(HIDDEN_FIXED_PANEL);
  const onScrollCloseRef = useRef(onScrollClose);
  onScrollCloseRef.current = onScrollClose;
  const getReferenceRectRef = useRef(getReferenceRect);
  getReferenceRectRef.current = getReferenceRect;
  // Which side the panel opened on. It lives across effect runs (a changed `remeasureKey` runs the
  // effect again) and is dropped only when the panel closes or the available space really changes.
  const lockedSideRef = useRef<"top" | "bottom" | undefined>(undefined);

  useLayoutEffect(() => {
    if (!open) {
      lockedSideRef.current = undefined;
      setOpenUpward(false);
      setPanelStyle(HIDDEN_FIXED_PANEL);
      return;
    }
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    // Type-narrowing only: the anchor always renders, and the panel (`{open && <div ref={panelRef}>}`)
    // has already committed by the time this layout effect runs.
    /* v8 ignore if */
    if (!anchor || !panel) return;

    // Which side the panel opens on is decided on open and again only when the *available space*
    // changes (a real window/visual viewport resize, e.g. a mobile keyboard opening), not every time
    // the panel's own content changes size. Without this lock, a list that shrinks as the user types
    // (a search narrowing to one result) flips a panel that opened upward - because the full list did
    // not fit below - down under the anchor the moment the shorter list does fit there, yanking it out
    // from under the user mid-keystroke (PO report).
    let latestRun = 0;
    let disposed = false;

    const updatePlacement = async (relock: boolean) => {
      if (relock) lockedSideRef.current = undefined;
      const lockedSide = lockedSideRef.current;
      const run = ++latestRun;
      const viewport = getFixedOverlayViewport();
      const rootBoundary = { x: viewport.left, y: viewport.top, width: viewport.width, height: viewport.height };
      const maxWidth = Math.max(0, viewport.width - 2 * VIEWPORT_PAD_PX);
      // Measure the panel at its natural height, but never taller than `maxHeight`: the side is chosen
      // from the height the panel really has, and a max-height from the previous run is a clamp, not
      // the size the content wants.
      panel.style.maxHeight = maxHeightCap === undefined ? "" : `${maxHeightCap}px`;
      panel.style.overflowY = maxHeightCap === undefined ? "" : "auto";
      const placement: Placement = `${lockedSide ?? "bottom"}-${align}`;
      const reference = getReferenceRectRef.current
        ? {
            getBoundingClientRect: () => {
              const { left, top, width, height } = getReferenceRectRef.current!();
              return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
            },
            contextElement: anchor,
          }
        : anchor;
      const result = await computePosition(reference, panel, {
        strategy: "fixed",
        placement,
        middleware: [
          offset(gap),
          ...(lockedSide
            ? []
            : [
                flip({
                  rootBoundary,
                  padding: VIEWPORT_PAD_PX,
                  crossAxis: flipAlignment,
                  fallbackAxisSideDirection: "none",
                }),
              ]),
          shift({ rootBoundary, padding: VIEWPORT_PAD_PX }),
          size({
            rootBoundary,
            padding: VIEWPORT_PAD_PX,
            apply({ availableHeight, rects, elements }) {
              const el = elements.floating;
              // Cap the width to the padded viewport, unless the panel's own CSS already caps it lower
              // (a `max-width: 22rem` is not ours to override with a wider inline value).
              el.style.maxWidth = "";
              const cssMaxWidth = /^([\d.]+)px$/.exec(getComputedStyle(el).maxWidth);
              if (!cssMaxWidth || Number.parseFloat(cssMaxWidth[1]!) > maxWidth) el.style.maxWidth = `${maxWidth}px`;
              // A CSS `min-width` beats `max-width`, so a panel whose minimum is wider than the padded
              // viewport (pinch-zoomed, or a very narrow phone) would still overflow: cap that too.
              el.style.minWidth = "";
              if (Number.parseFloat(getComputedStyle(el).minWidth) > maxWidth) el.style.minWidth = `${maxWidth}px`;
              if (matchWidth) {
                const floor = Math.max(minWidth ?? 0, widthFloorRef?.current?.getBoundingClientRect().width ?? 0);
                el.style.width = `${Math.min(Math.max(floor, rects.reference.width), maxWidth)}px`;
              }
              // `scrollHeight` is the content's natural height, also while a max-height clamps the box
              // (the box's own height would make a clamped panel look like it fits and unclamp it).
              const limit = Math.max(minMaxHeight, Math.min(maxHeightCap ?? Infinity, availableHeight));
              const clamp = el.scrollHeight > limit;
              el.style.maxHeight = clamp ? `${limit}px` : "";
              el.style.overflowY = clamp ? "auto" : "";
            },
          }),
        ],
      });
      // A newer run, or the panel closing, owns the element now.
      if (disposed || run !== latestRun) return;
      const upward = result.placement.startsWith("top");
      lockedSideRef.current = upward ? "top" : "bottom";
      // Put the position on the element in the same task, before React applies `panelStyle`, so a
      // remeasure of a visible panel is never painted in between.
      const transform = `translate(${Math.round(result.x)}px, ${Math.round(result.y)}px)`;
      panel.style.transform = transform;
      panel.style.opacity = "";
      panel.style.pointerEvents = "";
      setOpenUpward(upward);
      setAlignedEnd(result.placement.endsWith("-end"));
      setPanelStyle({ position: "fixed", left: 0, top: 0, transform, zIndex });
    };

    void updatePlacement(false);
    const detachOverlayLifecycle = attachFixedOverlayLifecycle(
      panel,
      () => void updatePlacement(true),
      () => onScrollCloseRef.current(),
    );

    // Re-run placement when the panel's own rendered size changes, not just on window resize: a list
    // that shrinks by hundreds of pixels as the user types leaves a panel above its anchor hanging
    // from its old height. Guarded, not assumed present: real browsers all support it, jsdom does not.
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
  }, [
    open,
    align,
    gap,
    flipAlignment,
    matchWidth,
    minWidth,
    maxHeightCap,
    minMaxHeight,
    zIndex,
    remeasureKey,
    anchorRef,
    panelRef,
    widthFloorRef,
  ]);

  return { openUpward, alignedEnd, panelStyle };
}
