import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { RegistrationCountsDto } from "../api/types.js";
import type { ListLoad } from "../hooks/useListLoad.js";
import { defaultRequestStatus, requestStatusFromSearch, type RequestStatusFilter } from "./registrationRequests.js";

/**
 * The state the list is limited to, kept in the address (`?status=pending`, `?status=all` for every state): the Overview links to
 * the requests that wait for a decision, and Back returns to the filter. Choosing a state writes the tab too (a missing `tab` would
 * open the same tab, but the address says it).
 *
 * An address that says nothing opens on what the event's numbers say (`defaultRequestStatus`: the requests that wait for a decision
 * when staff decide by hand and some do). That is decided once, when the numbers are known, and kept: a decision that empties the queue
 * must not switch the view under the staff member. `known` is false until it is decided, so the list is read once, for the state it will
 * show, and not for every state first. Choosing every state writes `status=all`, since not writing it would open on the queue again.
 */
export function useRequestStatus(counts: ListLoad<RegistrationCountsDto>): {
  status: RequestStatusFilter;
  known: boolean;
  setStatus: (next: RequestStatusFilter) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const asked = requestStatusFromSearch(searchParams);
  const [opening, setOpening] = useState<RequestStatusFilter | null>(() => (counts.loading ? null : defaultRequestStatus(counts.data)));
  useEffect(() => {
    if (opening === null && !counts.loading) setOpening(defaultRequestStatus(counts.data));
  }, [opening, counts.loading, counts.data]);

  const setStatus = useCallback(
    (next: RequestStatusFilter) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          params.set("tab", "requests");
          params.set("status", next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const status = asked ?? opening;
  return { status: status ?? "all", known: status !== null, setStatus };
}
