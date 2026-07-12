import { useEffect, useRef, useState } from "react";
import { Tabs, type TabsProps } from "@admitto/ui";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const tabCount = props.tabs?.length ?? 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const checkScroll = () => {
      setAtStart(el.scrollLeft <= 2);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
    };

    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
    // Re-measure when the tab set itself changes shape (e.g. superadmin-only tabs
    // appearing/disappearing) — the scrollable width may no longer match.
  }, [tabCount]);

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
