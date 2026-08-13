import { useRef, type ReactNode } from "react";
import { Button, Card, Checkbox, EmptyState, IconButton, Input, Skeleton } from "@admitto/ui";
import type {
  AttendeeMailStatusFilter,
  AttendeeRowDto,
  AttendeeSortBy,
  AttendeeSortDir,
  RsvpStatus,
  TicketTypeDto,
} from "../api/types.js";
import {
  ARCHIVED_ACTION_TOOLTIP,
  ArchivedGuard,
  type ArchivedGuardEvent,
} from "../components/ArchivedGuard.js";
import { FiltersMenu } from "../components/FiltersMenu.js";
import { MoreActionsMenuItem } from "../components/MoreActionsMenuItem.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { useDelayedLoading, whenShown } from "../hooks/useDelayedLoading.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { MailStatusBadge } from "./mailStatusBadge.js";
import { PassStatusBadge } from "./passStatusBadge.js";
import { RSVP_STATUS_OPTIONS, RsvpStatusBadge } from "./rsvpStatusBadge.js";
import { TicketTypeBadge } from "./ticketTypeBadge.js";
import { WalletColumnCell } from "./walletColumnCell.js";
import { formatAdmissionDisplayParts } from "../utils/event-dates.js";

/** First-load placeholder for the desktop table — same column layout, no data yet. */
function AttendeesTableSkeleton() {
  return (
    <div className="attendees-table-wrap attendees-list-table-wrap" aria-busy="true">
      <span className="sr-only">Loading attendees…</span>
      <table className="table attendees-table-v2" aria-hidden="true">
        <thead>
          <tr>
            <th className="attendees-table-v2__checkbox-col" aria-label="Select" />
            <th>Attendee</th>
            <th>Company</th>
            <th>Ticket</th>
            <th>Pass status</th>
            <th>Attendance</th>
            <th>Mail</th>
            <th>Check-in</th>
            <th>Wallet</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, i) => (
            <tr key={i}>
              <td colSpan={9}>
                <Skeleton variant="rect" height={44} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** First-load placeholder for the mobile card list (< 768px — mirrors the table skeleton). */
function AttendeesCardsSkeleton() {
  return (
    <div className="attendees-cards" aria-busy="true">
      <span className="sr-only">Loading attendees…</span>
      {Array.from({ length: 4 }, (_, i) => (
        <div className="attendees-card" key={i}>
          <Skeleton variant="rect" height={64} />
        </div>
      ))}
    </div>
  );
}

/** Sortable columns, left to right, matching how operators scan a row (identity, affiliation,
 * the two independent status pairs, then attendance). Mail is deliberately absent — its value
 * is resolved per-row from a separate delivery lookup, not a plain column. */
const SORTABLE_COLUMNS: { column: AttendeeSortBy; label: string }[] = [
  { column: "name", label: "Attendee" },
  { column: "company", label: "Company" },
  { column: "ticket_type", label: "Ticket" },
  { column: "status", label: "Pass status" },
  { column: "rsvp_status", label: "Attendance" },
];

/** Same columns as the desktop header, plus Check-in (which sits after the unsortable Mail
 * column on desktop, so it isn't part of SORTABLE_COLUMNS) — the mobile "Sort by" select has
 * no column layout to split around, so it offers every sortable column together. */
const MOBILE_SORT_COLUMNS: { column: AttendeeSortBy; label: string }[] = [
  ...SORTABLE_COLUMNS,
  { column: "admitted_at", label: "Check-in" },
];

/** Column header that toggles the list's sort order on click — an unsorted column shows a
 * neutral two-way arrow, the active column shows a single arrow pointing in its current
 * direction. Clicking a new column always starts ascending (see AttendeesPage's onSortChange). */
function SortableHeader({
  column,
  label,
  sortBy,
  sortDir,
  onSortChange,
}: Readonly<{
  column: AttendeeSortBy;
  label: string;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
}>) {
  const active = sortBy === column;
  let ariaSortValue: "ascending" | "descending" | "none" = "none";
  let iconClass = "ti-arrows-sort";
  if (active) {
    ariaSortValue = sortDir === "asc" ? "ascending" : "descending";
    iconClass = sortDir === "asc" ? "ti-arrow-up" : "ti-arrow-down";
  }
  return (
    <th aria-sort={ariaSortValue}>
      <button
        type="button"
        className={`attendees-table-v2__sort-btn${active ? " attendees-table-v2__sort-btn--active" : ""}`}
        onClick={() => onSortChange(column)}
      >
        {label}
        <i className={`ti ${iconClass}`} aria-hidden="true" />
      </button>
    </th>
  );
}

/** Mobile equivalent of SortableHeader — a "Sort by" select (there's no column layout to attach
 * a per-column arrow to) plus a direction toggle. Reuses the same onSortChange contract: passing
 * the *current* column toggles its direction (AttendeesPage's onSortChange), passing a new one
 * switches to it ascending. */
function MobileSortControl({
  sortBy,
  sortDir,
  onSortChange,
}: Readonly<{
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
}>) {
  return (
    <div className="attendees-toolbar__filter attendees-toolbar__sort">
      <SearchableSelect
        id="attendees-sort-by"
        label="Sort by"
        placeholder="Sort by"
        searchPlaceholder="Search columns…"
        emptyLabel="No columns found"
        showLabel={false}
        value={sortBy}
        options={MOBILE_SORT_COLUMNS.map(({ column, label }) => ({ id: column, label }))}
        onChange={(id) => onSortChange(id as AttendeeSortBy)}
      />
      <IconButton
        label={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
        icon={<i className={`ti ${sortDir === "asc" ? "ti-sort-ascending" : "ti-sort-descending"}`} aria-hidden="true" />}
        size="sm"
        onClick={() => onSortChange(sortBy)}
      />
    </div>
  );
}

/** Renders as two stacked lines ("Today" / "14:32"), mirroring the two-line
 * name/email cell next to it — null when the attendee hasn't checked in. */
function CheckInCell({
  admittedAt,
  eventTimezone,
}: Readonly<{
  admittedAt: string | null;
  eventTimezone: string;
}>) {
  if (!admittedAt) return <span className="attendee-readonly">-</span>;
  const parts = formatAdmissionDisplayParts(admittedAt, eventTimezone);
  return (
    <span className="attendees-table-v2__checkin">
      <i className="ti ti-circle-check" aria-hidden="true" />
      <span className="attendees-table-v2__checkin-lines">
        <span className="attendees-table-v2__checkin-day">{parts.day}</span>
        <span className="attendees-table-v2__checkin-time">{parts.time}</span>
      </span>
    </span>
  );
}

type AttendeeStatusFilter = "all" | "admitted" | "not_admitted";

export interface AttendeesTableProps {
  items: AttendeeRowDto[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  hasLoadedOnce: boolean;
  isUnfilteredEmpty: boolean;
  searchInput: string;
  statusFilter: AttendeeStatusFilter;
  ticketTypeFilter: string;
  rsvpStatusFilter: "" | RsvpStatus;
  mailStatusFilter: "" | AttendeeMailStatusFilter;
  ticketTypes?: TicketTypeDto[];
  /** Set when the ticket-type filter's own catalog failed to load - the rest of the table (and
   * the other filters) still work, so this renders as a small inline notice next to the Type
   * filter, not a page-level error (CodeRabbit review, batch 04 / #351). */
  ticketTypesError?: string | null;
  onRetryTicketTypes?: () => void;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: AttendeeStatusFilter) => void;
  onTicketTypeFilterChange: (value: string) => void;
  onRsvpStatusFilterChange: (value: "" | RsvpStatus) => void;
  onMailStatusFilterChange: (value: "" | AttendeeMailStatusFilter) => void;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
  onViewAttendee: (id: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string) => void;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onBulkSendTickets: () => void;
  bulkSendBusy: boolean;
  canBulkSend: boolean;
  onBulkCheckIn: () => void;
  bulkCheckInBusy: boolean;
  onBulkRevokeCheckIn: () => void;
  bulkRevokeCheckInBusy: boolean;
  onBulkExportSelected: () => void;
  bulkExportBusy: boolean;
  onBulkChangeTicketType: () => void;
  onBulkChangeRsvpStatus: () => void;
  itemCount: number;
  itemsError?: string | null;
  onRetryItems?: () => void;
  onBulkRevokeItems: () => void;
  bulkRevokeItemsBusy: boolean;
  onBulkRevokePass: () => void;
  bulkRevokePassBusy: boolean;
  onBulkDelete: () => void;
  eventTimezone: string;
  event: ArchivedGuardEvent;
}

interface AttendeeCardProps {
  row: AttendeeRowDto;
  selected: boolean;
  onToggle: () => void;
  onView: () => void;
  ticketTypes: TicketTypeDto[];
  eventTimezone: string;
}

/** One attendee as a card — the < 768px equivalent of a table row: same data, same actions. */
function AttendeeCard({
  row,
  selected,
  onToggle,
  onView,
  ticketTypes,
  eventTimezone,
}: Readonly<AttendeeCardProps>) {
  return (
    <div className={`attendees-card${selected ? " attendees-card--selected" : ""}`}>
      <div className="attendees-card__top">
        <span className="attendees-card__cb">
          <Checkbox checked={selected} onChange={onToggle} aria-label={`Select ${row.name}`} />
        </span>
        <button type="button" className="attendees-row-btn attendees-card__identity" onClick={onView}>
          <span className="attendees-card__name">{row.name}</span>
          <span className="attendees-card__email">{row.email}</span>
        </button>
        <TicketTypeBadge ticketType={row.ticket_type} catalog={ticketTypes} />
      </div>
      {(row.company || row.department) && (
        <div className="attendees-card__meta">
          {row.company}
          {row.department ? ` · ${row.department}` : ""}
        </div>
      )}
      <div className="attendees-card__badges">
        <PassStatusBadge status={row.status} />
        <RsvpStatusBadge status={row.rsvp_status} />
        <MailStatusBadge status={row.last_mail_status} />
      </div>
      <div className="attendees-card__foot">
        {row.admitted_at ? (
          <CheckInCell admittedAt={row.admitted_at} eventTimezone={eventTimezone} />
        ) : (
          <span className="attendee-readonly">Not checked in</span>
        )}
        <WalletColumnCell status={row.wallet_status} />
      </div>
    </div>
  );
}

/** Mobile "Send tickets" menu item's disabled-title (Sonar S3358: was a nested ternary). */
function bulkSendTicketsTooltip(archived: boolean, canBulkSend: boolean): string | undefined {
  if (archived) return ARCHIVED_ACTION_TOOLTIP;
  if (!canBulkSend) return "No mail transport configured for this event. Set one up in Event Settings → Mailing.";
  return undefined;
}

function bulkRevokeCheckInTooltip(archived: boolean, canRevokeCheckIn: boolean): string | undefined {
  if (archived) return ARCHIVED_ACTION_TOOLTIP;
  if (!canRevokeCheckIn) return "None of the selected attendees are checked in.";
  return undefined;
}

/** "Revoke pass" menu item's disabled-title — same "nothing to do" gate as "Revoke check-in"
 * (PO review follow-up): a selection where every attendee is already revoked/cancelled is a
 * guaranteed no-op, so it's disabled rather than left clickable into a confirm dialog that just
 * reports nothing changed. A mixed selection stays enabled — there's still real work for the
 * still-active ones. */
function bulkRevokePassTooltip(archived: boolean, canRevokePass: boolean): string | undefined {
  if (archived) return ARCHIVED_ACTION_TOOLTIP;
  if (!canRevokePass) return "The selected attendees' passes are already revoked or cancelled.";
  return undefined;
}

/** A catalog fetch's own "retry" menu item - shared by "Change ticket type" and "Revoke items"
 * below, which each hide their retry the same way (not archived, the catalog is empty, the fetch
 * itself errored, and a retry callback was actually given). */
function RetryMenuItem({
  show,
  onRetry,
  label,
}: Readonly<{ show: boolean; onRetry: (() => void) | undefined; label: string }>) {
  if (!show || !onRetry) return null;
  return (
    <button type="button" role="menuitem" className="more-actions-menu__retry link-btn" onClick={onRetry}>
      {label}
    </button>
  );
}

/** Mobile-only "Send tickets" menu item - desktop already has its own direct bulk-bar button for
 * this (attendees.css), so this only needs to render below 768px. */
function BulkSendTicketsMenuItem({
  isDesktop,
  archived,
  bulkSendBusy,
  canBulkSend,
  selectedCount,
  onClick,
}: Readonly<{
  isDesktop: boolean;
  archived: boolean;
  bulkSendBusy: boolean;
  canBulkSend: boolean;
  selectedCount: number;
  onClick: () => void;
}>) {
  if (isDesktop) return null;
  return (
    <MoreActionsMenuItem
      icon="send"
      label={bulkSendBusy ? "Sending…" : "Send tickets"}
      hint={`Email tickets to ${selectedCount} attendee${selectedCount === 1 ? "" : "s"}`}
      disabled={archived || bulkSendBusy || !canBulkSend}
      tooltip={bulkSendTicketsTooltip(archived, canBulkSend)}
      onClick={onClick}
    />
  );
}

/** Bulk "More actions" — Export selected, Change ticket type, and Delete, styled as a menu
 * (not bare buttons) so the destructive bulk action takes an extra click to even reach,
 * matching the design mockup's More actions panel and the same danger-item treatment already
 * used on the attendee detail page's own More actions menu. Room to grow: the mockup also
 * shows reminders and wallet-pass actions in this same menu — not built yet, out of scope. */
function BulkMoreActionsMenu({
  selectedCount,
  archived,
  onBulkRevokeCheckIn,
  bulkRevokeCheckInBusy,
  canRevokeCheckIn,
  revokableCheckInCount,
  bulkSendBusy,
  canBulkSend,
  onBulkSendTickets,
  exportBusy,
  onExportSelected,
  ticketTypeCount,
  changeTicketTypeDisabled,
  changeTicketTypeDisabledReason,
  ticketTypesError,
  onRetryTicketTypes,
  onChangeTicketType,
  onChangeRsvpStatus,
  itemCount,
  revokableItemsCount,
  canRevokeItems,
  itemsError,
  onRetryItems,
  onBulkRevokeItems,
  bulkRevokeItemsBusy,
  onBulkRevokePass,
  bulkRevokePassBusy,
  canRevokePass,
  revokablePassCount,
  onDelete,
}: Readonly<{
  selectedCount: number;
  archived: boolean;
  onBulkRevokeCheckIn: () => void;
  bulkRevokeCheckInBusy: boolean;
  /** At least one selected attendee is currently checked in - there's something to revoke. */
  canRevokeCheckIn: boolean;
  /** How many of the selection are actually checked in - the count this action would affect,
   * not the raw selection size (PO review: was showing the full selection count even when
   * only some of it was checked in). */
  revokableCheckInCount: number;
  bulkSendBusy: boolean;
  canBulkSend: boolean;
  onBulkSendTickets: () => void;
  exportBusy: boolean;
  onExportSelected: () => void;
  ticketTypeCount: number;
  changeTicketTypeDisabled: boolean;
  changeTicketTypeDisabledReason?: string;
  ticketTypesError?: string | null;
  onRetryTicketTypes?: () => void;
  onChangeTicketType: () => void;
  onChangeRsvpStatus: () => void;
  itemCount: number;
  revokableItemsCount: number;
  /** At least one selected attendee has something issued and an active pass - there's something
   * to revoke (CodeRabbit/PO review: was only gated on the event's catalog size, not the
   * selection). */
  canRevokeItems: boolean;
  itemsError?: string | null;
  onRetryItems?: () => void;
  onBulkRevokeItems: () => void;
  bulkRevokeItemsBusy: boolean;
  onBulkRevokePass: () => void;
  bulkRevokePassBusy: boolean;
  canRevokePass: boolean;
  revokablePassCount: number;
  onDelete: () => void;
}>) {
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
  });
  const isDesktop = useIsDesktop();

  return (
    <div className="more-actions-menu" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        hasMenu
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {/* Shortened below 768px — with its leading icon dropped too (attendees.css), "More
         * actions" is the one label of the three bulk-bar buttons long enough to still not
         * fit on one line otherwise (PO review: was wrapping onto a 3rd line). */}
        {isDesktop ? "More actions" : "More"}
      </Button>
      {open && (
        <div className="more-actions-menu__panel" role="menu" ref={panelRef} style={panelStyle}>
          {/* Below 768px only — "Send tickets" doesn't fit as its own button next to the
           * count and "Check in" (attendees.css), so it lives here instead on mobile, first
           * in the list since it's still one of the two most common bulk actions. */}
          <BulkSendTicketsMenuItem
            isDesktop={isDesktop}
            archived={archived}
            bulkSendBusy={bulkSendBusy}
            canBulkSend={canBulkSend}
            selectedCount={selectedCount}
            onClick={() => {
              setOpen(false);
              onBulkSendTickets();
            }}
          />
          {/* Not ArchivedGuard'd — exporting a selection is read-only, so it stays legal
           * after an event is archived. */}
          <MoreActionsMenuItem
            icon="download"
            label="Export selected"
            hint={`CSV of ${selectedCount} attendee${selectedCount === 1 ? "" : "s"}`}
            disabled={exportBusy}
            onClick={() => {
              setOpen(false);
              onExportSelected();
            }}
          />
          {/* Disabled (not hidden) on archived events and when the catalog is empty — the
           * endpoint is guardArchivedEvent'd, and with no configured types there's nothing
           * to pick; the title explains why instead of the item silently vanishing. */}
          <MoreActionsMenuItem
            icon="ticket"
            label="Change ticket type"
            hint={`Choose from ${ticketTypeCount} configured type${ticketTypeCount === 1 ? "" : "s"}`}
            disabled={changeTicketTypeDisabled}
            tooltip={changeTicketTypeDisabled ? changeTicketTypeDisabledReason : undefined}
            onClick={() => {
              setOpen(false);
              onChangeTicketType();
            }}
          />
          {/* The catalog fetch's own retry lives behind the Type filter, which this bulk bar
           * replaces while rows are selected — without this, the only way to retry was to
           * clear the selection first, losing the batch the operator was about to act on
           * (Codex review). */}
          <RetryMenuItem
            show={!archived && changeTicketTypeDisabled && !!ticketTypesError}
            onRetry={onRetryTicketTypes}
            label="Retry loading ticket types"
          />
          {/* Fixed 5-value enum, unlike Change ticket type above - no per-event catalog to be
           * empty, so archived is the only disabled reason. */}
          <MoreActionsMenuItem
            icon="calendar-event"
            label="Change attendance status"
            hint={`Set for ${selectedCount} attendee${selectedCount === 1 ? "" : "s"}`}
            disabled={archived}
            tooltip={archived ? ARCHIVED_ACTION_TOOLTIP : undefined}
            onClick={() => {
              setOpen(false);
              onChangeRsvpStatus();
            }}
          />
          {/* Desktop already has a direct "Check in" button in the bulk bar, but no direct
           * revoke button anywhere — this menu is the only place for the reverse action, at
           * every screen size, unlike Send tickets above which is mobile-only (PO review, #522
           * follow-up: "revoke czy tam undo check in" for a selection). Disabled (not hidden)
           * when nothing in the selection is currently checked in, same convention as Change
           * ticket type below. Styled as a caution item (not full danger) — it's reversible via
           * Check in again, unlike Delete below (PO review). */}
          <MoreActionsMenuItem
            icon="qrcode-off"
            variant="warning"
            label={bulkRevokeCheckInBusy ? "Revoking check-in…" : "Revoke check-in"}
            hint={`Undo check-in for ${revokableCheckInCount} attendee${revokableCheckInCount === 1 ? "" : "s"}`}
            disabled={archived || bulkRevokeCheckInBusy || !canRevokeCheckIn}
            tooltip={bulkRevokeCheckInTooltip(archived, canRevokeCheckIn)}
            onClick={() => {
              setOpen(false);
              onBulkRevokeCheckIn();
            }}
          />
          {/* Disabled (not hidden) on archived events and when the event has no configured
           * items - same convention as Change ticket type above. Always resets every
           * configured item for the selection at once (no per-item picker, PO review, #551:
           * "od tego mamy check in widok" - for precise per-attendee/per-item
           * control, that already exists on the check-in screen). Independent of check-in
           * status, matching the Danger Zone's event-wide "Revoke all items issued". */}
          <MoreActionsMenuItem
            icon="package"
            variant="warning"
            label={bulkRevokeItemsBusy ? "Revoking items…" : "Revoke items"}
            hint={`Reset all issued items for ${revokableItemsCount} attendee${revokableItemsCount === 1 ? "" : "s"}`}
            disabled={archived || bulkRevokeItemsBusy || itemCount === 0 || !canRevokeItems}
            tooltip={bulkRevokeItemsTooltip(archived, itemCount, itemsError, canRevokeItems)}
            onClick={() => {
              setOpen(false);
              onBulkRevokeItems();
            }}
          />
          <RetryMenuItem
            show={!archived && itemCount === 0 && !!itemsError}
            onRetry={onRetryItems}
            label="Retry loading items"
          />
          {/* Disabled once every selected attendee is already revoked/cancelled — a guaranteed
           * no-op otherwise, same "nothing to do" gate as "Revoke check-in" (PO review
           * follow-up, #549). A mixed selection stays enabled: the server already leaves an
           * already-revoked/cancelled attendee untouched and reports it separately in the
           * result toast. */}
          <MoreActionsMenuItem
            icon="ban"
            variant="danger"
            label={bulkRevokePassBusy ? "Revoking pass…" : "Revoke pass"}
            hint={`Block check-in for ${revokablePassCount} attendee${revokablePassCount === 1 ? "" : "s"}`}
            disabled={archived || bulkRevokePassBusy || !canRevokePass}
            tooltip={bulkRevokePassTooltip(archived, canRevokePass)}
            onClick={() => {
              setOpen(false);
              onBulkRevokePass();
            }}
          />
          <hr className="more-actions-menu__divider" />
          {/* Not ArchivedGuard'd — GDPR erasure requests can legally arrive after an event
           * ends; the DELETE endpoint doesn't block on archived_at either. */}
          <MoreActionsMenuItem
            icon="trash"
            variant="danger"
            label="Delete"
            hint={`Permanently remove ${selectedCount} attendee${selectedCount === 1 ? "" : "s"}`}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          />
        </div>
      )}
    </div>
  );
}

/** "Change ticket type" menu item's disabled-title (Sonar S3358: was a nested ternary). */
function bulkChangeTicketTypeReason(archived: boolean, ticketTypesError?: string | null): string {
  if (archived) return ARCHIVED_ACTION_TOOLTIP;
  if (ticketTypesError) return "Couldn't load ticket types. Try again from the Type filter above.";
  return "No ticket types configured for this event. Add some in Event Settings → Ticket types.";
}

/** "Revoke items" menu item's disabled-title — checks the event-level catalog (no items
 * configured / failed to load) same as before, plus the same "nothing to do" selection-level
 * gate "Revoke check-in"/"Revoke pass" already have (CodeRabbit/PO review: was only checking the
 * event's catalog size, so a selection with nothing issued still opened the confirm dialog). */
function bulkRevokeItemsTooltip(
  archived: boolean,
  itemCount: number,
  itemsError: string | null | undefined,
  canRevokeItems: boolean,
): string | undefined {
  if (archived) return ARCHIVED_ACTION_TOOLTIP;
  if (itemsError) return "Couldn't load items. Try again.";
  if (itemCount === 0) return "No items configured for this event. Add some in Requirements.";
  if (!canRevokeItems) return "None of the selected attendees have anything issued.";
  return undefined;
}

/** Selection count + "Send tickets" / "More actions" — replaces the search/filter toolbar in
 * place while rows are selected, so the card never grows taller just because something is
 * selected. */
function BulkBar({
  selectedIds,
  onClearSelection,
  event,
  bulkSendBusy,
  canBulkSend,
  onBulkSendTickets,
  bulkCheckInBusy,
  onBulkCheckIn,
  checkInDisabled,
  onBulkRevokeCheckIn,
  bulkRevokeCheckInBusy,
  canRevokeCheckIn,
  revokableCheckInCount,
  bulkExportBusy,
  onBulkExportSelected,
  ticketTypes,
  ticketTypesError,
  onRetryTicketTypes,
  onBulkChangeTicketType,
  onBulkChangeRsvpStatus,
  itemCount,
  revokableItemsCount,
  canRevokeItems,
  itemsError,
  onRetryItems,
  onBulkRevokeItems,
  bulkRevokeItemsBusy,
  onBulkRevokePass,
  bulkRevokePassBusy,
  canRevokePass,
  revokablePassCount,
  onBulkDelete,
}: Readonly<{
  selectedIds: ReadonlySet<string>;
  onClearSelection: () => void;
  event: ArchivedGuardEvent;
  bulkSendBusy: boolean;
  canBulkSend: boolean;
  onBulkSendTickets: () => void;
  bulkCheckInBusy: boolean;
  onBulkCheckIn: () => void;
  /** Every selected attendee is already checked in - nothing for this action to do. */
  checkInDisabled: boolean;
  onBulkRevokeCheckIn: () => void;
  bulkRevokeCheckInBusy: boolean;
  /** At least one selected attendee is currently checked in - there's something to revoke. */
  canRevokeCheckIn: boolean;
  /** How many of the selection are actually checked in - threaded down to the menu item's hint
   * text instead of the raw selection size (PO review). */
  revokableCheckInCount: number;
  bulkExportBusy: boolean;
  onBulkExportSelected: () => void;
  ticketTypes: TicketTypeDto[];
  ticketTypesError?: string | null;
  onRetryTicketTypes?: () => void;
  onBulkChangeTicketType: () => void;
  onBulkChangeRsvpStatus: () => void;
  itemCount: number;
  revokableItemsCount: number;
  canRevokeItems: boolean;
  itemsError?: string | null;
  onRetryItems?: () => void;
  onBulkRevokeItems: () => void;
  bulkRevokeItemsBusy: boolean;
  onBulkRevokePass: () => void;
  bulkRevokePassBusy: boolean;
  canRevokePass: boolean;
  revokablePassCount: number;
  onBulkDelete: () => void;
}>) {
  const archived = event.archived_at != null;
  const isDesktop = useIsDesktop();
  return (
    <div className="attendees-bulkbar">
      <div className="attendees-bulkbar__info">
        <span className="attendees-bulkbar__count">
          <strong>{selectedIds.size}</strong> selected
        </span>
        <button
          type="button"
          className="attendees-bulkbar__clear"
          onClick={onClearSelection}
          aria-label="Clear selection"
        >
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </div>
      {/* Own wrapping group (not just spacer + buttons loose in the row) so it can sit
       * flush against the row's right edge (margin-left: auto) without a dedicated spacer
       * element. */}
      <div className="attendees-bulkbar__actions">
        <span className="attendees-bulkbar__sep" aria-hidden="true" />
        {/* Desktop only below 768px, "Send tickets" moves into the "More" menu instead
         * (attendees.css) — with the count and "Check in" it doesn't fit as its own button
         * without the row growing taller than the toolbar it replaces (PO review: selecting
         * attendees was visibly expanding the bar). */}
        {isDesktop && (
          <ArchivedGuard
            event={event}
            reasonId="bulk-send-tickets-reason"
            disabled={bulkSendBusy || !canBulkSend}
            tooltip={
              !canBulkSend
                ? "No mail transport configured for this event. Set one up in Event Settings → Mailing."
                : undefined
            }
          >
            {(guard) => (
              <Button
                variant="ghost"
                icon={<i className="ti ti-send" aria-hidden="true" />}
                {...guard}
                onClick={onBulkSendTickets}
              >
                {bulkSendBusy ? "Sending…" : "Send tickets"}
              </Button>
            )}
          </ArchivedGuard>
        )}
        <ArchivedGuard
          event={event}
          reasonId="bulk-checkin-reason"
          disabled={bulkCheckInBusy || checkInDisabled}
          tooltip={checkInDisabled ? "Every selected attendee is already checked in." : undefined}
        >
          {(guard) => (
            <Button
              variant="ghost"
              icon={<i className="ti ti-qrcode" aria-hidden="true" />}
              {...guard}
              onClick={onBulkCheckIn}
            >
              {bulkCheckInBusy ? "Checking in…" : "Check in"}
            </Button>
          )}
        </ArchivedGuard>
        <BulkMoreActionsMenu
          selectedCount={selectedIds.size}
          archived={archived}
          onBulkRevokeCheckIn={onBulkRevokeCheckIn}
          bulkRevokeCheckInBusy={bulkRevokeCheckInBusy}
          canRevokeCheckIn={canRevokeCheckIn}
          revokableCheckInCount={revokableCheckInCount}
          bulkSendBusy={bulkSendBusy}
          canBulkSend={canBulkSend}
          onBulkSendTickets={onBulkSendTickets}
          exportBusy={bulkExportBusy}
          onExportSelected={onBulkExportSelected}
          ticketTypeCount={ticketTypes.length}
          changeTicketTypeDisabled={archived || ticketTypes.length === 0}
          changeTicketTypeDisabledReason={bulkChangeTicketTypeReason(archived, ticketTypesError)}
          ticketTypesError={ticketTypesError}
          onRetryTicketTypes={onRetryTicketTypes}
          onChangeTicketType={onBulkChangeTicketType}
          onChangeRsvpStatus={onBulkChangeRsvpStatus}
          itemCount={itemCount}
          revokableItemsCount={revokableItemsCount}
          canRevokeItems={canRevokeItems}
          itemsError={itemsError}
          onRetryItems={onRetryItems}
          onBulkRevokeItems={onBulkRevokeItems}
          bulkRevokeItemsBusy={bulkRevokeItemsBusy}
          onBulkRevokePass={onBulkRevokePass}
          bulkRevokePassBusy={bulkRevokePassBusy}
          canRevokePass={canRevokePass}
          revokablePassCount={revokablePassCount}
          onDelete={onBulkDelete}
        />
      </div>
    </div>
  );
}

/** Search box + a single "Filters" trigger button. The four filter selects (and, on mobile,
 * the "Sort by" control) live in a floating dropdown panel opened from that button — not
 * inline in the row and not a horizontally-scrolling strip (both tried and rejected in PO
 * review: inline wrapping changed the row's height, and a scrollable row still meant
 * scrolling to reach a filter). A floating panel is `position: absolute`, so it overlays the
 * table below instead of pushing it down — the row itself (search + one button) never
 * changes size, at any viewport, whether the panel is open or closed. Same trigger+panel
 * mechanism as the Export and More actions menus elsewhere on this page. */
function FilterToolbar({
  searchInput,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  ticketTypeFilter,
  onTicketTypeFilterChange,
  ticketTypes,
  ticketTypesError,
  onRetryTicketTypes,
  rsvpStatusFilter,
  onRsvpStatusFilterChange,
  mailStatusFilter,
  onMailStatusFilterChange,
  isDesktop,
  sortBy,
  sortDir,
  onSortChange,
}: Readonly<{
  searchInput: string;
  onSearchChange: (value: string) => void;
  statusFilter: AttendeeStatusFilter;
  onStatusFilterChange: (value: AttendeeStatusFilter) => void;
  ticketTypeFilter: string;
  onTicketTypeFilterChange: (value: string) => void;
  ticketTypes: TicketTypeDto[];
  ticketTypesError?: string | null;
  onRetryTicketTypes?: () => void;
  rsvpStatusFilter: "" | RsvpStatus;
  onRsvpStatusFilterChange: (value: "" | RsvpStatus) => void;
  mailStatusFilter: "" | AttendeeMailStatusFilter;
  onMailStatusFilterChange: (value: "" | AttendeeMailStatusFilter) => void;
  isDesktop: boolean;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
}>) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) +
    (rsvpStatusFilter !== "" ? 1 : 0) +
    (ticketTypeFilter !== "" ? 1 : 0) +
    (mailStatusFilter !== "" ? 1 : 0);

  return (
    <div className="attendees-toolbar">
      <div className="attendees-toolbar__search">
        <Input
          ref={searchInputRef}
          id="attendees-search"
          name="attendees-search"
          aria-label="Search attendees by name, email, or company"
          placeholder="Name, email, or company"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          icon={<i className="ti ti-search" aria-hidden="true" />}
        />
        {searchInput.length > 0 && (
          <button
            type="button"
            className="attendees-toolbar__search-clear"
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
      <FiltersMenu activeCount={activeFilterCount} className="attendees-filters-menu">
        {!isDesktop && (
          <MobileSortControl sortBy={sortBy} sortDir={sortDir} onSortChange={onSortChange} />
        )}
        <div className="attendees-toolbar__filter">
          <SearchableSelect
            id="attendees-filter-type"
            label="Filter by ticket type"
            placeholder="All ticket types"
            searchPlaceholder="Search ticket types…"
            emptyLabel="No ticket types found"
            value={ticketTypeFilter}
            options={[
              { id: "", label: "All ticket types" },
              ...ticketTypes.map((t) => ({ id: t.key, label: t.label })),
            ]}
            onChange={onTicketTypeFilterChange}
          />
          {ticketTypesError && (
            <p className="mail-field-hint" role="alert">
              {ticketTypesError}{" "}
              {onRetryTicketTypes && (
                <button type="button" className="link-btn" onClick={onRetryTicketTypes}>
                  Retry
                </button>
              )}
            </p>
          )}
        </div>
        <div className="attendees-toolbar__filter">
          <SearchableSelect
            id="attendees-filter-rsvp"
            label="Filter by attendance"
            placeholder="All attendance statuses"
            searchPlaceholder="Search attendance statuses…"
            emptyLabel="No attendance statuses found"
            value={rsvpStatusFilter || "all"}
            options={[{ id: "all", label: "All attendance statuses" }, ...RSVP_STATUS_OPTIONS]}
            onChange={(value) => onRsvpStatusFilterChange(value === "all" ? "" : (value as RsvpStatus))}
          />
        </div>
        <div className="attendees-toolbar__filter">
          <SearchableSelect
            id="attendees-filter-checkin"
            label="Filter by check-in status"
            placeholder="All check-ins"
            searchPlaceholder="Search check-in statuses…"
            emptyLabel="No check-in statuses found"
            value={statusFilter}
            options={[
              { id: "all", label: "All check-ins" },
              { id: "admitted", label: "Checked in" },
              { id: "not_admitted", label: "Not checked in" },
            ]}
            onChange={(id) => onStatusFilterChange(id as AttendeeStatusFilter)}
          />
        </div>
        <div className="attendees-toolbar__filter">
          {/* Buckets over raw delivery statuses — filters the same latest-delivery status
            * the Mail column badge shows (#522). */}
          <SearchableSelect
            id="attendees-filter-mail"
            label="Filter by mail delivery status"
            placeholder="All mail statuses"
            searchPlaceholder="Search mail statuses…"
            emptyLabel="No mail statuses found"
            value={mailStatusFilter || "all"}
            options={[
              { id: "all", label: "All mail statuses" },
              { id: "not_sent", label: "Not sent" },
              { id: "sent", label: "Sent" },
              { id: "pending", label: "Pending" },
              { id: "failed", label: "Failed" },
            ]}
            onChange={(value) =>
              onMailStatusFilterChange(value === "all" ? "" : (value as AttendeeMailStatusFilter))
            }
          />
        </div>
      </FiltersMenu>
    </div>
  );
}

/** Desktop table, mobile card list (with its own "Select all" row, since there's no header
 * checkbox to reuse), the empty state, or the loading skeleton — whichever applies. */
function AttendeesListContent({
  loading,
  hasLoadedOnce,
  items,
  isDesktop,
  isUnfilteredEmpty,
  selectedIds,
  onToggleRow,
  onToggleSelectAll,
  onViewAttendee,
  sortBy,
  sortDir,
  onSortChange,
  ticketTypes,
  eventTimezone,
}: Readonly<{
  loading: boolean;
  hasLoadedOnce: boolean;
  items: AttendeeRowDto[];
  isDesktop: boolean;
  isUnfilteredEmpty: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string) => void;
  onToggleSelectAll: () => void;
  onViewAttendee: (id: string) => void;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
  ticketTypes: TicketTypeDto[];
  eventTimezone: string;
}>): ReactNode {
  // Only the very first load ever (never-loaded, items always [] at that point) gets the
  // shimmer skeleton. A later filter/search that also lands on zero matches reuses the same
  // dim-in-place treatment as a non-empty refetch instead of flashing the skeleton again.
  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash the
  // skeleton on and off faster than it can register as loading — show it only once the fetch
  // has genuinely taken a moment.
  const showLoadingSkeleton = useDelayedLoading(loading && !hasLoadedOnce);
  if (loading && !hasLoadedOnce) {
    return whenShown(showLoadingSkeleton, isDesktop ? <AttendeesTableSkeleton /> : <AttendeesCardsSkeleton />);
  }

  if (items.length === 0) {
    return (
      <div
        className={`attendees-table-wrap attendees-list-table-wrap${loading ? " attendees-table-wrap--loading" : ""}`}
      >
        {isUnfilteredEmpty ? (
          <EmptyState
            icon={<i className="ti ti-users" aria-hidden="true" />}
            title="No attendees yet"
            description="Import a CSV or XLSX file, or add attendees one at a time."
          />
        ) : (
          <EmptyState
            icon={<i className="ti ti-search-off" aria-hidden="true" />}
            title="No matches"
            description="Try a different search, or clear your filters."
          />
        )}
      </div>
    );
  }

  const allSelected = items.length > 0 && items.every((row) => selectedIds.has(row.id));

  if (!isDesktop) {
    return (
      <div className={`attendees-cards${loading ? " attendees-table-wrap--loading" : ""}`} aria-busy={loading}>
        <div className="attendees-cards__selectall">
          <Checkbox label="Select all" checked={allSelected} onChange={onToggleSelectAll} />
        </div>
        {items.map((row) => (
          <AttendeeCard
            key={row.id}
            row={row}
            selected={selectedIds.has(row.id)}
            onToggle={() => onToggleRow(row.id)}
            onView={() => onViewAttendee(row.id)}
            ticketTypes={ticketTypes}
            eventTimezone={eventTimezone}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`attendees-table-wrap attendees-list-table-wrap${loading ? " attendees-table-wrap--loading" : ""}`}
      aria-busy={loading}
    >
      <table className="table attendees-table-v2">
        <thead>
          <tr>
            <th className="attendees-table-v2__checkbox-col">
              <Checkbox checked={allSelected} onChange={onToggleSelectAll} aria-label="Select all" />
            </th>
            {SORTABLE_COLUMNS.map(({ column, label }) => (
              <SortableHeader
                key={column}
                column={column}
                label={label}
                sortBy={sortBy}
                sortDir={sortDir}
                onSortChange={onSortChange}
              />
            ))}
            <th>Mail</th>
            <SortableHeader
              column="admitted_at"
              label="Check-in"
              sortBy={sortBy}
              sortDir={sortDir}
              onSortChange={onSortChange}
            />
            <th>Wallet</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr
              key={row.id}
              className={`attendees-table-v2__row${
                selectedIds.has(row.id) ? " attendees-table-v2__row--selected" : ""
              }`}
            >
              <td>
                <Checkbox
                  checked={selectedIds.has(row.id)}
                  onChange={() => onToggleRow(row.id)}
                  aria-label={`Select ${row.name}`}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="attendees-row-btn attendees-table-v2__attendee"
                  onClick={() => onViewAttendee(row.id)}
                >
                  <span className="attendees-table-v2__name" title={row.name}>{row.name}</span>
                  <span className="attendees-table-v2__email" title={row.email}>{row.email}</span>
                </button>
              </td>
              <td>
                <div className="attendees-table-v2__company">
                  <span>{row.company ?? "-"}</span>
                  {row.department ? (
                    <span className="attendees-table-v2__department">{row.department}</span>
                  ) : null}
                </div>
              </td>
              <td>
                <TicketTypeBadge ticketType={row.ticket_type} catalog={ticketTypes} />
              </td>
              <td>
                <PassStatusBadge status={row.status} />
              </td>
              <td>
                <RsvpStatusBadge status={row.rsvp_status} />
              </td>
              <td>
                <MailStatusBadge status={row.last_mail_status} />
              </td>
              <td>
                <CheckInCell admittedAt={row.admitted_at} eventTimezone={eventTimezone} />
              </td>
              <td>
                <WalletColumnCell status={row.wallet_status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "0 attendees" is a confirmed-empty claim, not a loading placeholder — it must never render
 * while the first fetch (which "total" hasn't been set from yet) is still in flight, even during
 * the no-flash grace window before showLoadingText itself flips true (Sonar/PO review). */
function footSummary(
  isInitialLoad: boolean,
  showLoadingText: boolean,
  total: number,
  from: number,
  to: number,
): string {
  if (isInitialLoad) return showLoadingText ? "Loading…" : "";
  if (total === 0) return "0 attendees";
  return `Showing ${from}–${to} of ${total}`;
}

export function AttendeesTable({
  items,
  total,
  page,
  pageSize,
  loading,
  hasLoadedOnce,
  isUnfilteredEmpty,
  searchInput,
  statusFilter,
  ticketTypeFilter,
  rsvpStatusFilter,
  mailStatusFilter,
  ticketTypes = [],
  ticketTypesError,
  onRetryTicketTypes,
  onSearchChange,
  onStatusFilterChange,
  onTicketTypeFilterChange,
  onRsvpStatusFilterChange,
  onMailStatusFilterChange,
  sortBy,
  sortDir,
  onSortChange,
  onViewAttendee,
  onPageChange,
  onPageSizeChange,
  selectedIds,
  onToggleRow,
  onToggleSelectAll,
  onClearSelection,
  onBulkSendTickets,
  bulkSendBusy,
  canBulkSend,
  onBulkCheckIn,
  bulkCheckInBusy,
  onBulkRevokeCheckIn,
  bulkRevokeCheckInBusy,
  onBulkExportSelected,
  bulkExportBusy,
  onBulkChangeTicketType,
  onBulkChangeRsvpStatus,
  itemCount,
  itemsError,
  onRetryItems,
  onBulkRevokeItems,
  bulkRevokeItemsBusy,
  onBulkRevokePass,
  bulkRevokePassBusy,
  onBulkDelete,
  eventTimezone,
  event,
}: Readonly<AttendeesTableProps>) {
  // Wider than the shared 768px breakpoint (used elsewhere in this file for button-label
  // fit, unaffected): the table itself needs ~950-975px min-width for its 7 columns, which
  // used to force this all the way out to 1280px — 1024px (the tablet-rail sidebar's own
  // split, staff.css) left the table ~90px short, and 1025-1279px used to be worse still,
  // since past the rail breakpoint the sidebar switched to its ~240px always-expanded
  // desktop width there. Fixed at the source instead of compressing the table down to fit
  // that narrow 1025-1279px band: the rail now spans 768-1279px (shell.css), so the sidebar
  // never widens past 72px until there's already enough room for the table. That leaves a
  // single, continuous ~88px shortfall right at this 1024px floor (887px available vs the
  // table's 975px), closed with attendees.css's own compressed-table rules below this
  // breakpoint (tighter cell padding, truncated email) instead of needing a wider floor.
  const isDesktop = useIsDesktop(1024);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const selectedRows = items.filter((row) => selectedIds.has(row.id));
  // "Check in" is a no-op once every selected attendee is already admitted - disabled rather
  // than left clickable into a toast that just says so (PO review, #522 follow-up). A mixed
  // selection stays enabled: there's still real work for the not-yet-admitted ones, and the
  // bulk endpoint already reports "N already checked in" for those, same as today.
  const allSelectedAdmitted =
    selectedRows.length > 0 && selectedRows.every((row) => row.check_in_status === "admitted");
  const anySelectedAdmitted = selectedRows.some((row) => row.check_in_status === "admitted");
  // How many of the selection "Revoke check-in" would actually affect - the More actions menu's
  // hint text shows this instead of the raw selection size (PO review: a mixed selection was
  // claiming to undo check-in for attendees who were never checked in to begin with).
  const admittedSelectedCount = selectedRows.filter((row) => row.check_in_status === "admitted").length;
  // "Revoke items" hint reports how many of the selection actually have something issued, not
  // the raw selection size (PO review) — mirrors "Revoke check-in"/"Revoke pass" reporting only
  // the attendees they'd actually affect. A blocked-pass attendee is excluded even if
  // has_issued_items is true: the server's own isAdmittable guard refuses to reset their items
  // (CodeRabbit review).
  const revokableItemsCount = selectedRows.filter(
    (row) => row.has_issued_items && row.status !== "cancelled" && row.status !== "revoked",
  ).length;
  // "Revoke items" is a no-op once nothing in the selection has anything issued - disabled
  // rather than left clickable into a confirm dialog reporting "0 attendees" (CodeRabbit/PO
  // review: was only gated on the event's catalog size via itemCount, not the selection).
  const canRevokeItems = revokableItemsCount > 0;
  // "Revoke pass" is a no-op once every selected attendee is already revoked/cancelled -
  // disabled rather than left clickable into a confirm dialog that just reports nothing
  // changed, same "nothing to do" gate as "Revoke check-in" (PO review follow-up, #549). A
  // mixed selection stays enabled: there's still real work for the still-active ones.
  const anySelectedPassActive = selectedRows.some(
    (row) => row.status !== "cancelled" && row.status !== "revoked",
  );
  // How many of the selection actually have an active pass to revoke - shown in the "Revoke
  // pass" menu item's hint instead of the raw selection size, so a mixed selection doesn't
  // overstate the impact (PO review follow-up, #549).
  const activeSelectedPassCount = selectedRows.filter(
    (row) => row.status !== "cancelled" && row.status !== "revoked",
  ).length;
  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // this text on and off faster than it can register as loading — show it only once the
  // fetch has genuinely taken a moment. isInitialLoad itself (not the delayed derivative)
  // gates footSummary's 3-way branch so a fast response never renders "0 attendees" against
  // a "total" that hasn't been set from a real response yet.
  const isInitialLoad = loading && items.length === 0;
  const showFooterLoadingText = useDelayedLoading(isInitialLoad);

  return (
    <Card padded={false}>
      {selectedIds.size > 0 ? (
        <BulkBar
          selectedIds={selectedIds}
          onClearSelection={onClearSelection}
          event={event}
          bulkSendBusy={bulkSendBusy}
          canBulkSend={canBulkSend}
          onBulkSendTickets={onBulkSendTickets}
          bulkCheckInBusy={bulkCheckInBusy}
          onBulkCheckIn={onBulkCheckIn}
          checkInDisabled={allSelectedAdmitted}
          onBulkRevokeCheckIn={onBulkRevokeCheckIn}
          bulkRevokeCheckInBusy={bulkRevokeCheckInBusy}
          canRevokeCheckIn={anySelectedAdmitted}
          revokableCheckInCount={admittedSelectedCount}
          bulkExportBusy={bulkExportBusy}
          onBulkExportSelected={onBulkExportSelected}
          ticketTypes={ticketTypes}
          ticketTypesError={ticketTypesError}
          onRetryTicketTypes={onRetryTicketTypes}
          onBulkChangeTicketType={onBulkChangeTicketType}
          onBulkChangeRsvpStatus={onBulkChangeRsvpStatus}
          itemCount={itemCount}
          revokableItemsCount={revokableItemsCount}
          canRevokeItems={canRevokeItems}
          itemsError={itemsError}
          onRetryItems={onRetryItems}
          onBulkRevokeItems={onBulkRevokeItems}
          bulkRevokeItemsBusy={bulkRevokeItemsBusy}
          onBulkRevokePass={onBulkRevokePass}
          bulkRevokePassBusy={bulkRevokePassBusy}
          canRevokePass={anySelectedPassActive}
          revokablePassCount={activeSelectedPassCount}
          onBulkDelete={onBulkDelete}
        />
      ) : (
        <FilterToolbar
          searchInput={searchInput}
          onSearchChange={onSearchChange}
          statusFilter={statusFilter}
          onStatusFilterChange={onStatusFilterChange}
          ticketTypeFilter={ticketTypeFilter}
          onTicketTypeFilterChange={onTicketTypeFilterChange}
          ticketTypes={ticketTypes}
          ticketTypesError={ticketTypesError}
          onRetryTicketTypes={onRetryTicketTypes}
          rsvpStatusFilter={rsvpStatusFilter}
          onRsvpStatusFilterChange={onRsvpStatusFilterChange}
          mailStatusFilter={mailStatusFilter}
          onMailStatusFilterChange={onMailStatusFilterChange}
          isDesktop={isDesktop}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={onSortChange}
        />
      )}
      <AttendeesListContent
        loading={loading}
        hasLoadedOnce={hasLoadedOnce}
        items={items}
        isDesktop={isDesktop}
        isUnfilteredEmpty={isUnfilteredEmpty}
        selectedIds={selectedIds}
        onToggleRow={onToggleRow}
        onToggleSelectAll={onToggleSelectAll}
        onViewAttendee={onViewAttendee}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={onSortChange}
        ticketTypes={ticketTypes}
        eventTimezone={eventTimezone}
      />
      <div className="attendees-table-foot">
        <div className="attendees-table-foot__summary">
          <span>{footSummary(isInitialLoad, showFooterLoadingText, total, from, to)}</span>
          <div className="attendees-table-foot__pagesize">
            <label htmlFor="attendees-rows-per-page">Rows per page</label>
            <SearchableSelect
              id="attendees-rows-per-page"
              label="Rows per page"
              placeholder="Rows per page"
              searchPlaceholder="Search page sizes…"
              emptyLabel="No page sizes found"
              showLabel={false}
              minWidth={72}
              value={String(pageSize)}
              options={[10, 25, 50, 100].map((n) => ({ id: String(n), label: String(n) }))}
              onChange={(id) => onPageSizeChange(Number(id))}
            />
          </div>
        </div>
        <div className="attendees-table-foot__pager">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </Card>
  );
}
