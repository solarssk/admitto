import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useOutletContext, useParams } from "react-router";
import { Card, Notice } from "@admitto/ui";
import { EraseWalletResultDialog } from "../attendees/EraseDialogs.js";
import type { EventDto, RegistrationCountsDto, RegistrationListItemDto } from "../api/types.js";
import { PaginationFooter, paginationHandlers } from "../components/PaginationFooter.js";
import { RefetchRegion } from "../components/RefetchRegion.js";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useCardLoad } from "../hooks/useCardLoad.js";
import { useFocusHandover } from "../hooks/useFocusHandover.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import type { ListLoad } from "../hooks/useListLoad.js";
import { assertPresent } from "../utils/assert-present.js";
import { RequestDecisionDialogs } from "./RequestDecisionDialogs.js";
import { RequestDetailDialog } from "./RequestDetailDialog.js";
import { RequestsBulkBar } from "./RequestsBulkBar.js";
import { RequestsEmpty, RequestsRows, RequestsSkeleton, type OpenRequest, type RequestsEmptyKind } from "./RequestsList.js";
import { RequestsQueue } from "./RequestsQueue.js";
import { RequestsToolbar } from "./RequestsToolbar.js";
import { selectionActions } from "./registrationDecisions.js";
import { useRegistrationDecisions, type ActionDone } from "./useRegistrationDecisions.js";
import { REQUEST_PAGE_SIZE_OPTIONS, useRegistrationRequests, type RequestsAnswer } from "./useRegistrationRequests.js";
import { useRequestLookups } from "./useRequestLookups.js";
import { useRequestSelection, type RequestSelection } from "./useRequestSelection.js";
import { useRequestStatus } from "./useRequestStatus.js";
import "./registration-requests.css";

const NO_ROWS: RegistrationListItemDto[] = [];

/** One event, one tab: a different `:eventId` is a fresh tab (its own read and filters), never the previous one's. */
export function RegistrationRequestsTab({ counts }: Readonly<{ counts: ListLoad<RegistrationCountsDto> }>) {
  const { eventId } = useParams();
  if (!eventId) return <p>Missing event.</p>;
  return <RegistrationRequestsBody key={eventId} eventId={eventId} counts={counts} />;
}

/** What an empty page is: nothing sent yet, a queue with nothing waiting (only "waiting for a decision" is on), or a search and filters that select nothing. */
function emptyKind(answer: RequestsAnswer): RequestsEmptyKind {
  if (!answer.filtersActive) return "none";
  const { status, olderThan, q } = answer.query;
  return status === "pending" && olderThan === undefined && q === undefined ? "queue" : "filtered";
}

/** Where the card is, for the hand-over of the focus: it shows rows, or one of the empty lists (which have a button that goes). */
function listStep(answer: RequestsAnswer | null): string {
  if (answer?.items.length !== 0) return "rows";
  return emptyKind(answer);
}

/**
 * Where the keyboard goes when the control that held it leaves the card: the "Clear filters" button of an empty list that came back
 * with rows, and the bulk bar or the confirmation of an action that has changed the page. For the first the next Tab goes on from the
 * card. For the second it goes to the request that took the place of the one that was acted on (the next one, or the one before when
 * the last went), so that a queue is worked through one request after the other and the keyboard never starts from the top again.
 */
function useQueueFocus(rootRef: RefObject<HTMLDivElement | null>, answer: RequestsAnswer | null) {
  const indexRef = useRef<number | null>(null);
  const [changes, setChanges] = useState(0);
  const holdsFocus = useFocusHandover(`${listStep(answer)}:${changes}`, () => {
    const index = indexRef.current;
    indexRef.current = null;
    const panel = rootRef.current?.querySelector<HTMLElement>(".registration-requests__panel");
    if (index === null) return panel;
    // The root is there whenever the handover runs: it runs after a render of this component.
    /* v8 ignore next */
    const opens = rootRef.current?.querySelectorAll<HTMLElement>("[data-request-open]") ?? [];
    return opens[Math.min(index, opens.length - 1)] ?? panel;
  });
  /** An action changed the page: `index` is where the first request it was for stood. */
  const afterAction = useCallback(
    (index: number | null) => {
      indexRef.current = index;
      holdsFocus();
      setChanges((count) => count + 1);
    },
    [holdsFocus],
  );
  return { holdsFocus, afterAction };
}

/**
 * The window of a request that is open, and where the keyboard comes back to when it closes: the button that opened it, when that
 * request is still on the page (when it is not, an action has gone through `afterAction`, which finds the next one).
 */
function useOpenRequest() {
  const [open, setOpen] = useState<RegistrationListItemDto | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open !== null) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, [open]);
  const openRequest: OpenRequest = useCallback((row, opener) => {
    openerRef.current = opener;
    setOpen(row);
  }, []);
  const close = useCallback(() => setOpen(null), []);
  return { open, openRequest, close };
}

/**
 * The requests guests have sent to the event: a table of one page (cards on a narrow screen) with a search, the Filters of the
 * Attendees list (the state, from the address, and the age), the shortcut to the requests that wait for a decision, and its pager. A
 * request opens in a window with its answers and its emails, and the checkboxes give the bulk bar the same actions the window has
 * (accept, reject, send an email again, delete). It follows the loading standard of a card with a list (`useListLoad` and
 * `useCardLoad`): a placeholder in the shape of the table for the first read, an error with a busy Retry that stays on screen until the
 * answer is in, and the rows kept, blocked and dimmed, while the read of another page or filter runs. What an action does to the page
 * never blocks it: the confirmed change is applied to the rows, and the list and the numbers are read again quietly. The numbers of
 * each state come from the page (`counts`) and are read again when the tab opens.
 */
