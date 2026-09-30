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
 * navigation never shows it.
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
    <div className="at-topbar" data-phase={phase} role="progressbar" aria-label="Loading page">
      <span className="at-topbar__bar" />
    </div>
  );
}
