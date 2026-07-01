// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendeesTable } from "../../src/attendees/AttendeesTable.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const baseRow: AttendeeRowDto = {
  id: "att-1",
  name: "Jane Doe",
  email: "jane@example.com",
  company: "Acme",
  department: null,
  ticket_type: "VIP",
  status: "registered",
  check_in_status: "not_admitted",
  admitted_at: null,
  updated_at: "2026-06-01T10:00:00.000Z",
  last_mail_status: "sent",
  rsvp_status: "confirmed",
};

const tableProps = {
  total: 1,
  page: 1,
  pageSize: 25,
  loading: false,
  emptyMessage: "No matches",
  searchInput: "",
  statusFilter: "all" as const,
  ticketTypeFilter: "",
  rsvpStatusFilter: "" as const,
  availableTypes: [] as string[],
  onSearchChange: vi.fn(),
  onStatusFilterChange: vi.fn(),
  onTicketTypeFilterChange: vi.fn(),
  onRsvpStatusFilterChange: vi.fn(),
  onViewAttendee: vi.fn(),
  onPageChange: vi.fn(),
  eventTimezone: "UTC",
};

afterEach(cleanup);

describe("AttendeesTable pass status actions", () => {
  it("shows revoke for registered attendees and calls onRevokePass", () => {
    const onRevokePass = vi.fn();
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        onRevokePass={onRevokePass}
        onRestorePass={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Revoke pass" }));
    expect(onRevokePass).toHaveBeenCalledWith(baseRow);
    expect(screen.queryByRole("button", { name: "Restore pass" })).toBeNull();
  });

  it("shows restore for revoked attendees and calls onRestorePass", () => {
    const onRestorePass = vi.fn();
    const revokedRow = { ...baseRow, status: "revoked" as const };
    render(
      <AttendeesTable
        {...tableProps}
        items={[revokedRow]}
        onRevokePass={vi.fn()}
        onRestorePass={onRestorePass}
      />,
    );

    expect(screen.getByText("Revoked")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore pass" }));
    expect(onRestorePass).toHaveBeenCalledWith(revokedRow);
    expect(screen.queryByRole("button", { name: "Revoke pass" })).toBeNull();
  });

  it("hides pass actions for cancelled attendees", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[{ ...baseRow, status: "cancelled" }]}
        onRevokePass={vi.fn()}
        onRestorePass={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Revoke pass" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore pass" })).toBeNull();
  });
});
