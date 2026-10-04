import { useCallback } from "react";
import { fetchTicketTypes } from "../api/client.js";
import { useOptionsLoad } from "./useOptionsLoad.js";

/**
 * The ticket types of an event that a recipient picker offers, read while `enabled`. A failure is not an empty list: it
 * says so (`error`) and has a Retry (`retry`, busy for at least 400ms as `retrying`) that reruns this request only, and
 * the request has the 30 second limit (see `useOptionsLoad`). The field's place is a `LookupSlot`.
 */
export function useTicketTypeOptions(eventId: string, enabled = true) {
  const load = useCallback((signal: AbortSignal) => fetchTicketTypes(eventId, signal), [eventId]);
  const { items, ...rest } = useOptionsLoad(load, "Could not load ticket types.", enabled);
  return { ticketTypes: items, ...rest };
}
