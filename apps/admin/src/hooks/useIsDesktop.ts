import { useEffect, useState } from "react";

const DESKTOP_BREAKPOINT = 768;

function readDesktopMatch(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`).matches;
}

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(readDesktopMatch);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}

export function isDesktopViewport(): boolean {
  return readDesktopMatch();
}
