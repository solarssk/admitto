import { useCallback, useMemo } from "react";
import { fetchEventCustomFieldOptionUsage } from "../api/client.js";
import type { EventCustomFieldDto } from "../api/types.js";
import { lookupReady, useOptionsLoad, type OptionsLoad } from "../hooks/useOptionsLoad.js";
import { assertPresent } from "../utils/assert-present.js";

const USAGE_FALLBACK = "Could not load how many attendees use each option.";
const NOTHING_TO_COUNT: Record<string, number> = {};

export interface OptionUsage extends Pick<OptionsLoad<unknown>, "loading" | "error" | "retry" | "retrying"> {
  /** How many attendees hold each option, by the option's saved text. `null` while the lookup is on its way and when it failed:
   * "unknown", never "unused", so that a delete or a rename is not judged harmless before the numbers are in. Nothing is read for
   * a field that is being created, or whose type is not a choice. */
  counts: Record<string, number> | null;
}

/**
 * The attendee counts of a select field's options, read when its editor opens (`useOptionsLoad`: the 30 second limit, and a
 * Retry that reruns this lookup only, never what has been typed). `field` is the one the editor was opened with: it does not
 * change while the editor is open.
 */
export function useOptionUsage(eventId: string, field: EventCustomFieldDto | null): OptionUsage {
  const fieldId = field?.id;
  const enabled = field?.type === "select";
  const load = useCallback(
    async (signal: AbortSignal) => {
      assertPresent(fieldId);
      return Object.entries(await fetchEventCustomFieldOptionUsage(eventId, fieldId, signal));
    },
    [eventId, fieldId],
  );
  const lookup = useOptionsLoad(load, USAGE_FALLBACK, enabled);
  const ready = lookupReady(lookup);
  const items = lookup.items;
  const counts = useMemo(() => {
    if (!enabled) return NOTHING_TO_COUNT;
    return ready ? Object.fromEntries(items) : null;
  }, [enabled, ready, items]);
  return { counts, loading: lookup.loading, error: lookup.error, retry: lookup.retry, retrying: lookup.retrying };
}
