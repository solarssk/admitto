import { useRef, useState } from "react";
import { Link } from "react-router";
import { Button, Card, EmptyState, Input, Select, StatusBadge, useToast } from "@admitto/ui";
import { exportDeliveryLog } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { DeliveryDto, EventDeliveriesListParams, MailTemplateListItem } from "../api/types.js";
import { FiltersMenu } from "../components/FiltersMenu.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { useDelayedLoading, whenShown } from "../hooks/useDelayedLoading.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { formatDateTime, purposeLabel, rowTimestamp, templateLabel } from "./delivery-format.js";
import { DeliveryDetailsModal } from "./DeliveryDetailsModal.js";
import { SentMessagePreviewModal } from "./SentMessagePreviewModal.js";

export const DELIVERY_PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
export const DELIVERY_PAGE_SIZE_DEFAULT = 25;

interface DeliveryRowMenuProps {
  eventId: string;
  row: DeliveryDto;
  onViewSentMessage: (row: DeliveryDto) => void;
  onViewDetails: (row: DeliveryDto) => void;
}

/** Per-row "..." menu: same trigger+role="menu" panel mechanism as UserMenu/MoreActionsMenu,
 * just anchored to a table row (or mobile card) instead of a page header. */
function DeliveryRowMenu({ eventId, row, onViewSentMessage, onViewDetails }: Readonly<DeliveryRowMenuProps>) {
  const { open, setOpen, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();

  return (
    <div className="communication-row-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="at-iconbtn at-iconbtn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${row.attendee_name}'s message`}
        onClick={() => setOpen((o) => !o)}
      >
        <i className="ti ti-dots-vertical" aria-hidden="true" />
      </button>
      {open && (
        <div className="communication-row-menu__panel" role="menu" ref={panelRef}>
          <button
            type="button"
            role="menuitem"
            className="communication-row-menu__item"
            onClick={() => {
              setOpen(false);
              onViewSentMessage(row);
            }}
          >
            <i className="ti ti-mail-opened" aria-hidden="true" />
            View sent message
          </button>
          <button
            type="button"
            role="menuitem"
            className="communication-row-menu__item"
            onClick={() => {
              setOpen(false);
              onViewDetails(row);
            }}
          >
            <i className="ti ti-list-details" aria-hidden="true" />
            View delivery details
          </button>
          <Link
            role="menuitem"
            className="communication-row-menu__item"
            to={`/admin/events/${eventId}/attendees/${row.attendee_id}`}
            onClick={() => setOpen(false)}
          >
            <i className="ti ti-user" aria-hidden="true" />
            Open attendee
          </Link>
        </div>
      )}
    </div>
  );
}

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
  exportParams: EventDeliveriesListParams;
  eventId: string;
}

/** Search box (name/email) + collapsible Filters (Status/Purpose/Template) + Export log button -
 * same composition as Attendees' FilterToolbar, with a single "Export logs" button (AuditLogPanel's
 * simpler template) instead of a multi-format export menu, since the log only ever exports CSV. */
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
  exportParams,
  eventId,
}: Readonly<DeliveryToolbarProps>) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const { addToast } = useToast();
  const activeFilterCount =
    (status !== "all" ? 1 : 0) + (purpose !== "all" ? 1 : 0) + (templateId !== "all" ? 1 : 0);

  async function handleExport() {
    setExporting(true);
    try {
      await exportDeliveryLog(eventId, exportParams);
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to export the delivery log."), "error");
    } finally {
      setExporting(false);
    }
  }

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
      <Button type="button" variant="secondary" size="sm" disabled={exporting} onClick={() => void handleExport()}>
        {exporting ? "Exporting…" : "Export log"}
      </Button>
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
      <EmptyState icon={<i className="ti ti-mail-off" aria-hidden="true" />} title="No messages sent yet" />
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
              <span className="communication-card__name">{row.attendee_name}</span>
              <DeliveryRowMenu
                eventId={eventId}
                row={row}
                onViewSentMessage={onViewSentMessage}
                onViewDetails={onViewDetails}
              />
            </div>
            <div className="communication-card__meta">
              <span className="communication-card__meta-item">
                <i className="ti ti-mail" aria-hidden="true" />
                {row.recipient_email ?? "-"}
              </span>
              <span className="communication-card__meta-item">
                <i className="ti ti-clock" aria-hidden="true" />
                {formatDateTime(rowTimestamp(row))}
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
            <th>Sent / Queued</th>
            <th className="communication-row-menu-cell" aria-label="Actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="communication-user">
                  <strong>{row.attendee_name}</strong>
                  <span className="mono muted">{row.recipient_email ?? "-"}</span>
                </div>
              </td>
              <td>{templateLabel(row)}</td>
              <td>{purposeLabel(row.purpose)}</td>
              <td>
                <StatusBadge status={row.status} />
              </td>
              <td className="mono muted">{formatDateTime(rowTimestamp(row))}</td>
              <td className="communication-row-menu-cell">
                <DeliveryRowMenu
                  eventId={eventId}
                  row={row}
                  onViewSentMessage={onViewSentMessage}
                  onViewDetails={onViewDetails}
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
}

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
}: Readonly<DeliveryLogTabProps>) {
  const isDesktop = useIsDesktop();
  const [sentMessageRow, setSentMessageRow] = useState<DeliveryDto | null>(null);
  const [detailsRow, setDetailsRow] = useState<DeliveryDto | null>(null);
  const showLoadingText = useDelayedLoading(deliveriesLoading && deliveries.length === 0);

  const totalPages = Math.max(1, Math.ceil(deliveryTotal / pageSize));
  const safePage = Math.min(page, totalPages);
  const from = deliveryTotal === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, deliveryTotal);
  const isUnfilteredEmpty =
    searchInput.trim() === "" && status === "all" && purpose === "all" && templateId === "all";

  return (
    <Card padded={false}>
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
        exportParams={{ status, purpose, search: searchInput.trim() || undefined, templateId }}
        eventId={eventId}
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
      <div className="communication-foot">
        <span>
          {deliveryTotal === 0 ? "0 messages" : `Showing ${from}–${to} of ${deliveryTotal}`}
        </span>
        <div className="communication-foot__controls">
          <label className="communication-pagesize">
            <span>Rows per page</span>
            <select
              id="communication-log-pagesize"
              className="at-select"
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
            >
              {DELIVERY_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          {deliveryTotal > pageSize && (
            <div className="communication-pager">
              <Button
                variant="secondary"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => onPageChange(Math.max(1, safePage - 1))}
              >
                Previous
              </Button>
              <span>
                Page {safePage} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={safePage >= totalPages}
                onClick={() => onPageChange(safePage + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
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
