import { useLayoutEffect } from "react";
import { Tabs, type TabsProps } from "@admitto/ui";
import { useScrollFade } from "../hooks/useScrollFade.js";
import "./scroll-fade-tabs.css";

/**
 * Wraps the shared <Tabs> in a horizontally-scrollable strip with soft edge
 * fades that hint "more this way" instead of a visible OS scrollbar. Use this
 * (instead of <Tabs> directly) on pages whose tab row can realistically
 * overflow — many tabs and/or narrow viewports (Event Settings, instance
 * Settings) — while pages with a couple of tabs that will never overflow can
 * keep using the plain <Tabs>. The native scrollbar is hidden via CSS; each
 * fade disappears once you've scrolled all the way to that side.
 */
export function ScrollFadeTabs(props: TabsProps) {
  const tabCount = props.tabs?.length ?? 0;
  // Re-measures when the tab set itself changes shape (e.g. superadmin-only tabs
  // appearing/disappearing) — the scrollable width may no longer match.
  const { scrollRef, atStart, atEnd } = useScrollFade<HTMLDivElement>(tabCount);

  // Keeps the active tab visible whenever it changes (including on mount, e.g. a deep link
  // straight to a tab near the end of the strip) — without this the strip always starts
  // scrolled to position 0, so on a narrow viewport there's no way to tell which tab is
  // active without manually scrolling to find it. `block: "nearest"` (not "center") mirrors
  // AuditLogPanel's own scroll-restore precedent: only move the minimum needed, never
  // disturb an axis that's already fine — here that's the vertical page scroll.
  useLayoutEffect(() => {
    scrollRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [scrollRef, props.value, tabCount]);

  const scrollByArrow = (direction: 1 | -1) => {
    scrollRef.current?.scrollBy({ left: direction * 160, behavior: "smooth" });
  };

  return (
    <div
      className={[
        "scroll-fade-tabs",
        atStart && "scroll-fade-tabs--at-start",
        atEnd && "scroll-fade-tabs--at-end",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {!atStart && (
        <button
          type="button"
          className="scroll-fade-tabs__arrow scroll-fade-tabs__arrow--left"
          aria-label="Scroll tabs left"
          onClick={() => scrollByArrow(-1)}
        >
          <i className="ti ti-chevron-left" aria-hidden="true" />
        </button>
      )}
      <div className="scroll-fade-tabs__scroll" ref={scrollRef}>
        <Tabs {...props} />
      </div>
      {!atEnd && (
        <button
          type="button"
          className="scroll-fade-tabs__arrow scroll-fade-tabs__arrow--right"
          aria-label="Scroll tabs right"
          onClick={() => scrollByArrow(1)}
        >
          <i className="ti ti-chevron-right" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
