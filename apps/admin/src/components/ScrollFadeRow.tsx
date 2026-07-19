import type { ReactNode } from "react";
import { useScrollFade } from "../hooks/useScrollFade.js";
import "./scroll-fade-tabs.css";

export interface ScrollFadeRowProps {
  className?: string;
  children: ReactNode;
  /** Re-measure when the scrollable content's shape changes (e.g. an item count) without a
   * new scroll event — same purpose as ScrollFadeTabs' tabCount dependency. */
  watch?: unknown;
}

/** Generic horizontally-scrollable strip with soft edge fades — same visual/interaction
 * pattern as ScrollFadeTabs, for content other than <Tabs>. Use this whenever a row of
 * controls must always render as a single row of fixed height and never wrap across
 * breakpoints (e.g. the attendees search + filter row, PO review — narrower viewports scroll
 * the row horizontally instead of stacking it into multiple lines). */
export function ScrollFadeRow({ className, children, watch }: Readonly<ScrollFadeRowProps>) {
  const { scrollRef, atStart, atEnd } = useScrollFade<HTMLDivElement>(watch);

  return (
    <div
      className={["scroll-fade-tabs", atStart && "scroll-fade-tabs--at-start", atEnd && "scroll-fade-tabs--at-end", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="scroll-fade-tabs__scroll" ref={scrollRef}>
        {children}
      </div>
    </div>
  );
}
