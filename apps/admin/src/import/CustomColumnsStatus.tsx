import { Skeleton } from "@admitto/ui";
import { RetryHint } from "../components/RetryHint.js";
import { useLoadingGate } from "../hooks/useDelayedLoading.js";
import type { OptionsLoad } from "../hooks/useOptionsLoad.js";
import "../pages/import.css";

/**
 * What the "Required CSV columns" table says about the custom columns of the event, which are a lookup of their own: while its
 * first request is on its way, a placeholder (invisible for the first 200ms, so a quick answer shows no flash); when it failed,
 * a one-line hint and a Retry that reruns that lookup only, because a table without the event's own columns must not pass for
 * the whole list.
 */
export function CustomColumnsStatus({ lookup }: Readonly<{ lookup: Pick<OptionsLoad<unknown>, "loading" | "error" | "retry" | "retrying"> }>) {
  const gate = useLoadingGate(lookup.loading);
  if (!gate.showContent) {
    return (
      <output aria-label="Loading custom columns" className={gate.showIndicator ? "import-custom-columns-skeleton" : "import-custom-columns-skeleton at-loading-hold"}>
        <Skeleton variant="rect" height={18} />
      </output>
    );
  }
  if (!lookup.error) return null;
  return <RetryHint message={lookup.error} busy={lookup.retrying} onRetry={lookup.retry} retryLabel="Retry loading custom columns" />;
}
