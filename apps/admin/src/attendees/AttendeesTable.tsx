import { useState, type ReactNode } from "react";
import { Button, Card, Checkbox, EmptyState, IconButton, Input, Select, Skeleton } from "@admitto/ui";
import type { AttendeeRowDto, AttendeeSortBy, AttendeeSortDir, RsvpStatus, TicketTypeDto } from "../api/types.js";
import { ArchivedGuard, type ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { MailStatusBadge } from "./mailStatusBadge.js";
import { PassStatusBadge } from "./passStatusBadge.js";
import { RsvpStatusBadge } from "./rsvpStatusBadge.js";
import { TicketTypeBadge } from "./ticketTypeBadge.js";
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
            <th className="attendees-table-v2__actions-col" aria-label="Actions">
              <span className="sr-only">Actions</span>
            </th>
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
      <Select
        id="attendees-sort-by"
        name="attendees-sort-by"
        aria-label="Sort by"
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value as AttendeeSortBy)}
      >
        {MOBILE_SORT_COLUMNS.map(({ column, label }) => (
          <option key={column} value={column}>
            {label}
          </option>
        ))}
      </Select>
      <IconButton
        label={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
        icon={<i className={`ti ${sortDir === "asc" ? "ti-sort-ascending" : "ti-sort-descending"}`} aria-hidden="true" />}
        size="sm"
        onClick={() => onSortChange(sortBy)}
      />
    </div>
  );
}

/** Revoke/Restore pass icon buttons for one row — shared by the desktop table row and the
 * mobile card, which otherwise duplicated this exact block with only their `reasonId` suffix
 * differing (`row.id` vs `card-${row.id}`, so ArchivedGuard's `aria-describedby` id stays
 * unique between the two layouts if both ever render at once, e.g. mid-breakpoint-resize). */
