import { Badge, Button, Card, IconButton, Input, Select } from "@admitto/ui";
import type { AttendeeRowDto, RsvpStatus } from "../api/types.js";
import { MailStatusBadge } from "./mailStatusBadge.js";
import { RsvpStatusBadge } from "./rsvpStatusBadge.js";
import { TicketTypeBadge } from "./ticketTypeBadge.js";
import { formatEventTime } from "../utils/event-dates.js";

function formatCheckInTime(admittedAt: string | null, eventTimezone: string): string {
  if (!admittedAt) return "—";
  return formatEventTime(admittedAt, eventTimezone);
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
  availableTypes: string[];
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: "all" | "admitted" | "not_admitted") => void;
  onTicketTypeFilterChange: (value: string) => void;
  onRsvpStatusFilterChange: (value: "" | RsvpStatus) => void;
  onViewAttendee: (id: string) => void;
  onRevokePass?: (row: AttendeeRowDto) => void;
  onRestorePass?: (row: AttendeeRowDto) => void;
  passActionBusyIds?: ReadonlySet<string>;
  onPageChange: (page: number) => void;
  eventTimezone: string;
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
  availableTypes,
  onSearchChange,
  onStatusFilterChange,
  onTicketTypeFilterChange,
  onRsvpStatusFilterChange,
  onViewAttendee,
  onRevokePass,
  onRestorePass,
  passActionBusyIds = new Set(),
  onPageChange,
  eventTimezone,
}: AttendeesTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <Card padded={false}>
      <div className="attendees-toolbar">
        <div className="attendees-toolbar__search">
          <Input
            label="Search"
            placeholder="Name, email, or company"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            icon={<i className="ti ti-search" aria-hidden="true" />}
          />
        </div>
        <div className="attendees-toolbar__filter">
          <Select
            label="Check-in"
            value={statusFilter}
            onChange={(e) =>
              onStatusFilterChange(e.target.value as "all" | "admitted" | "not_admitted")
            }
          >
            <option value="all">All</option>
            <option value="admitted">Checked in</option>
            <option value="not_admitted">Not checked in</option>
          </Select>
        </div>
        <div className="attendees-toolbar__filter">
          <Select
            label="RSVP status"
            value={rsvpStatusFilter}
            onChange={(e) => onRsvpStatusFilterChange(e.target.value as "" | RsvpStatus)}
          >
            <option value="">All statuses</option>
            <option value="none">Registered</option>
            <option value="confirmed">Confirmed</option>
            <option value="declined">Declined</option>
            <option value="tentative">Tentative</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <div className="attendees-toolbar__filter">
          <Select
            label="Type"
            value={ticketTypeFilter}
            onChange={(e) => onTicketTypeFilterChange(e.target.value)}
          >
            <option value="">All types</option>
            {availableTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {loading && items.length === 0 ? (
        <p className="attendees-empty">Loading attendees…</p>
      ) : items.length === 0 ? (
        <div className="attendees-empty">
          <p>{emptyMessage}</p>
        </div>
      ) : (
        <div className="attendees-table-wrap">
          <table className="table attendees-table-v2">
            <thead>
              <tr>
                <th>Attendee</th>
                <th>Ticket</th>
                <th>Company</th>
                <th>Status</th>
                <th>Mail</th>
                <th>Check-in</th>
                <th className="attendees-table-v2__actions-col" aria-label="Actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="attendees-table-v2__row">
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
                    <TicketTypeBadge ticketType={row.ticket_type} />
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
                    <div className="attendees-table-v2__status">
                      <RsvpStatusBadge status={row.rsvp_status} />
                      {row.status === "revoked" ? (
                        <Badge variant="error">Revoked</Badge>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <MailStatusBadge status={row.last_mail_status} />
                  </td>
                  <td>
                    {row.admitted_at ? (
                      <span className="attendees-table-v2__checkin">✓ {formatCheckInTime(row.admitted_at, eventTimezone)}</span>
                    ) : (
                      <span className="attendee-readonly">—</span>
                    )}
                  </td>
                  <td className="attendees-table-v2__actions">
                    <IconButton
                      label="View attendee"
                      icon={<i className="ti ti-eye" aria-hidden="true" />}
                      onClick={() => onViewAttendee(row.id)}
                    />
                    {row.status === "revoked" && onRestorePass ? (
                      <IconButton
                        label="Restore pass"
                        icon={<i className="ti ti-refresh" aria-hidden="true" />}
                        disabled={passActionBusyIds.has(row.id)}
                        onClick={() => onRestorePass(row)}
                      />
                    ) : null}
                    {row.status !== "cancelled" && row.status !== "revoked" && onRevokePass ? (
                      <IconButton
                        label="Revoke pass"
                        icon={<i className="ti ti-ban" aria-hidden="true" />}
                        disabled={passActionBusyIds.has(row.id)}
                        onClick={() => onRevokePass(row)}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="attendees-table-foot">
        <span>{total === 0 ? "0 attendees" : `Showing ${from}–${to} of ${total}`}</span>
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
