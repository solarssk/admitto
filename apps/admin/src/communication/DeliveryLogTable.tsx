import { useRef, useState } from "react";
import { Link } from "react-router";
import { Button, Card, EmptyState, HintLabel, Input, StatusBadge, useToast } from "@admitto/ui";
import { dismissBounce, exportDeliveryLog, resendTicket } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { DeliveryDto, EventDeliveriesListParams, MailTemplateListItem } from "../api/types.js";
import { FiltersMenu } from "../components/FiltersMenu.js";
import { PaginationFooter } from "../components/PaginationFooter.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { useDelayedLoading, whenShown } from "../hooks/useDelayedLoading.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { deliveryLocalTime, formatDateTime, purposeLabel, rowTimestamp, templateLabel } from "./delivery-format.js";
import { DeliveryDetailsModal } from "./DeliveryDetailsModal.js";
import { DeliveryRowMenu } from "./DeliveryRowMenu.js";
import { SentMessagePreviewModal } from "./SentMessagePreviewModal.js";
import "./communication.css";

export const DELIVERY_PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
export const DELIVERY_PAGE_SIZE_DEFAULT = 25;
/** Matches SystemLogsPanel's own POLL_INTERVAL_MS by convention (not by import - a shared
 * numeric constant would couple this feature's polling cadence to an unrelated settings page's
 * own tuning). */
export const DELIVERY_POLL_INTERVAL_MS = 1750;

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
  loading: boolean;
  showLoadingText: boolean;
  error: string | null;
  isUnfilteredEmpty: boolean;
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
  onRetry: () => void;
}

/** Loading/error/empty ladder + the responsive desktop-table / mobile-card split - same shape as
 * AttendeesTable's AttendeesListContent and Reports' AdmissionLog. */
