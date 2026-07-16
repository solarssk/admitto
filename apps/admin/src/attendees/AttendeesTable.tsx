import { useState } from "react";
import { Button, Card, Checkbox, IconButton, Input, Select, Skeleton } from "@admitto/ui";
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
    <div className="attendees-table-wrap" aria-busy="true">
      <span className="sr-only">Loading attendees…</span>
      <table className="table attendees-table-v2" aria-hidden="true">
        <thead>
          <tr>
            <th className="attendees-table-v2__checkbox-col" aria-label="Select" />
            <th>Attendee</th>
            <th>Company</th>
            <th>Ticket</th>
            <th>Pass status</th>
            <th>RSVP status</th>
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
  { column: "rsvp_status", label: "RSVP status" },
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
}: {
  column: AttendeeSortBy;
  label: string;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
}) {
  const active = sortBy === column;
  return (
    <th aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`attendees-table-v2__sort-btn${active ? " attendees-table-v2__sort-btn--active" : ""}`}
        onClick={() => onSortChange(column)}
      >
        {label}
        <i
          className={`ti ${active ? (sortDir === "asc" ? "ti-arrow-up" : "ti-arrow-down") : "ti-arrows-sort"}`}
          aria-hidden="true"
        />
      </button>
    </th>
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
}: {
  row: AttendeeRowDto;
  event: ArchivedGuardEvent;
  reasonIdSuffix: string;
  passActionBusyIds: ReadonlySet<string>;
  onRevokePass?: (row: AttendeeRowDto) => void;
  onRestorePass?: (row: AttendeeRowDto) => void;
}) {
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
}: {
  admittedAt: string | null;
  eventTimezone: string;
}) {
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
  emptyMessage: string;
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
}: AttendeeCardProps) {
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

export function AttendeesTable({
  items,
  total,
  page,
  pageSize,
  loading,
  emptyMessage,
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) + (rsvpStatusFilter !== "" ? 1 : 0) + (ticketTypeFilter !== "" ? 1 : 0);

  return (
    <Card padded={false}>
      {selectedIds.size > 0 ? (
        // Same slot the search/filter toolbar occupies below — selecting rows swaps into this
        // bar instead of adding a strip above it, so the card never grows taller just because
        // something is selected.
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
      ) : (
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
            {activeFilterCount > 0 && (
              <span className="attendees-filters-toggle__count">{activeFilterCount}</span>
            )}
            <i className={`ti ti-chevron-${filtersOpen ? "up" : "down"}`} aria-hidden="true" />
          </button>
          <div className={`attendees-filters${filtersOpen ? " attendees-filters--open" : ""}`}>
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
                aria-label="Filter by RSVP status"
                value={rsvpStatusFilter}
                onChange={(e) => onRsvpStatusFilterChange(e.target.value as "" | RsvpStatus)}
              >
                <option value="">All RSVP statuses</option>
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
                onChange={(e) =>
                  onStatusFilterChange(e.target.value as "all" | "admitted" | "not_admitted")
                }
              >
                <option value="all">All check-ins</option>
                <option value="admitted">Checked in</option>
                <option value="not_admitted">Not checked in</option>
              </Select>
            </div>
          </div>
        </div>
      )}
      {loading && items.length === 0 ? (
        isDesktop ? (
          <AttendeesTableSkeleton />
        ) : (
          <AttendeesCardsSkeleton />
        )
      ) : items.length === 0 ? (
        <div className="attendees-empty">
          <p>{emptyMessage}</p>
        </div>
      ) : isDesktop ? (
        <div
          className={`attendees-table-wrap${loading ? " attendees-table-wrap--loading" : ""}`}
          aria-busy={loading}
        >
          <table className="table attendees-table-v2">
            <thead>
              <tr>
                <th className="attendees-table-v2__checkbox-col">
                  <Checkbox
                    checked={items.length > 0 && items.every((row) => selectedIds.has(row.id))}
                    onChange={onToggleSelectAll}
                    aria-label="Select all"
                  />
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
      ) : (
        <div
          className={`attendees-cards${loading ? " attendees-table-wrap--loading" : ""}`}
          aria-busy={loading}
        >
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
      )}
      <div className="attendees-table-foot">
        <span>
          {loading && items.length === 0
            ? "Loading…"
            : total === 0
              ? "0 attendees"
              : `Showing ${from}–${to} of ${total}`}
        </span>
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
