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
      <div className="scroll-fade-tabs__scroll" ref={scrollRef}>
        <Tabs {...props} />
      </div>
    </div>
  );
}
