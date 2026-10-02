import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button, Card, EmptyState, HintLabel, Input, StatusBadge, useToast } from "@admitto/ui";
import { dismissBounce, exportDeliveryLog, resendTicket } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { DeliveryDto, EventDeliveriesListParams, MailTemplateListItem } from "../api/types.js";
import { FiltersMenu } from "../components/FiltersMenu.js";
import { PaginationFooter } from "../components/PaginationFooter.js";
import { RefetchRegion } from "../components/RefetchRegion.js";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { useCardLoad } from "../hooks/useCardLoad.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { deliveryLocalTime, deliveryStatusBadgeKey, formatDateTime, purposeLabel, rowTimestamp, templateLabel } from "./delivery-format.js";
import { DeliveryDetailsModal } from "./DeliveryDetailsModal.js";
import { DeliveryLogSkeleton } from "./DeliveryLogSkeleton.js";
import { DeliveryRowMenu } from "./DeliveryRowMenu.js";
import { SentMessagePreviewModal } from "./SentMessagePreviewModal.js";
import { DELIVERY_PAGE_SIZE_OPTIONS, type DeliveryLog } from "./useDeliveryLog.js";
import "./communication.css";

const NO_ROWS: DeliveryDto[] = [];

const SENT_QUEUED_TIME_HINT =
  "Top: when this happened, in UTC. Below: the same moment in the local time of whoever's browser triggered the send, when known.";

interface DeliveryToolbarProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  status: NonNullable<EventDeliveriesListParams["status"]>;
  onStatusChange: (value: NonNullable<EventDeliveriesListParams["status"]>) => void;
  purpose: NonNullable<EventDeliveriesListParams["purpose"]>;
  onPurposeChange: (value: NonNullable<EventDeliveriesListParams["purpose"]>) => void;
  templateId: string;
  onTemplateIdChange: (value: string) => void;
  templates: MailTemplateListItem[];
}

/** Search box (name/email) + collapsible Filters (Status/Purpose/Template) - same composition as
 * Attendees' FilterToolbar. "Export log" lives in the Card header instead (see DeliveryLogTab),
 * matching Organisation settings' Logs pattern. */
