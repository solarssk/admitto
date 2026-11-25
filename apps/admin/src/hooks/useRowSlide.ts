import { useLayoutEffect, useRef, type RefObject } from "react";

/** How long a row takes to slide to its new place. */
const SLIDE_MS = 180;

/**
 * Slides the rows of a list to their new places when their order changes, so that a row that is moved does not jump: each row
 * that is now somewhere else starts at the place it had and runs to the place it has. The rows are the elements with a
 * `data-row-id` under `rootRef`, and `order` is their ids as they are drawn, which is how the hook knows that the order
 * changed (a row that is added or deleted slides nothing itself, but the rows under it follow it). The places are read after
 * every render, so a row that grew or shrank meanwhile is not taken for a move later. A row that is moved again while it is still
 * sliding adds its new slide to the one that is running (`composite: "add"`), so it carries on from where it is on the screen
 * instead of jumping to the place it was going to.
 *
 * Skipped where there is nothing to play it with (jsdom has no Web Animations) and under `prefers-reduced-motion`.
 */
export function useRowSlide(rootRef: RefObject<HTMLElement | null>, order: readonly string[]): void {
  const orderRef = useRef(order);
  const topsRef = useRef(new Map<HTMLElement, number>());

  // No list of dependencies on purpose: the places are read after every render, not only after a change of order.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const tops = new Map(Array.from(root.querySelectorAll<HTMLElement>("[data-row-id]"), (row) => [row, row.offsetTop]));
    const before = topsRef.current;
    const reordered = orderRef.current.join("\n") !== order.join("\n");
    topsRef.current = tops;
    orderRef.current = order;
    if (!reordered || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    for (const [row, to] of tops) {
      const from = before.get(row);
      if (from === undefined || from === to || typeof row.animate !== "function") continue;
      row.animate({ transform: [`translateY(${from - to}px)`, "translateY(0)"] }, { duration: SLIDE_MS, easing: "ease-out", composite: "add" });
    }
  });
}
