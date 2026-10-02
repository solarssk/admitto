import type { ReactNode } from "react";
import { TopProgressBar } from "@admitto/ui";
import { useLoadingGate } from "../hooks/useDelayedLoading.js";
import { refetchCardProps } from "../utils/refetch-card.js";

/**
 * The part of a screen whose data stays on screen while it is refetched (AGENTS.md "Admin SPA loading and busy
 * states"): at once nothing in it reacts to a click or a key, once the wait is noticeable (200ms) it is dimmed
 * and a thin bar runs along its top, and a screen reader is told. The controls that started the work (a pager, a
 * filter) usually sit inside it, so it does not use `inert`, which would take their keyboard focus away.
 */
export function RefetchRegion({
  refreshing,
  label,
  children,
}: Readonly<{ refreshing: boolean; label: string; children: ReactNode }>) {
  const gate = useLoadingGate(refreshing);
  return (
    <>
      {/* Outside the busy region: what a screen reader is told about the pause. */}
      <output className="sr-only">{gate.showIndicator ? `${label}. Actions are paused until it finishes.` : ""}</output>
      <div {...refetchCardProps(refreshing, gate.showIndicator, true)}>
        <TopProgressBar active={gate.showIndicator} placement="container" label={label} />
        {children}
      </div>
    </>
  );
}
