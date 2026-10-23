import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { Card, Notice } from "@admitto/ui";
import type { RegistrationCountsDto } from "../api/types.js";
import { PaginationFooter, paginationHandlers } from "../components/PaginationFooter.js";
import { RefetchRegion } from "../components/RefetchRegion.js";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useCardLoad } from "../hooks/useCardLoad.js";
import { useFocusHandover } from "../hooks/useFocusHandover.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import type { ListLoad } from "../hooks/useListLoad.js";
import { assertPresent } from "../utils/assert-present.js";
import { RequestsEmpty, RequestsRows, RequestsSkeleton } from "./RequestsList.js";
import { RequestsToolbar } from "./RequestsToolbar.js";
import { useRequestStatus } from "./useRequestStatus.js";
import { REQUEST_PAGE_SIZE_OPTIONS, useRegistrationRequests, type RequestsAnswer } from "./useRegistrationRequests.js";
import "./registration-requests.css";

/** One event, one tab: a different `:eventId` is a fresh tab (its own read and filters), never the previous one's. */
export function RegistrationRequestsTab({ counts }: Readonly<{ counts: ListLoad<RegistrationCountsDto> }>) {
  const { eventId } = useParams();
  if (!eventId) return <p>Missing event.</p>;
  return <RegistrationRequestsBody key={eventId} eventId={eventId} counts={counts} />;
}

/**
 * The requests guests have sent to the event: a table of one page (cards on a narrow screen) with a search, the Filters of the
 * Attendees list (the state, from the address, and the age) and its pager. It follows the loading standard of a card with a
 * list (`useListLoad` and `useCardLoad`): a placeholder in the shape of the table for the first read, an error with a busy Retry
 * that stays on screen until the answer is in, and the rows kept, blocked and dimmed, while the read of another page or filter
 * runs. The numbers of each state come from the page (`counts`) and are read again when the tab opens.
 */
function RegistrationRequestsBody({ eventId, counts }: Readonly<{ eventId: string; counts: ListLoad<RegistrationCountsDto> }>) {
  const { reportApiError } = useConnectionState();
  const [status, setStatus] = useRequestStatus();
  const requests = useRegistrationRequests(eventId, status, reportApiError);
  const { list, answer, page, pageSize, clearFilters } = requests;
  const card = useCardLoad(list, { alsoWaiting: Boolean(answer?.pastTheEnd) && !list.error });

  // The numbers the page read when it opened can be old by the time this tab is, so opening it reads them again, silently. Not
  // when the page's own first read is still on its way (the page opened on this tab): that one is the read.
  const pollCounts = counts.poll;
  const [countsSettled] = useState(!counts.loading);
  useEffect(() => {
    if (countsSettled) void pollCounts();
  }, [countsSettled, pollCounts]);

  const clearAll = useCallback(() => {
    clearFilters();
    setStatus("all");
  }, [clearFilters, setStatus]);

  // The "Clear filters" button of an empty list goes when the list it cleared comes back, and a browser drops the focus it held on the
  // page. Whichever way the card goes on (the rows, or "No requests yet"), the focus goes to the card, so the next Tab goes on from there.
  const rootRef = useRef<HTMLDivElement>(null);
  const holdsFocus = useFocusHandover(listStep(answer), () => rootRef.current?.querySelector<HTMLElement>(".registration-requests__panel"));

  const totalPages = Math.max(1, Math.ceil((answer?.total ?? 0) / pageSize));

  return (
    <div ref={rootRef} className="registration-requests at-fade-in">
      {counts.data?.mode === null && (
        <Notice variant="info">
          Registration is off for this event, so guests cannot send requests. Requests that were sent earlier are listed here.
        </Notice>
      )}
      <Card padded={false} className="registration-requests__panel" tabIndex={-1}>
        <RequestsToolbar
          searchInput={requests.searchInput}
          onSearchChange={requests.setSearchInput}
          status={status}
          onStatusChange={setStatus}
          age={requests.age}
          onAgeChange={requests.setAge}
          counts={counts.data}
        />
        <RequestsBody
          card={card}
          refreshing={list.refreshing}
          answer={answer}
          onClearFilters={clearAll}
          onClearFocus={holdsFocus}
        />
        {answer && answer.total > 0 && card.gate.showContent ? (
          <div className="registration-requests__footer">
            <PaginationFooter
              idPrefix="registration-requests"
              page={page}
              pageSize={pageSize}
              totalPages={totalPages}
              totalRows={answer.total}
              pageSizeOptions={REQUEST_PAGE_SIZE_OPTIONS}
              busy={list.refreshing}
              {...paginationHandlers(requests.setPage, requests.setPageSize, totalPages)}
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/** Where the card is, for the hand-over of the focus: it shows rows, or one of the two empty lists (which have a button that goes). */
function listStep(answer: RequestsAnswer | null): string {
  if (answer?.items.length !== 0) return "rows";
  return answer.filtersActive ? "no matches" : "no requests";
}

/** What the card shows under the toolbar: the placeholder of the first read, the error with its Retry, or the page of requests. */
function RequestsBody({
  card,
  refreshing,
  answer,
  onClearFilters,
  onClearFocus,
}: Readonly<{
  card: ReturnType<typeof useCardLoad>;
  refreshing: boolean;
  answer: RequestsAnswer | null;
  onClearFilters: () => void;
  onClearFocus: () => void;
}>) {
  const isDesktop = useIsDesktop(1024);
  if (!card.gate.showContent) {
    return <RequestsSkeleton isDesktop={isDesktop} held={!card.gate.showIndicator} slow={card.slow} />;
  }
  if (card.failure.error) {
    return (
      <RetryEmptyState
        className="at-fade-in"
        title="Could not load the requests"
        message={card.failure.error}
        retrying={card.failure.retrying}
        onRetry={card.failure.retry}
        landmark=".registration-requests__panel"
      />
    );
  }
  assertPresent(answer);
  return (
    <div className="at-fade-in">
      <RefetchRegion refreshing={refreshing} label="Refreshing requests">
        {answer.items.length === 0 ? (
          <RequestsEmpty filtered={answer.filtersActive} onClearFilters={onClearFilters} onClearFocus={onClearFocus} />
        ) : (
          <RequestsRows items={answer.items} isDesktop={isDesktop} />
        )}
      </RefetchRegion>
    </div>
  );
}