function RegistrationRequestsBody({ eventId, counts }: Readonly<{ eventId: string; counts: ListLoad<RegistrationCountsDto> }>) {
  const { event, refreshEvent } = useOutletContext<{ event: EventDto; refreshEvent?: () => Promise<unknown> }>();
  const { reportApiError } = useConnectionState();
  const { status, known, setStatus } = useRequestStatus(counts);
  const requests = useRegistrationRequests(eventId, status, reportApiError, { enabled: known });
  const { list, answer, page, pageSize, clearFilters } = requests;
  // While the state to ask for is not decided yet nothing is read and the card is idle: it draws its placeholder, held.
  const card = useCardLoad(list, { alsoWaiting: Boolean(answer?.pastTheEnd) && !list.error });
  const selection = useRequestSelection(answer?.items ?? NO_ROWS, requests.queryKey);

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

  const rootRef = useRef<HTMLDivElement>(null);
  const { holdsFocus, afterAction } = useQueueFocus(rootRef, answer);
  const detail = useOpenRequest();
  const closeDetail = detail.close;
  const dropFromSelection = selection.drop;
  const onChanged = useCallback(
    ({ acted, index }: ActionDone) => {
      dropFromSelection(acted);
      closeDetail();
      afterAction(index);
    },
    [afterAction, closeDetail, dropFromSelection],
  );
  const decisions = useRegistrationDecisions({ eventId, list, counts, refreshEvent, reportApiError, onChanged });
  const lookups = useRequestLookups(eventId);

  const totalPages = Math.max(1, Math.ceil((answer?.total ?? 0) / pageSize));
  const actions = selectionActions(selection.rows);
  const openRow = detail.open;

  return (
    <div ref={rootRef} className="registration-requests at-fade-in">
      {counts.data?.mode === null && (
        <Notice variant="info">
          Registration is off for this event, so guests cannot send requests. Requests that were sent earlier are listed here.
        </Notice>
      )}
      <Card padded={false} className="registration-requests__panel" tabIndex={-1}>
        {selection.rows.length > 0 ? (
          <RequestsBulkBar
            count={selection.rows.length}
            actions={actions}
            event={event}
            busy={decisions.busy}
            onClear={selection.clear}
            onAccept={() => decisions.ask("accept", selection.rows)}
            onReject={() => decisions.ask("reject", selection.rows)}
            onRetryMail={() => void decisions.retryMail(actions.retry.map((row) => row.id), selection.rows.map((row) => row.id))}
            onDelete={() => decisions.ask("delete", selection.rows)}
          />
        ) : (
          <RequestsToolbar
            searchInput={requests.searchInput}
            onSearchChange={requests.setSearchInput}
            status={status}
            onStatusChange={setStatus}
            age={requests.age}
            onAgeChange={requests.setAge}
            counts={counts.data}
          />
        )}
        <RequestsQueue
          status={status}
          counts={counts.data}
          onStatusChange={setStatus}
          matching={list.refreshing ? null : decisions.matching}
          onDeleteMatching={decisions.askDeleteMatching}
        />
        <RequestsBody
          card={card}
          refreshing={list.refreshing}
          answer={answer}
          selection={selection}
          onOpen={detail.openRequest}
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
      {openRow ? (
        <RequestDetailDialog
          eventId={eventId}
          event={event}
          row={openRow}
          lookups={lookups}
          suspended={decisions.pending !== null}
          busy={decisions.busy}
          onClose={detail.close}
          onAsk={(kind) => decisions.ask(kind, [openRow])}
          onRetryMail={(id) => void decisions.retryMail([id])}
        />
      ) : null}
      <RequestDecisionDialogs
        pending={decisions.pending}
        matching={decisions.matching}
        busy={decisions.busy}
        error={decisions.error}
        onConfirm={(options) => void decisions.confirm(options)}
        onCancel={decisions.cancel}
      />
      <EraseWalletResultDialog {...decisions.walletDialogProps} />
    </div>
  );
}

/** What the card shows under the toolbar: the placeholder of the first read, the error with its Retry, or the page of requests. */
function RequestsBody({
  card,
  refreshing,
  answer,
  selection,
  onOpen,
  onClearFilters,
  onClearFocus,
}: Readonly<{
  card: ReturnType<typeof useCardLoad>;
  refreshing: boolean;
  answer: RequestsAnswer | null;
  selection: RequestSelection;
  onOpen: OpenRequest;
  onClearFilters: () => void;
  onClearFocus: () => void;
}>) {
  const isDesktop = useIsDesktop(1024);
  if (card.idle || !card.gate.showContent) {
    return <RequestsSkeleton isDesktop={isDesktop} held={card.idle || !card.gate.showIndicator} slow={card.slow} />;
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
          <RequestsEmpty kind={emptyKind(answer)} onClearFilters={onClearFilters} onClearFocus={onClearFocus} />
        ) : (
          <RequestsRows items={answer.items} isDesktop={isDesktop} selection={selection} onOpen={onOpen} />
        )}
      </RefetchRegion>
    </div>
  );
}
