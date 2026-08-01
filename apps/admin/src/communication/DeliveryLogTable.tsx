import { useRef, useState } from "react";
import { Link } from "react-router";
import { Button, Card, EmptyState, Input, Select, StatusBadge, Tooltip, useToast } from "@admitto/ui";
import { exportDeliveryLog } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { DeliveryDto, EventDeliveriesListParams, MailTemplateListItem } from "../api/types.js";
import { FiltersMenu } from "../components/FiltersMenu.js";
import { PaginationFooter } from "../components/PaginationFooter.js";
import { useDelayedLoading, whenShown } from "../hooks/useDelayedLoading.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { deliveryLocalTime, formatDateTime, purposeLabel, rowTimestamp, templateLabel } from "./delivery-format.js";
import { DeliveryDetailsModal } from "./DeliveryDetailsModal.js";
import { DeliveryRowMenu } from "./DeliveryRowMenu.js";
import { SentMessagePreviewModal } from "./SentMessagePreviewModal.js";

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
  status: EventDeliveriesListParams["status"];
  onStatusChange: (value: EventDeliveriesListParams["status"]) => void;
  purpose: EventDeliveriesListParams["purpose"];
  onPurposeChange: (value: EventDeliveriesListParams["purpose"]) => void;
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
          <Select
            id="communication-log-status-filter"
            aria-label="Status"
            value={status}
            onChange={(e) => onStatusChange(e.target.value as EventDeliveriesListParams["status"])}
          >
            <option value="all">All statuses</option>
            <option value="queued">Queued</option>
            <option value="accepted">Accepted</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
            <option value="bounced">Bounced</option>
            <option value="rejected">Rejected</option>
          </Select>
        </div>
        <div className="communication-toolbar__filter">
          <Select
            id="communication-log-purpose-filter"
            aria-label="Purpose"
            value={purpose}
            onChange={(e) => onPurposeChange(e.target.value as EventDeliveriesListParams["purpose"])}
          >
            <option value="all">All purposes</option>
            <option value="initial">Initial send</option>
            <option value="resend">Resend</option>
          </Select>
        </div>
        <div className="communication-toolbar__filter">
          <Select
            id="communication-log-template-filter"
            aria-label="Template"
            value={templateId}
            onChange={(e) => onTemplateIdChange(e.target.value)}
          >
            <option value="all">All templates</option>
            <option value="default">Default ticket template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
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
}: Readonly<DeliveryListContentProps>) {
  if (loading && deliveries.length === 0) {
    return whenShown(showLoadingText, <div className="communication-empty">Loading deliveries…</div>);
  }
  if (error) {
    return <div className="communication-empty">{error}</div>;
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
              <DeliveryRowMenu row={row} onViewSentMessage={onViewSentMessage} onViewDetails={onViewDetails} />
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
              <Tooltip content={SENT_QUEUED_TIME_HINT} className="communication-log-title">
                Sent / Queued <i className="ti ti-info-circle" aria-hidden="true" />
              </Tooltip>
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
                <DeliveryRowMenu row={row} onViewSentMessage={onViewSentMessage} onViewDetails={onViewDetails} />
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
  deliveries: DeliveryDto[];
  deliveryTotal: number;
  deliveriesLoading: boolean;
  deliveriesError: string | null;
  templates: MailTemplateListItem[];
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  status: EventDeliveriesListParams["status"];
  onStatusChange: (value: EventDeliveriesListParams["status"]) => void;
  purpose: EventDeliveriesListParams["purpose"];
  onPurposeChange: (value: EventDeliveriesListParams["purpose"]) => void;
  templateId: string;
  onTemplateIdChange: (value: string) => void;
  searchInput: string;
  onSearchChange: (value: string) => void;
  live: boolean;
  onLiveChange: (live: boolean) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

const DELIVERY_LOG_HINT =
  "Every ticket email and resend attempt for this event, with delivery status and diagnostics.";

/** Delivery log tab: search + filters toolbar, the deliveries table/cards (with its own
 * loading/error/empty states), pagination footer, and the two row-menu-triggered modals. Owns
 * which (if any) delivery's modal is open itself, same as EventCustomFieldsCard owning its own
 * edit-modal state - the page only needs to hand it data plus filter/page change callbacks. */
export function DeliveryLogTab({
  eventId,
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
  onSearchChange,
  live,
  onLiveChange,
  hasActiveFilters,
  onClearFilters,
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
      await exportDeliveryLog(eventId, { status, purpose, search: searchInput.trim() || undefined, templateId });
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to export the delivery log."), "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card
      padded={false}
      title={
        <Tooltip content={DELIVERY_LOG_HINT} className="communication-log-title">
          Delivery log <i className="ti ti-info-circle" aria-hidden="true" />
        </Tooltip>
      }
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
