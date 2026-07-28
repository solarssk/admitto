import { useEffect, useState } from "react";

const DESKTOP_BREAKPOINT = 768;

function readDesktopMatch(breakpoint: number): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(`(min-width: ${breakpoint}px)`).matches;
}

/** Optional `breakpoint` overrides the default 768px (e.g. a wider one for content, like the
 * Attendees table, that needs more room than 768px allows before its own desktop layout fits). */
export function useIsDesktop(breakpoint: number = DESKTOP_BREAKPOINT): boolean {
  const [isDesktop, setIsDesktop] = useState(() => readDesktopMatch(breakpoint));

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);

  return isDesktop;
}

export function isDesktopViewport(): boolean {
  return readDesktopMatch(DESKTOP_BREAKPOINT);
}
