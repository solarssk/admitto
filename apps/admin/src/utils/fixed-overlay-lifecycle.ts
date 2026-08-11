/** The actually visible viewport. On iOS Safari this shrinks when the software keyboard opens,
 * while `window.innerHeight` can keep reporting the full layout viewport. */
export function getFixedOverlayViewport(): { width: number; height: number } {
  const visualViewport = window.visualViewport;
  return {
    width: visualViewport?.width || window.innerWidth,
    height: visualViewport?.height || window.innerHeight,
  };
}

/**
 * Keep a `position: fixed` popover aligned while the viewport resizes, and close it when a
 * scroll ancestor moves under it (e.g. an `overflow: auto` modal body). Scrolls that originate
 * inside the panel itself (clamped maxHeight) are ignored so the user can still scroll the list.
 * `VisualViewport` events cover mobile software-keyboard open/close, which do not reliably fire
 * a window resize on iOS Safari.
 */
export function attachFixedOverlayLifecycle(
  panel: HTMLElement | null | undefined,
  onResize: () => void,
  onOutsideScroll: () => void,
): () => void {
  window.addEventListener("resize", onResize);
  const visualViewport = window.visualViewport;
  visualViewport?.addEventListener("resize", onResize);
  visualViewport?.addEventListener("scroll", onResize);
  const onScroll = (event: Event) => {
    const target = event.target;
    if (panel && target instanceof Node && panel.contains(target)) return;
    onOutsideScroll();
  };
  window.addEventListener("scroll", onScroll, true);
  return () => {
    window.removeEventListener("resize", onResize);
    visualViewport?.removeEventListener("resize", onResize);
    visualViewport?.removeEventListener("scroll", onResize);
    window.removeEventListener("scroll", onScroll, true);
  };
}
