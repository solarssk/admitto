// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  eventDate: "2026-06-01T12:00:00.000Z" as string | null,
  event: { archived_at: null as string | null },
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

  it("disables Restore/Revoke pass when the event is archived", () => {
    render(
      <AttendeesTable
        {...tableProps}
        event={{ archived_at: "2026-07-01T00:00:00.000Z" }}
        items={[baseRow]}
        onRevokePass={vi.fn()}
        onRestorePass={vi.fn()}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "Revoke pass" }) as HTMLButtonElement).disabled,
    ).toBe(true);
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

    expect(within(screen.getByRole("table")).getByText("Cancelled")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revoke pass" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore pass" })).toBeNull();
  });

  it("shows Confirmed pass status with Revoke pass still available (#352/#366 split columns)", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[{ ...baseRow, status: "confirmed" }]}
        onRevokePass={vi.fn()}
        onRestorePass={vi.fn()}
      />,
    );

    // rsvp_status and status are both "confirmed" on baseRow but render in separate
    // columns (#366) — two independent "Confirmed" badges, not a single shared one.
    expect(within(screen.getByRole("table")).getAllByText("Confirmed")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Revoke pass" })).toBeTruthy();
  });
});

describe("AttendeesTable check-in column (#359)", () => {
  it("shows time-only when the admission falls on the event's calendar day", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[{ ...baseRow, admitted_at: "2026-06-01T09:44:00.000Z" }]}
      />,
    );

    const timeNode = screen.getByText(/09:44/);
    expect(timeNode.textContent).not.toMatch(/Jun/);
  });

  it("shows date and time when the admission is outside the event's calendar day", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[{ ...baseRow, admitted_at: "2026-05-15T09:44:00.000Z" }]}
      />,
    );

    const timeNode = screen.getByText(/09:44/);
    expect(timeNode.textContent).toMatch(/May 15, 2026/);
  });
});

describe("AttendeesTable loading states (#271)", () => {
  it("dims the existing rows and marks the table busy while re-fetching", () => {
    const { container } = render(
      <AttendeesTable {...tableProps} loading items={[baseRow]} />,
    );

    const wrap = container.querySelector(".attendees-table-wrap");
    expect(wrap?.classList.contains("attendees-table-wrap--loading")).toBe(true);
    expect(wrap?.getAttribute("aria-busy")).toBe("true");
  });

  it("does not dim the rows once loading finishes", () => {
    const { container } = render(
      <AttendeesTable {...tableProps} loading={false} items={[baseRow]} />,
    );

    const wrap = container.querySelector(".attendees-table-wrap");
    expect(wrap?.classList.contains("attendees-table-wrap--loading")).toBe(false);
    expect(wrap?.getAttribute("aria-busy")).toBe("false");
  });

  it("shows a neutral Loading… footer instead of falsely claiming 0 attendees on first load", () => {
    render(<AttendeesTable {...tableProps} loading items={[]} total={0} />);

    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("0 attendees")).toBeNull();
  });
});
