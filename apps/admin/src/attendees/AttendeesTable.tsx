import { Button, Card, Input, Select, StatusBadge } from "@admitto/ui";
import type { AttendeeRowDto } from "../api/types.js";
import { TicketTypeBadge } from "./ticketTypeBadge.js";

export interface AttendeesTableProps {
  items: AttendeeRowDto[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  emptyMessage: string;
  searchInput: string;
  statusFilter: "all" | "admitted" | "not_admitted";
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: "all" | "admitted" | "not_admitted") => void;
  onRowClick: (id: string) => void;
  onPageChange: (page: number) => void;
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
  onSearchChange,
  onStatusFilterChange,
  onRowClick,
  onPageChange,
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
      </div>
      {loading && items.length === 0 ? (
        <p className="attendees-empty">Loading attendees…</p>
      ) : items.length === 0 ? (
        <div className="attendees-empty">
          <p>{emptyMessage}</p>
        </div>
      ) : (
        <div className="attendees-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Type</th>
                <th>Check-in</th>
                <th>Last mail</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button
                      type="button"
                      className="attendees-row-btn"
                      onClick={() => onRowClick(row.id)}
                    >
                      {row.name}
                    </button>
                  </td>
                  <td>{row.email}</td>
                  <td>{row.company ?? "—"}</td>
                  <td>
                    <TicketTypeBadge ticketType={row.ticket_type} />
                  </td>
                  <td>
                    <StatusBadge status={row.check_in_status} />
                  </td>
                  <td>
                    {row.last_mail_status ? (
                      <StatusBadge status={row.last_mail_status} />
                    ) : (
                      <span className="attendee-readonly">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="attendees-table-foot">
        <span>
          {total === 0 ? "0 attendees" : `Showing ${from}–${to} of ${total}`}
        </span>
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