function DeliveryListContent({
  eventId,
  deliveries,
  loading,
  showLoadingText,
  error,
  isUnfilteredEmpty,
  isDesktop,
  onViewSentMessage,
  onViewDetails,
  onResend,
  onDismiss,
  resolvedBounceRowIds,
  pendingBounceRowIds,
  onRetry,
}: Readonly<DeliveryListContentProps>) {
  if (loading && deliveries.length === 0) {
    return whenShown(showLoadingText, <div className="communication-empty">Loading deliveries…</div>);
  }
  if (error) {
    return (
      <EmptyState
        title="Could not load deliveries"
        description={error}
        action={
          <Button type="button" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        }
      />
    );
  }
  if (deliveries.length === 0) {
    return isUnfilteredEmpty ? (
      <EmptyState
        icon={<i className="ti ti-mail-off" aria-hidden="true" />}
        title="No messages sent yet"
        description="Ticket emails and resends will appear here once one is sent."
      />
    ) : (
      <EmptyState
        icon={<i className="ti ti-search-off" aria-hidden="true" />}
        title="No matches"
        description="Try a different search, or clear your filters."
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
              <StatusBadge status={row.status} />
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
              <td>{templateLabel(row)}</td>
              <td>{purposeLabel(row.purpose)}</td>
              <td>
                <StatusBadge status={row.status} />
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
  deliveries: DeliveryDto[];
  deliveryTotal: number;
  deliveriesLoading: boolean;
  deliveriesError: string | null;
  templates: MailTemplateListItem[];
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  status: NonNullable<EventDeliveriesListParams["status"]>;
  onStatusChange: (value: NonNullable<EventDeliveriesListParams["status"]>) => void;
  purpose: NonNullable<EventDeliveriesListParams["purpose"]>;
  onPurposeChange: (value: NonNullable<EventDeliveriesListParams["purpose"]>) => void;
  templateId: string;
  onTemplateIdChange: (value: string) => void;
  searchInput: string;
  /** Debounced value of `searchInput` - what the on-screen rows were actually fetched with.
   * Export uses this (not the live `searchInput`) so a click right after typing can't download a
   * CSV for a stale query the table itself hasn't caught up to yet. */
  search: string;
  onSearchChange: (value: string) => void;
  live: boolean;
  onLiveChange: (live: boolean) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onRetry: () => void;
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
 * edit-modal state - the page only needs to hand it data plus filter/page change callbacks. */
export function DeliveryLogTab({
  eventId,
  eventTimezone,
  deliveries,
  deliveryTotal,
  deliveriesLoading,
  deliveriesError,
  templates,
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
  status,
  onStatusChange,
  purpose,
  onPurposeChange,
  templateId,
  onTemplateIdChange,
  searchInput,
  search,
  onSearchChange,
  live,
  onLiveChange,
  hasActiveFilters,
  onClearFilters,
  onRetry,
  resolvedBounceRowIds,
  onBounceRowResolved,
  pendingBounceRowIds,
  onBounceRowPendingChange,
  onBounceHandled,
}: Readonly<DeliveryLogTabProps>) {
  const isDesktop = useIsDesktop();
  const [sentMessageRow, setSentMessageRow] = useState<DeliveryDto | null>(null);
  const [detailsRow, setDetailsRow] = useState<DeliveryDto | null>(null);
  const [exporting, setExporting] = useState(false);
  const { addToast } = useToast();
  const showLoadingText = useDelayedLoading(deliveriesLoading && deliveries.length === 0);

  const totalPages = Math.max(1, Math.ceil(deliveryTotal / pageSize));
  const safePage = Math.min(page, totalPages);
  const isUnfilteredEmpty =
    searchInput.trim() === "" && status === "all" && purpose === "all" && templateId === "all";

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

  return (
    <Card
      padded={false}
      className="communication-delivery-header"
      title={<HintLabel hint={DELIVERY_LOG_HINT}>Delivery log</HintLabel>}
      actions={
        <>
          <Button type="button" variant="secondary" size="sm" disabled={!hasActiveFilters} onClick={onClearFilters}>
            Clear filters
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={exporting} onClick={() => void handleExport()}>
            {exporting ? "Exporting…" : "Export log"}
          </Button>
          <Button
            type="button"
            variant={live ? "success" : "secondary"}
            size="sm"
            onClick={() => onLiveChange(!live)}
          >
            {live ? "Live" : "Paused"}
          </Button>
        </>
      }
    >
      <DeliveryToolbar
        searchInput={searchInput}
        onSearchChange={(value) => {
          onSearchChange(value);
          onPageChange(1);
        }}
        status={status}
        onStatusChange={(value) => {
          onStatusChange(value);
          onPageChange(1);
        }}
        purpose={purpose}
        onPurposeChange={(value) => {
          onPurposeChange(value);
          onPageChange(1);
        }}
        templateId={templateId}
        onTemplateIdChange={(value) => {
          onTemplateIdChange(value);
          onPageChange(1);
        }}
        templates={templates}
      />
      <DeliveryListContent
        eventId={eventId}
        deliveries={deliveries}
        loading={deliveriesLoading}
        showLoadingText={showLoadingText}
        error={deliveriesError}
        isUnfilteredEmpty={isUnfilteredEmpty}
        isDesktop={isDesktop}
        onViewSentMessage={setSentMessageRow}
        onViewDetails={setDetailsRow}
        onResend={(row) => void handleResend(row)}
        onDismiss={(row) => void handleDismiss(row)}
        resolvedBounceRowIds={resolvedBounceRowIds}
        pendingBounceRowIds={pendingBounceRowIds}
        onRetry={onRetry}
      />
      {deliveryTotal > 0 && (
        <div className="communication-log-footer">
          <PaginationFooter
            idPrefix="communication-log"
            page={safePage}
            pageSize={pageSize}
            totalPages={totalPages}
            totalRows={deliveryTotal}
            pageSizeOptions={DELIVERY_PAGE_SIZE_OPTIONS}
            onPageSizeChange={(size) => {
              onPageSizeChange(size);
              onPageChange(1);
            }}
            onPrevious={() => onPageChange(Math.max(1, safePage - 1))}
            onNext={() => onPageChange(safePage + 1)}
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
