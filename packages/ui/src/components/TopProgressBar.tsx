import { useEffect, useState } from "react";

export interface TopProgressBarProps {
  /** True while a navigation (or other page-level wait) is in flight. */
  active: boolean;
  /**
   * `viewport` (default) runs along the top edge of the window, for a page change. `container` runs
   * along the top edge of its nearest positioned ancestor (`position: relative`), for a list or card
   * whose data is being refetched while the old data stays on screen, dimmed.
   */
  placement?: "viewport" | "container";
  /** What assistive tech announces for the wait. */
  label?: string;
  /**
   * Short visible line under the bar, reserved for the "taking longer than usual" message that
   * follows a wait of 8 seconds. It is shown only while the bar is running.
   */
  note?: string;
}

type Phase = "idle" | "running" | "finishing";

/** How long the bar stays on screen, filled and fading, after `active` turns false. */
const FINISH_MS = 300;

/**
 * Thin indeterminate bar along the top edge of the viewport for page changes, or of a card or list
 * that is being refetched (`placement="container"`). The old page or data stays on screen underneath.
 * Callers delay `active` by 200ms (see `useLoadingGate`) so a near-instant wait never shows it. It has
 * no known progress, so it is a status ("Loading page") and not a `progressbar`, which would have to
 * report a value.
 */
export function TopProgressBar({
  active,
  placement = "viewport",
  label = "Loading page",
  note,
}: Readonly<TopProgressBarProps>) {
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
    <>
      <output
        className={placement === "container" ? "at-topbar at-topbar--container" : "at-topbar"}
        data-phase={phase}
        aria-label={label}
      >
        <span className="at-topbar__bar" />
      </output>
      {note && phase === "running" && <output className="at-topbar-note">{note}</output>}
    </>
  );
}
