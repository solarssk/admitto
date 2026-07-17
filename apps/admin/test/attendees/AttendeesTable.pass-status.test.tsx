// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttendeesTable } from "../../src/attendees/AttendeesTable.js";
import { mockMatchMedia } from "../test-utils.js";
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
  hasLoadedOnce: true,
  isUnfilteredEmpty: false,
  searchInput: "",
  statusFilter: "all" as const,
  ticketTypeFilter: "",
  rsvpStatusFilter: "" as const,
  availableTypes: [] as string[],
  onSearchChange: vi.fn(),
  onStatusFilterChange: vi.fn(),
  onTicketTypeFilterChange: vi.fn(),
  onRsvpStatusFilterChange: vi.fn(),
  sortBy: "name" as const,
  sortDir: "asc" as const,
  onSortChange: vi.fn(),
  onViewAttendee: vi.fn(),
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  selectedIds: new Set<string>(),
  onToggleRow: vi.fn(),
  onToggleSelectAll: vi.fn(),
  onClearSelection: vi.fn(),
  onBulkSendTickets: vi.fn(),
  bulkSendBusy: false,
  canBulkSend: true,
  eventTimezone: "UTC",
  event: { archived_at: null as string | null },
};

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

describe("AttendeesTable check-in column (#359), two stacked lines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "Today" on its own line above the time when the admission was today', () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[{ ...baseRow, admitted_at: "2026-06-15T09:44:00.000Z" }]}
      />,
    );

    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText(/09:44/)).toBeTruthy();
  });

  it('shows "Yesterday" when the admission was the day before, in the event timezone', () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[{ ...baseRow, admitted_at: "2026-06-14T09:44:00.000Z" }]}
      />,
    );

    expect(screen.getByText("Yesterday")).toBeTruthy();
  });

  it("shows the full date above the time for anything older than yesterday", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[{ ...baseRow, admitted_at: "2026-05-15T09:44:00.000Z" }]}
      />,
    );

    expect(screen.getByText(/May 15, 2026/)).toBeTruthy();
    expect(screen.getByText(/09:44/)).toBeTruthy();
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

  it("shows a neutral Loading… footer instead of falsely claiming 0 attendees while re-fetching", () => {
    render(<AttendeesTable {...tableProps} loading items={[]} total={0} />);

    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("0 attendees")).toBeNull();
  });

  it("shows the shimmer skeleton only on the very first load, not a later filter landing on zero matches", () => {
    const { container, rerender } = render(
      <AttendeesTable {...tableProps} hasLoadedOnce={false} loading items={[]} total={0} />,
    );
    expect(container.querySelector("table[aria-hidden='true']")).toBeTruthy();
    expect(screen.queryByText("No matches")).toBeNull();

    // Once the first load has settled, a later filter/search landing on zero matches dims
    // the empty state in place instead of flashing the skeleton again.
    rerender(<AttendeesTable {...tableProps} hasLoadedOnce loading items={[]} total={0} />);
    expect(container.querySelector("table[aria-hidden='true']")).toBeNull();
    expect(screen.getByText("No matches")).toBeTruthy();
  });
});

describe("AttendeesTable empty states", () => {
  it("shows an icon+text placeholder for a truly empty event", () => {
    render(<AttendeesTable {...tableProps} isUnfilteredEmpty items={[]} total={0} />);

    expect(screen.getByText("No attendees yet")).toBeTruthy();
    expect(
      screen.getByText("Import a CSV or XLSX file, or add attendees one at a time."),
    ).toBeTruthy();
  });

  it("shows a different icon+text placeholder when a search/filter matches nothing", () => {
    render(<AttendeesTable {...tableProps} isUnfilteredEmpty={false} items={[]} total={0} />);

    expect(screen.getByText("No matches")).toBeTruthy();
    expect(screen.getByText("Try a different search, or clear your filters.")).toBeTruthy();
    expect(screen.queryByText("No attendees yet")).toBeNull();
  });
});
