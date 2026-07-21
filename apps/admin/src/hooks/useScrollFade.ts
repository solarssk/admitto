import { useEffect, useRef, useState } from "react";

/**
 * Tracks whether a horizontally-scrollable element is at its start/end, driving the "more
 * this way" edge fades shared by ScrollFadeTabs and any other horizontally-scrolling strip
 * (see scroll-fade-tabs.css). `dep` re-measures when the scrollable content's shape changes
 * (e.g. item count) without a new scroll event.
 */
export function useScrollFade<T extends HTMLElement>(dep?: unknown) {
  const scrollRef = useRef<T>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

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
  }, [dep]);

  return { scrollRef, atStart, atEnd };
}
