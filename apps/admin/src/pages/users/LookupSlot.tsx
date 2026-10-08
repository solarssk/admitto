import type { ReactNode } from "react";
import { Skeleton } from "@admitto/ui";
import { RetryHint } from "../../components/RetryHint.js";
import { SlowNote } from "../../components/SlowNote.js";
import { useLoadingGate } from "../../hooks/useDelayedLoading.js";
import type { OptionsLoad } from "../../hooks/useOptionsLoad.js";
import "../users-page.css";

/**
 * The place of a field whose options come from a lookup of its own (the events of an Operator scope, the organizations
 * of an Admin scope): while that lookup's first request is on its way, a placeholder with the field's room (invisible
 * for the first 200ms, so a quick answer shows no flash, and saying so after 8 seconds); when it failed, the field with a one-line hint and a Retry
 * that reruns that lookup only, so what has been typed and the other lookups stay as they are. The field itself is
 * the caller's (`children`): it should be disabled while `lookup.error` is set.
 */
export function LookupSlot({
  lookup,
  label,
  showHint = true,
  children,
}: Readonly<{
  lookup: Pick<OptionsLoad<unknown>, "loading" | "error" | "retry" | "retrying" | "slow">;
  label: string;
  /** False when the caller says the failure itself, once, for several fields (and gives it the Retry). */
  showHint?: boolean;
  children: ReactNode;
}>) {
  const gate = useLoadingGate(lookup.loading);
  if (!gate.showContent) {
    return (
      <output aria-label={`Loading ${label}`} className={gate.showIndicator ? "users-modal__lookup-skeleton" : "users-modal__lookup-skeleton at-loading-hold"}>
        <Skeleton variant="rect" width="35%" height={17} />
        <Skeleton variant="rect" height={38} />
        {lookup.slow ? <SlowNote /> : null}
      </output>
    );
  }
  return (
    <>
      {children}
      {showHint && lookup.error && (
        <RetryHint message={lookup.error} busy={lookup.retrying} onRetry={lookup.retry} retryLabel={`Retry loading ${label}`} />
      )}
    </>
  );
}
