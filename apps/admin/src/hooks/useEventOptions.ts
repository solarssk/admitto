import { useCallback } from "react";
import { fetchAdminEvents } from "../api/client.js";
import { useOptionsLoad } from "./useOptionsLoad.js";

/**
 * The events that a filter or a picker offers (archived ones too, unless `includeArchived` is false). A failure is
 * not an empty list: it says so (`error`) and has a Retry (`retry`, busy for at least 400ms as `retrying`) that
 * reruns this request only. The request has the 30 second limit and is abandoned when the page is left.
 */
export function useEventOptions({ includeArchived = true, enabled = true }: { includeArchived?: boolean; enabled?: boolean } = {}) {
  const load = useCallback((signal: AbortSignal) => fetchAdminEvents({ includeArchived, signal }), [includeArchived]);
  const { items, ...rest } = useOptionsLoad(load, "Could not load events.", enabled);
  return { events: items, ...rest };
}
