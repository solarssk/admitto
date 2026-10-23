import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { requestStatusFromSearch, type RequestStatusFilter } from "./registrationRequests.js";

/**
 * The state the list is limited to, kept in the address (`?status=pending`): the Overview links to the requests that wait for a
 * decision, and Back returns to the filter. Choosing a state writes the tab too (a missing `tab` would open the same tab, but the
 * address says it), and choosing every state takes the state out of the address.
 */
export function useRequestStatus(): [RequestStatusFilter, (next: RequestStatusFilter) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = requestStatusFromSearch(searchParams);
  const setStatus = useCallback(
    (next: RequestStatusFilter) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          params.set("tab", "requests");
          if (next === "all") params.delete("status");
          else params.set("status", next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  return [status, setStatus];
}
