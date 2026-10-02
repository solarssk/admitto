import { useMemo } from "react";
import { fetchAdminEvents } from "../api/client.js";
import { orLoginRedirect } from "../identity/loginRedirect.js";
import { useOptionsLoad } from "./useOptionsLoad.js";

/**
 * The events that a filter or a picker offers (archived ones too, unless `includeArchived` is false). A failure is
 * not an empty list: it says so (`error`) and has a Retry (`retry`, busy for at least 400ms as `retrying`) that
 * reruns this request only. The request has the 30 second limit and is abandoned when the page is left. With
 * `redirectOnUnauthorized`, a 401 (the session ended, which a Retry cannot mend) hands the browser to the login page
 * instead of becoming that error.
 */
export function useEventOptions({
  includeArchived = true,
  enabled = true,
  redirectOnUnauthorized = false,
}: { includeArchived?: boolean; enabled?: boolean; redirectOnUnauthorized?: boolean } = {}) {
  const load = useMemo(() => {
    const fetchEvents = (signal: AbortSignal) => fetchAdminEvents({ includeArchived, signal });
    return redirectOnUnauthorized ? orLoginRedirect(fetchEvents) : fetchEvents;
  }, [includeArchived, redirectOnUnauthorized]);
  const { items, ...rest } = useOptionsLoad(load, "Could not load events.", enabled);
  return { events: items, ...rest };
}
