import { useEffect, useState } from "react";

export interface TopProgressBarProps {
  /** True while a navigation (or other page-level wait) is in flight. */
  active: boolean;
}

type Phase = "idle" | "running" | "finishing";

/** How long the bar stays on screen, filled and fading, after `active` turns false. */
const FINISH_MS = 300;

/**
 * Thin indeterminate bar along the top edge of the viewport for page changes. The old page stays
 * on screen underneath. Callers delay `active` by 200ms (see `useLoadingGate`) so a near-instant
 * navigation never shows it. It has no known progress, so it is a status ("Loading page") and not a
 * `progressbar`, which would have to report a value.
 */
export function TopProgressBar({ active }: Readonly<TopProgressBarProps>) {
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    if (active) {
      setPhase("running");
      return undefined;
    }
    setPhase((prev) => (prev === "running" ? "finishing" : prev));
    const timer = setTimeout(() => setPhase("idle"), FINISH_MS);
    return () => clearTimeout(timer);
  }, [active]);

  if (phase === "idle") return null;

  return (
    <output className="at-topbar" data-phase={phase} aria-label="Loading page">
      <span className="at-topbar__bar" />
    </output>
  );
}
