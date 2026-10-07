import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchEventDeliveries } from "../api/client.js";
import type { DeliveryDto, EventDeliveriesListParams } from "../api/types.js";
import { useListLoad } from "../hooks/useListLoad.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import { isPastTheEnd } from "../pages/users/list-changes.js";

export const DELIVERY_PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
export const DELIVERY_PAGE_SIZE_DEFAULT = 25;
/** Matches SystemLogsPanel's own POLL_INTERVAL_MS by convention (not by import - a shared
 * numeric constant would couple this feature's polling cadence to an unrelated settings page's
 * own tuning). */
export const DELIVERY_POLL_INTERVAL_MS = 1750;

/** The search box waits this long after the last key before it asks the server. */
const SEARCH_DEBOUNCE_MS = 300;

export type DeliveryStatusFilter = NonNullable<EventDeliveriesListParams["status"]>;
export type DeliveryPurposeFilter = NonNullable<EventDeliveriesListParams["purpose"]>;

/** What one read of the delivery log answers. */
export interface DeliveryLogAnswer {
  items: DeliveryDto[];
  total: number;
  /** The page it answers: a stale answer (the page has changed since) says nothing about the page the operator is on. */
  page: number;
  /** What this answer was asked with: the empty states describe it, never a search that is still on its way. */
  filtersActive: boolean;
  /** The page it was on is gone (no rows although there are some): not "No matches", the page steps back. */
  pastTheEnd: boolean;
}

/**
 * The delivery log of an event: its query (page, page size, filters, the debounced search), the list that follows the
 * loading standard (`useListLoad`: the first read, a changed query or page kept on screen while it is on its way, 30 seconds
 * at most, Retry), and what keeps it live. Live reads the same query again every `DELIVERY_POLL_INTERVAL_MS` without a sign of
 * it (`poll`), whichever tab of the page is open, so the number on the tab and the table, once opened, stay current. A
 * failed tick says nothing over the rows on screen, a 401 on a read somebody waits for hands the browser to the login page,
 * switching Live off abandons the tick that is on its way, and the page it was on disappearing (a smaller total) steps the
 * page back.
 */
export function useDeliveryLog(eventId: string, reportApiError: (status: number) => void) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DELIVERY_PAGE_SIZE_DEFAULT);
  const [status, setStatus] = useState<DeliveryStatusFilter>("all");
  const [purpose, setPurpose] = useState<DeliveryPurposeFilter>("all");
  const [templateId, setTemplateId] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);

  // The debounce timer compares with the search the rows were asked with without making it a dependency, which would
  // restart the timer on every unrelated render.
  const committedSearchRef = useRef(search);
  useEffect(() => {
    committedSearchRef.current = search;
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = searchInput.trim();
      // A tick that changes nothing (the box is still empty after mount, or the text came back to what was asked) must not
      // send the operator back to the first page.
      if (trimmed === committedSearchRef.current) return;
      setSearch(trimmed);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchPage = useCallback(
    async (signal: AbortSignal, context?: { poll: boolean }): Promise<DeliveryLogAnswer> => {
      try {
        const data = await fetchEventDeliveries(
          eventId,
          { page, pageSize, status, purpose, search: search || undefined, templateId },
          signal,
        );
        return {
          items: data.items,
          total: data.total,
          page,
          filtersActive: search !== "" || status !== "all" || purpose !== "all" || templateId !== "all",
          pastTheEnd: isPastTheEnd(data.items.length, data.total, page),
        };
      } catch (err) {
        // A missed tick says nothing (the connection heartbeat sees a session that ended); a read somebody waits for does.
        if (!context?.poll && err instanceof ApiError && err.status === 401) {
          // The session ended: tell the connection state and hand the browser to the login page. The answer never
          // comes (the page is on its way out), so no error or Retry flashes up first.
          reportApiError(401);
          redirectToLogin();
          return new Promise<never>(() => {});
        }
        throw err;
      }
    },
    [eventId, page, pageSize, status, purpose, search, templateId, reportApiError],
  );
  // A failed read that somebody waits for is reported to the connection state (a 5xx says the server is unavailable); a
  // missed tick of the live refresh is not, it is normal noise.
  const onError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) reportApiError(err.status);
    },
    [reportApiError],
  );
  const list = useListLoad({ fetcher: fetchPage, fallback: "Could not load deliveries.", onError });

  const { poll } = list;
  useEffect(() => {
    if (!live) return;
    // Each stretch of Live has a life of its own: switching it off abandons the tick that is on its way, so a log that says
    // Paused is not changed by an answer that was already under way.
    const stretch = new AbortController();
    const intervalId = window.setInterval(() => void poll(stretch.signal), DELIVERY_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
      stretch.abort();
    };
  }, [live, poll]);

  // The page the operator is on can be gone when the next answer arrives (a smaller total): step back to the last one that
  // exists, or to the first when there are no rows at all. An answer with no rows for a page the total says exists (its rows
  // were deleted between the server's count and its read) steps back one page, so the card never waits for ever.
  const answer = list.data;
  useEffect(() => {
    if (!answer) return;
    const lastPage = Math.max(1, Math.ceil(answer.total / pageSize));
    if (page > lastPage) setPage(lastPage);
    else if (answer.pastTheEnd && answer.page === page) setPage(page - 1);
  }, [answer, page, pageSize]);

  const hasActiveFilters = status !== "all" || purpose !== "all" || templateId !== "all" || searchInput.trim() !== "";

  return {
    list,
    /**
     * The number on the Delivery log tab: only an answer that is on screen counts. The one a failure left behind is not, and
     * stays out while the Retry of that failure, or the read after it, is on its way (`loading`: the card is a first load
     * again, and a Retry keeps the error on screen), until the answer that follows is in.
     */
    total: answer && !list.error && !list.loading ? answer.total : 0,
    page,
    setPage,
    pageSize,
    setPageSize,
    status,
    setStatus,
    purpose,
    setPurpose,
    templateId,
    setTemplateId,
    searchInput,
    setSearchInput,
    /** The debounced search: what the rows on screen were actually asked with (Export uses it, not the live box). */
    search,
    live,
    setLive,
    hasActiveFilters,
    clearFilters: () => {
      setStatus("all");
      setPurpose("all");
      setTemplateId("all");
      setSearchInput("");
      setSearch("");
      setPage(1);
    },
    /** The bounce banner's "view" action: the bounced deliveries, from the first page. */
    showBounced: () => {
      setStatus("bounced");
      setPage(1);
    },
  };
}

export type DeliveryLog = ReturnType<typeof useDeliveryLog>;
