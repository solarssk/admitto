/**
 * Keep a `position: fixed` popover aligned while the viewport resizes, and close it when a
 * scroll ancestor moves under it (e.g. an `overflow: auto` modal body). Scrolls that originate
 * inside the panel itself (clamped maxHeight) are ignored so the user can still scroll the list.
 */
export function attachFixedOverlayLifecycle(
  panel: HTMLElement | null | undefined,
  onResize: () => void,
  onOutsideScroll: () => void,
): () => void {
  window.addEventListener("resize", onResize);
  const onScroll = (event: Event) => {
    if (panel?.contains(event.target as Node)) return;
    onOutsideScroll();
  };
  window.addEventListener("scroll", onScroll, true);
  return () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll, true);
  };
}