function PassActionButtons({
  row,
  event,
  reasonIdSuffix,
  passActionBusyIds,
  onRevokePass,
  onRestorePass,
}: Readonly<{
  row: AttendeeRowDto;
  event: ArchivedGuardEvent;
  reasonIdSuffix: string;
  passActionBusyIds: ReadonlySet<string>;
  onRevokePass?: (row: AttendeeRowDto) => void;
  onRestorePass?: (row: AttendeeRowDto) => void;
}>) {
  return (
    <>
      {row.status === "revoked" && onRestorePass ? (
        <ArchivedGuard
          event={event}
          reasonId={`restore-pass-reason-${reasonIdSuffix}`}
          disabled={passActionBusyIds.has(row.id)}
        >
          {(guard) => (
            <IconButton
              label="Restore pass"
              icon={<i className="ti ti-refresh" aria-hidden="true" />}
              size="sm"
              {...guard}
              onClick={() => onRestorePass(row)}
            />
          )}
        </ArchivedGuard>
      ) : null}
      {row.status !== "cancelled" && row.status !== "revoked" && onRevokePass ? (
        <ArchivedGuard
          event={event}
          reasonId={`revoke-pass-reason-${reasonIdSuffix}`}
          disabled={passActionBusyIds.has(row.id)}
        >
          {(guard) => (
            <IconButton
              label="Revoke pass"
              icon={<i className="ti ti-ban" aria-hidden="true" />}
              size="sm"
              {...guard}
              onClick={() => onRevokePass(row)}
            />
          )}
        </ArchivedGuard>
      ) : null}
    </>
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
  if (!admittedAt) return <span className="attendee-readonly">—</span>;
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

export interface AttendeesTableProps {
  items: AttendeeRowDto[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  hasLoadedOnce: boolean;
  isUnfilteredEmpty: boolean;
  searchInput: string;
  statusFilter: "all" | "admitted" | "not_admitted";
  ticketTypeFilter: string;
  rsvpStatusFilter: "" | RsvpStatus;
  ticketTypes?: TicketTypeDto[];
  /** Set when the ticket-type filter's own catalog failed to load - the rest of the table (and
   * the other filters) still work, so this renders as a small inline notice next to the Type
   * filter, not a page-level error (CodeRabbit review, batch 04 / #351). */
  ticketTypesError?: string | null;
  onRetryTicketTypes?: () => void;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: "all" | "admitted" | "not_admitted") => void;
  onTicketTypeFilterChange: (value: string) => void;
  onRsvpStatusFilterChange: (value: "" | RsvpStatus) => void;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
  onViewAttendee: (id: string) => void;
  onRevokePass?: (row: AttendeeRowDto) => void;
  onRestorePass?: (row: AttendeeRowDto) => void;
  passActionBusyIds?: ReadonlySet<string>;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string) => void;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onBulkSendTickets: () => void;
  bulkSendBusy: boolean;
  canBulkSend: boolean;
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
  event: ArchivedGuardEvent;
  passActionBusyIds: ReadonlySet<string>;
  onRevokePass?: (row: AttendeeRowDto) => void;
  onRestorePass?: (row: AttendeeRowDto) => void;
}

/** One attendee as a card — the < 768px equivalent of a table row: same data, same actions. */
function AttendeeCard({
  row,
  selected,
  onToggle,
  onView,
  ticketTypes,
  eventTimezone,
  event,
  passActionBusyIds,
  onRevokePass,
  onRestorePass,
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
        <div className="attendees-card__actions">
          <IconButton
            label="View attendee"
            icon={<i className="ti ti-eye" aria-hidden="true" />}
            size="sm"
            onClick={onView}
          />
          <PassActionButtons
            row={row}
            event={event}
            reasonIdSuffix={`card-${row.id}`}
            passActionBusyIds={passActionBusyIds}
            onRevokePass={onRevokePass}
            onRestorePass={onRestorePass}
          />
        </div>
      </div>
    </div>
  );
}

/** Selection count + "Send tickets" — replaces the search/filter toolbar in place while rows
 * are selected, so the card never grows taller just because something is selected. */
function BulkBar({
  selectedIds,
  onClearSelection,
  event,
  bulkSendBusy,
  canBulkSend,
  onBulkSendTickets,
}: Readonly<{
  selectedIds: ReadonlySet<string>;
  onClearSelection: () => void;
  event: ArchivedGuardEvent;
  bulkSendBusy: boolean;
  canBulkSend: boolean;
  onBulkSendTickets: () => void;
}>) {
  return (
    <div className="attendees-bulkbar">
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
      <div className="attendees-bulkbar__spacer" />
      <span className="attendees-bulkbar__sep" aria-hidden="true" />
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
    </div>
  );
}

/** Search box, the three filter selects (behind a "Filters" toggle below 768px), and — mobile
 * only, since there's no column header to click — a "Sort by" control. Owns its own open/close
 * state for the mobile filters panel; nothing outside this component needs it. */
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
  isDesktop,
  sortBy,
  sortDir,
  onSortChange,
}: Readonly<{
  searchInput: string;
  onSearchChange: (value: string) => void;
  statusFilter: "all" | "admitted" | "not_admitted";
  onStatusFilterChange: (value: "all" | "admitted" | "not_admitted") => void;
  ticketTypeFilter: string;
  onTicketTypeFilterChange: (value: string) => void;
  ticketTypes: TicketTypeDto[];
  ticketTypesError?: string | null;
  onRetryTicketTypes?: () => void;
  rsvpStatusFilter: "" | RsvpStatus;
  onRsvpStatusFilterChange: (value: "" | RsvpStatus) => void;
  isDesktop: boolean;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
}>) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) + (rsvpStatusFilter !== "" ? 1 : 0) + (ticketTypeFilter !== "" ? 1 : 0);

  return (
    <div className="attendees-toolbar">
      <div className="attendees-toolbar__search">
        <Input
          id="attendees-search"
          name="attendees-search"
          aria-label="Search attendees by name, email, or company"
          placeholder="Name, email, or company"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          icon={<i className="ti ti-search" aria-hidden="true" />}
        />
      </div>
      <button
        type="button"
        className="attendees-filters-toggle"
        onClick={() => setFiltersOpen((v) => !v)}
        aria-expanded={filtersOpen}
      >
        <i className="ti ti-filter" aria-hidden="true" />
        Filters
        {activeFilterCount > 0 && <span className="attendees-filters-toggle__count">{activeFilterCount}</span>}
        <i className={`ti ti-chevron-${filtersOpen ? "up" : "down"}`} aria-hidden="true" />
      </button>
      <div className={`attendees-filters${filtersOpen ? " attendees-filters--open" : ""}`}>
        {!isDesktop && <MobileSortControl sortBy={sortBy} sortDir={sortDir} onSortChange={onSortChange} />}
        <div className="attendees-toolbar__filter">
          <Select
            id="attendees-filter-type"
            name="attendees-filter-type"
            aria-label="Filter by ticket type"
            value={ticketTypeFilter}
            onChange={(e) => onTicketTypeFilterChange(e.target.value)}
          >
            <option value="">All ticket types</option>
            {ticketTypes.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
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
          <Select
            id="attendees-filter-rsvp"
            name="attendees-filter-rsvp"
            aria-label="Filter by attendance"
            value={rsvpStatusFilter}
            onChange={(e) => onRsvpStatusFilterChange(e.target.value as "" | RsvpStatus)}
          >
            <option value="">All attendance</option>
            <option value="none">Registered</option>
            <option value="confirmed">Confirmed</option>
            <option value="declined">Declined</option>
            <option value="tentative">Tentative</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <div className="attendees-toolbar__filter">
          <Select
            id="attendees-filter-checkin"
            name="attendees-filter-checkin"
            aria-label="Filter by check-in status"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value as "all" | "admitted" | "not_admitted")}
          >
            <option value="all">All check-ins</option>
            <option value="admitted">Checked in</option>
            <option value="not_admitted">Not checked in</option>
          </Select>
        </div>
      </div>
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
  event,
  passActionBusyIds,
  onRevokePass,
  onRestorePass,
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
  event: ArchivedGuardEvent;
  passActionBusyIds: ReadonlySet<string>;
  onRevokePass?: (row: AttendeeRowDto) => void;
  onRestorePass?: (row: AttendeeRowDto) => void;
}>): ReactNode {
  // Only the very first load ever (never-loaded, items always [] at that point) gets the
  // shimmer skeleton. A later filter/search that also lands on zero matches reuses the same
  // dim-in-place treatment as a non-empty refetch instead of flashing the skeleton again.
  if (loading && !hasLoadedOnce) {
    return isDesktop ? <AttendeesTableSkeleton /> : <AttendeesCardsSkeleton />;
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
            event={event}
            passActionBusyIds={passActionBusyIds}
            onRevokePass={onRevokePass}
            onRestorePass={onRestorePass}
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
            <th className="attendees-table-v2__actions-col" aria-label="Actions">
              <span className="sr-only">Actions</span>
            </th>
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
                  <span className="attendees-table-v2__name">{row.name}</span>
                  <span className="attendees-table-v2__email">{row.email}</span>
                </button>
              </td>
              <td>
                <div className="attendees-table-v2__company">
                  <span>{row.company ?? "—"}</span>
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
                <div className="attendees-table-v2__actions">
                  <IconButton
                    label="View attendee"
                    icon={<i className="ti ti-eye" aria-hidden="true" />}
                    size="sm"
                    onClick={() => onViewAttendee(row.id)}
                  />
                  <PassActionButtons
                    row={row}
                    event={event}
                    reasonIdSuffix={row.id}
                    passActionBusyIds={passActionBusyIds}
                    onRevokePass={onRevokePass}
                    onRestorePass={onRestorePass}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function footSummary(loading: boolean, items: AttendeeRowDto[], total: number, from: number, to: number): string {
  if (loading && items.length === 0) return "Loading…";
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
  ticketTypes = [],
  ticketTypesError,
  onRetryTicketTypes,
  onSearchChange,
  onStatusFilterChange,
  onTicketTypeFilterChange,
  onRsvpStatusFilterChange,
  sortBy,
  sortDir,
  onSortChange,
  onViewAttendee,
  onRevokePass,
  onRestorePass,
  passActionBusyIds = new Set(),
  onPageChange,
  onPageSizeChange,
  selectedIds,
  onToggleRow,
  onToggleSelectAll,
  onClearSelection,
  onBulkSendTickets,
  bulkSendBusy,
  canBulkSend,
  eventTimezone,
  event,
}: AttendeesTableProps) {
  const isDesktop = useIsDesktop();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

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
        event={event}
        passActionBusyIds={passActionBusyIds}
        onRevokePass={onRevokePass}
        onRestorePass={onRestorePass}
      />
      <div className="attendees-table-foot">
        <span>{footSummary(loading, items, total, from, to)}</span>
        <div className="attendees-table-foot__pager">
          <div className="attendees-table-foot__pagesize">
            <label htmlFor="attendees-rows-per-page">Rows per page</label>
            <select
              id="attendees-rows-per-page"
              className="at-select attendees-table-foot__pagesize-select"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
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
