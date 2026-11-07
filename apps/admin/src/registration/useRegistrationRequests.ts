import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RegistrationStatus } from "@admitto/db/status";
import { ApiError, fetchRegistrations } from "../api/client.js";
import type { RegistrationListItemDto } from "../api/types.js";
import { useListLoad } from "../hooks/useListLoad.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import { isPastTheEnd } from "../pages/users/list-changes.js";
import { requestSearchText, type RequestAgeFilter, type RequestStatusFilter } from "./registrationRequests.js";

export const REQUEST_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const REQUEST_PAGE_SIZE_DEFAULT = 25;

/** The search box waits this long after the last key before it asks the server. */
const SEARCH_DEBOUNCE_MS = 300;

/** The filter of a list as the server was asked for it: a part that is left out selects every request. What deleting by filter sends back. */
export interface RequestQuery {
  status?: RegistrationStatus;
  olderThan?: string;
  q?: string;
}

/** What one read of the request list answers. */
export interface RequestsAnswer {
  items: RegistrationListItemDto[];
  total: number;
  /** The page it answers: a stale answer (the page has changed since) says nothing about the page the viewer is on. */
  page: number;
  /** What this answer was asked with: the empty states describe it, never a search that is still on its way. */
  filtersActive: boolean;
  /** The page it was on is gone (no rows although there are some): not "No matches", the page steps back. */
  pastTheEnd: boolean;
  /** The filter this answer was asked with, which `total` and `selectionDigest` are about. */
  query: RequestQuery;
  /**
   * The name the server gave the requests the filter selects over all pages: deleting by filter sends it back with `total` as proof of
   * what the staff member was shown. Null without a filter, for a filter that selects more than one deletion takes, and once the page was
   * changed by an action (the next answer brings the new one).
   */
  selectionDigest: string | null;
}

/**
 * The requests of an event: its query (the state, the age, the debounced search, the page and its size), and the list that follows
 * the loading standard (`useListLoad`: the first read, a changed query or page kept on screen while it is on its way, 30 seconds at
 * most, Retry; a 401 on a read somebody waits for hands the browser to the login page, a tick of `poll` after an action never does).
 * The page the viewer is on can be gone when the next answer arrives (a smaller total): it steps back to the last one that exists.
 * `enabled` is false while the state to ask for is not known yet (the address says nothing and the numbers that decide it are still
 * on their way): nothing is read, so that the list is read once, for the state it will show.
 */
export function useRegistrationRequests(
  eventId: string,
  status: RequestStatusFilter,
  reportApiError: (status: number) => void,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(REQUEST_PAGE_SIZE_DEFAULT);
  const [ageFilter, setAgeFilter] = useState<RequestAgeFilter>("any");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Another state (the address changed, or the filter did) starts on the first page, in the render that sees it, so the
  // page that was open is never asked for under the new state.
  const [askedStatus, setAskedStatus] = useState(status);
  if (askedStatus !== status) {
    setAskedStatus(status);
    setPage(1);
  }

  // The debounce timer compares with the search the rows were asked with without making it a dependency, which would
  // restart the timer on every unrelated render.
  const committedSearchRef = useRef(search);
  useEffect(() => {
    committedSearchRef.current = search;
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = requestSearchText(searchInput);
      // A tick that changes nothing (the box is still empty after mount, or the text came back to what was asked) must not
      // send the viewer back to the first page.
      if (next === committedSearchRef.current) return;
      setSearch(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // The connection state hears of every failed read when the answer is in (a 5xx says the server is unavailable, a 401 that the
  // session ended); a 401 then hands the browser to the login page, so no error or Retry flashes up first. A tick of `poll` (the
  // read that follows an action, with nobody waiting for it) tells and hands over nothing: a missed one is not an error over rows that
  // are on screen, and the next read somebody waits for does.
  const fetchPage = useMemo(
    () =>
      async (signal: AbortSignal, context?: { poll: boolean }): Promise<RequestsAnswer> => {
        const query: RequestQuery = {
          ...(status === "all" ? {} : { status }),
          ...(ageFilter === "any" ? {} : { olderThan: ageFilter }),
          ...(search === "" ? {} : { q: search }),
        };
        try {
          const data = await fetchRegistrations(eventId, { page, pageSize, ...query }, signal);
          return {
            items: data.items,
            total: data.total,
            page,
            filtersActive: status !== "all" || ageFilter !== "any" || search !== "",
            pastTheEnd: isPastTheEnd(data.items.length, data.total, page),
            query,
            selectionDigest: data.selection_digest,
          };
        } catch (err) {
          if (context?.poll) throw err;
          if (err instanceof ApiError) reportApiError(err.status);
          if (err instanceof ApiError && err.status === 401) {
            redirectToLogin();
            return new Promise<never>(() => {});
          }
          throw err;
        }
      },
    [eventId, page, pageSize, status, ageFilter, search, reportApiError],
  );
  const list = useListLoad({ fetcher: fetchPage, fallback: "Could not load the requests.", enabled });

  // The page the viewer is on can be gone when the next answer arrives (a smaller total): step back to the last one that
  // exists. An answer with no rows for a page the total says exists steps back one page, so the card never waits for ever.
  const answer = list.data;
  useEffect(() => {
    if (!answer) return;
    const lastPage = Math.max(1, Math.ceil(answer.total / pageSize));
    if (page > lastPage) setPage(lastPage);
    else if (answer.pastTheEnd && answer.page === page) setPage(page - 1);
  }, [answer, page, pageSize]);

  const setAge = useCallback((next: RequestAgeFilter) => {
    setAgeFilter(next);
    setPage(1);
  }, []);
  const clearFilters = useCallback(() => {
    setAgeFilter("any");
    setSearchInput("");
    setSearch("");
    setPage(1);
  }, []);

  return {
    list,
    answer,
    /** Names the page the viewer is on and the query it is a page of: what a selection belongs to. */
    queryKey: `${page}|${pageSize}|${status}|${ageFilter}|${search}`,
    page,
    setPage,
    pageSize,
    setPageSize,
    age: ageFilter,
    setAge,
    searchInput,
    setSearchInput,
    /** Clears the age and the search; the state is the address's, and the tab clears it there. */
    clearFilters,
  };
}