function DeliveryToolbar({
  searchInput,
  onSearchChange,
  status,
  onStatusChange,
  purpose,
  onPurposeChange,
  templateId,
  onTemplateIdChange,
  templates,
}: Readonly<DeliveryToolbarProps>) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeFilterCount =
    (status !== "all" ? 1 : 0) + (purpose !== "all" ? 1 : 0) + (templateId !== "all" ? 1 : 0);

  return (
    <div className="communication-toolbar">
      <div className="communication-toolbar__search">
        <Input
          ref={searchInputRef}
          id="communication-log-search"
          name="communication-log-search"
          aria-label="Search recipient by name or email"
          placeholder="Name or email"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          icon={<i className="ti ti-search" aria-hidden="true" />}
        />
        {searchInput.length > 0 && (
          <button
            type="button"
            className="communication-toolbar__search-clear"
            onClick={() => {
              onSearchChange("");
              searchInputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        )}
      </div>
      <FiltersMenu activeCount={activeFilterCount} className="communication-filters-menu">
        <div className="communication-toolbar__filter">
          <SearchableSelect
            id="communication-log-status-filter"
            label="Status"
            placeholder="All statuses"
            searchPlaceholder="Search statuses…"
            emptyLabel="No statuses found"
            value={status}
            options={[
              { id: "all", label: "All statuses" },
              { id: "queued", label: "Queued" },
              { id: "accepted", label: "Accepted" },
              { id: "sent", label: "Sent" },
              { id: "delivered", label: "Delivered" },
              { id: "failed", label: "Failed" },
              { id: "bounced", label: "Bounced" },
              { id: "rejected", label: "Rejected" },
              { id: "cancelled", label: "Cancelled" },
            ]}
            onChange={(id) => onStatusChange(id as NonNullable<EventDeliveriesListParams["status"]>)}
          />
        </div>
        <div className="communication-toolbar__filter">
          <SearchableSelect
            id="communication-log-purpose-filter"
            label="Purpose"
            placeholder="All purposes"
            searchPlaceholder="Search purposes…"
            emptyLabel="No purposes found"
            value={purpose}
            options={[
              { id: "all", label: "All purposes" },
              { id: "initial", label: "Initial send" },
              { id: "resend", label: "Resend" },
            ]}
            onChange={(id) => onPurposeChange(id as NonNullable<EventDeliveriesListParams["purpose"]>)}
          />
        </div>
        <div className="communication-toolbar__filter">
          <SearchableSelect
            id="communication-log-template-filter"
            label="Template"
            placeholder="All templates"
            searchPlaceholder="Search templates…"
            emptyLabel="No templates found"
            value={templateId}
            options={[
              { id: "all", label: "All templates" },
              { id: "default", label: "Default ticket template" },
              ...templates.map((t) => ({ id: t.id, label: t.label })),
            ]}
            onChange={onTemplateIdChange}
          />
        </div>
      </FiltersMenu>
    </div>
  );
}

interface DeliveryListContentProps {
  eventId: string;
  deliveries: DeliveryDto[];
  /** Whether the answer on screen was asked with a filter or a search: it says which empty state is true. */
  filtersActive: boolean;
  isDesktop: boolean;
  onViewSentMessage: (row: DeliveryDto) => void;
  onViewDetails: (row: DeliveryDto) => void;
  onResend: (row: DeliveryDto) => void;
  onDismiss: (row: DeliveryDto) => void;
  /** Delivery ids whose Resend/Dismiss has already been used - see DeliveryRowMenu's own
   * bounceResolved prop for why this can't just be derived from row.status. */
  resolvedBounceRowIds: Set<string>;
  /** Delivery ids with an in-flight Resend/Dismiss - greys out both actions until the request
   * settles (then either resolvedBounceRowIds takes over, or this clears on failure). */
  pendingBounceRowIds: Set<string>;
}

/** Empty states + the responsive desktop-table / mobile-card split - same shape as
 * AttendeesTable's AttendeesListContent and Reports' AdmissionLog. Its loading and failed states are the tab's own
 * (`DeliveryLogTab`), since they replace the list. */
function DeliveryListContent({
  eventId,
  deliveries,
  filtersActive,
  isDesktop,
  onViewSentMessage,
  onViewDetails,
  onResend,
  onDismiss,
  resolvedBounceRowIds,
  pendingBounceRowIds,
}: Readonly<DeliveryListContentProps>) {
  if (deliveries.length === 0) {
    return filtersActive ? (
      <EmptyState
        icon={<i className="ti ti-search-off" aria-hidden="true" />}
        title="No matches"
        description="Try a different search, or clear your filters."
      />
    ) : (
      <EmptyState
        icon={<i className="ti ti-mail-off" aria-hidden="true" />}
        title="No messages sent yet"
        description="Ticket emails and resends will appear here once one is sent."
      />
    );
  }

  if (!isDesktop) {
    return (
      <div className="communication-cards">
        {deliveries.map((row) => (
          <div className="communication-card" key={row.id}>
            <div className="communication-card__top">
              <Link
                className="communication-card__name"
                to={`/admin/events/${eventId}/attendees/${row.attendee_id}`}
              >
                {row.attendee_name}
              </Link>
              <DeliveryRowMenu
                row={row}
                onViewSentMessage={onViewSentMessage}
                onViewDetails={onViewDetails}
                onResend={onResend}
                onDismiss={onDismiss}
                bounceResolved={resolvedBounceRowIds.has(row.id)}
                bouncePending={pendingBounceRowIds.has(row.id)}
              />
            </div>
            <div className="communication-card__meta">
              <span className="communication-card__meta-item">
                <i className="ti ti-mail" aria-hidden="true" />
                {row.recipient_email ?? "-"}
              </span>
              <span className="communication-card__meta-item">
                <i className="ti ti-clock" aria-hidden="true" />
                <span>
                  {formatDateTime(rowTimestamp(row))}
                  {deliveryLocalTime(row, rowTimestamp(row)) && (
                    <div className="sessions-subdued">{deliveryLocalTime(row, rowTimestamp(row))}</div>
                  )}
                </span>
              </span>
              <span className="communication-card__meta-item">
                <i className="ti ti-file-text" aria-hidden="true" />
                {templateLabel(row)}
              </span>
              <span className="communication-card__meta-item">{purposeLabel(row.purpose)}</span>
              <StatusBadge status={deliveryStatusBadgeKey(row.status)} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="communication-table-wrap">
      <table className="table communication-table">
        <thead>
          <tr>
            <th>Recipient</th>
            <th>Template</th>
            <th>Purpose</th>
            <th>Status</th>
            <th>
              <HintLabel hint={SENT_QUEUED_TIME_HINT}>Sent / Queued</HintLabel>
            </th>
            <th className="communication-row-menu-cell" aria-label="Actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((row) => (
            <tr key={row.id}>
              <td>
                <Link
                  className="communication-user"
                  to={`/admin/events/${eventId}/attendees/${row.attendee_id}`}
                >
                  <strong>{row.attendee_name}</strong>
                  <span className="mono muted">{row.recipient_email ?? "-"}</span>
                </Link>
              </td>
              <td title={templateLabel(row)}>
                <span className="communication-template-cell">{templateLabel(row)}</span>
              </td>
              <td>{purposeLabel(row.purpose)}</td>
              <td>
                <StatusBadge status={deliveryStatusBadgeKey(row.status)} />
              </td>
              <td className="mono muted">
                {formatDateTime(rowTimestamp(row))}
                {deliveryLocalTime(row, rowTimestamp(row)) && (
                  <div className="sessions-subdued">{deliveryLocalTime(row, rowTimestamp(row))}</div>
                )}
              </td>
              <td className="communication-row-menu-cell">
                <DeliveryRowMenu
                row={row}
                onViewSentMessage={onViewSentMessage}
                onViewDetails={onViewDetails}
                onResend={onResend}
                onDismiss={onDismiss}
                bounceResolved={resolvedBounceRowIds.has(row.id)}
                bouncePending={pendingBounceRowIds.has(row.id)}
              />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface DeliveryLogTabProps {
  eventId: string;
  eventTimezone: string;
  /** The query, the list that follows the loading standard and what keeps it live (`useDeliveryLog`). */
  log: DeliveryLog;
  templates: MailTemplateListItem[];
  /** Kept by CommunicationPage so a completed bounce action remains disabled after the log tab
   * unmounts while the operator visits another tab. */
  resolvedBounceRowIds: Set<string>;
  onBounceRowResolved: (rowId: string) => void;
  /** Same lift as `resolvedBounceRowIds`, for in-flight Resend/Dismiss so a tab switch mid-request
   * cannot re-enable the actions before the response lands. */
  pendingBounceRowIds: Set<string>;
  onBounceRowPendingChange: (rowId: string, pending: boolean) => void;
  /** Fired after a row's Resend/Dismiss action succeeds - refreshes the Communication header's
   * bounce count. The deliveries list itself doesn't need an explicit refetch here; it already
   * polls on its own (Live toggle above). */
  onBounceHandled?: () => void;
}

const DELIVERY_LOG_HINT =
  "Every ticket email and resend attempt for this event, with delivery status and diagnostics.";

/** Delivery log tab: search + filters toolbar, the deliveries table/cards (with its own
 * loading/error/empty states), pagination footer, and the two row-menu-triggered modals. Owns
 * which (if any) delivery's modal is open itself, same as EventCustomFieldsCard owning its own
 * edit-modal state - the page only needs to hand it the log (query, list, live) plus the bounce bookkeeping.
 *
 * The first read is a placeholder of the table's own shape (held for 200ms, "Taking longer than usual" after 8 seconds, 30
 * seconds at most), a failure is an error with a busy Retry, and a later page, filter or search keeps the rows on screen in a
 * `RefetchRegion` (the live refresh does not even dim them). */
export function DeliveryLogTab({
  eventId,
  eventTimezone,
  log,
  templates,
  resolvedBounceRowIds,
  onBounceRowResolved,
  pendingBounceRowIds,
  onBounceRowPendingChange,
  onBounceHandled,
}: Readonly<DeliveryLogTabProps>) {
  const {
    list,
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
    search,
    live,
    setLive,
    hasActiveFilters,
    clearFilters,
  } = log;
  const isDesktop = useIsDesktop();
  const [sentMessageRow, setSentMessageRow] = useState<DeliveryDto | null>(null);
  const [detailsRow, setDetailsRow] = useState<DeliveryDto | null>(null);
  const [exporting, setExporting] = useState(false);
  const { addToast } = useToast();
  const answer = list.data;
  // An answer with no rows although there are some (its page is gone) is waited out like a first load while the page steps back.
  const card = useCardLoad(list, { alsoWaiting: Boolean(answer?.pastTheEnd) && !list.error });
  const total = answer?.total ?? 0;
  const rows = answer?.items ?? NO_ROWS;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  async function handleExport() {
    setExporting(true);
    try {
      await exportDeliveryLog(eventId, { status, purpose, search: search.trim() || undefined, templateId });
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to export the delivery log."), "error");
    } finally {
      setExporting(false);
    }
  }

  function markBounceRowResolved(rowId: string) {
    onBounceRowResolved(rowId);
  }

  async function handleResend(row: DeliveryDto) {
    onBounceRowPendingChange(row.id, true);
    try {
      await resendTicket(eventId, row.attendee_id, { templateId: row.template_id ?? undefined });
      addToast(`Resent to ${row.attendee_name}.`, "success");
      markBounceRowResolved(row.id);
      onBounceHandled?.();
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Resend failed."), "error");
    } finally {
      onBounceRowPendingChange(row.id, false);
    }
  }

  async function handleDismiss(row: DeliveryDto) {
    onBounceRowPendingChange(row.id, true);
    try {
      await dismissBounce(eventId, row.attendee_id);
      addToast(`Dismissed the bounce notice for ${row.attendee_name}.`, "success");
      markBounceRowResolved(row.id);
      onBounceHandled?.();
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to dismiss the bounce notice."), "error");
    } finally {
      onBounceRowPendingChange(row.id, false);
    }
  }

  let body: ReactNode;
  if (!card.gate.showContent) {
    body = <DeliveryLogSkeleton held={!card.gate.showIndicator} slow={card.slow} desktop={isDesktop} />;
  } else if (card.failure.error) {
    body = (
      <RetryEmptyState
        title="Could not load deliveries"
        message={card.failure.error}
        retrying={card.failure.retrying}
        onRetry={card.failure.retry}
      />
    );
  } else {
    body = (
      <RefetchRegion refreshing={list.refreshing} label="Refreshing the delivery log">
        <DeliveryListContent
          eventId={eventId}
          deliveries={rows}
          filtersActive={Boolean(answer?.filtersActive)}
          isDesktop={isDesktop}
          onViewSentMessage={setSentMessageRow}
          onViewDetails={setDetailsRow}
          onResend={(row) => void handleResend(row)}
          onDismiss={(row) => void handleDismiss(row)}
          resolvedBounceRowIds={resolvedBounceRowIds}
          pendingBounceRowIds={pendingBounceRowIds}
        />
      </RefetchRegion>
    );
  }

  return (
    <Card
      padded={false}
      className="communication-delivery-header"
      title={<HintLabel hint={DELIVERY_LOG_HINT}>Delivery log</HintLabel>}
      actions={
        <>
          <Button type="button" variant="secondary" size="sm" aria-disabled={!hasActiveFilters} onClick={clearFilters}>
            Clear filters
          </Button>
          <Button type="button" variant="secondary" size="sm" loading={exporting} loadingLabel="Exporting…" onClick={() => void handleExport()}>
            Export log
          </Button>
          <Button
            type="button"
            variant={live ? "success" : "secondary"}
            size="sm"
            onClick={() => setLive(!live)}
          >
            {live ? "Live" : "Paused"}
          </Button>
        </>
      }
    >
      <DeliveryToolbar
        searchInput={searchInput}
        // The page goes back to the first when the search the server is asked for changes (`useDeliveryLog`), not on every
        // key: typing a character and deleting it again leaves the operator where they were.
        onSearchChange={setSearchInput}
        status={status}
        onStatusChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
        purpose={purpose}
        onPurposeChange={(value) => {
          setPurpose(value);
          setPage(1);
        }}
        templateId={templateId}
        onTemplateIdChange={(value) => {
          setTemplateId(value);
          setPage(1);
        }}
        templates={templates}
      />
      {body}
      {/* Outside the ladder above: a page that fails to load replaces the rows with the error, and the pager that was pressed
          keeps its focus, with Previous as a way back. It is busy (and keeps the focus, aria-disabled) while a page is on its way. */}
      {total > 0 && (
        <div className="communication-log-footer">
          <PaginationFooter
            idPrefix="communication-log"
            busy={list.refreshing || list.loading}
            page={safePage}
            pageSize={pageSize}
            totalPages={totalPages}
            totalRows={total}
            pageSizeOptions={DELIVERY_PAGE_SIZE_OPTIONS}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            onPrevious={() => setPage(Math.max(1, safePage - 1))}
            onNext={() => setPage(safePage + 1)}
          />
        </div>
      )}
      {sentMessageRow && (
        <SentMessagePreviewModal
          eventId={eventId}
          row={sentMessageRow}
          onClose={() => setSentMessageRow(null)}
        />
      )}
      {detailsRow && (
        <DeliveryDetailsModal
          eventId={eventId}
          eventTimezone={eventTimezone}
          row={detailsRow}
          onClose={() => setDetailsRow(null)}
          onViewSentMessage={(row) => {
            setDetailsRow(null);
            setSentMessageRow(row);
          }}
        />
      )}
    </Card>
  );
}
