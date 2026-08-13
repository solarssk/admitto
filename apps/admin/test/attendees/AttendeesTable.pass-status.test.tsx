// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
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
  has_issued_items: false,
  wallet_status: null,
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
  vi.useRealTimers();
});

describe("AttendeesTable pass status badge", () => {
  it("shows Confirmed pass status (#352/#366 split columns)", () => {
    render(<AttendeesTable {...tableProps} items={[{ ...baseRow, status: "confirmed" }]} />);

    // rsvp_status and status are both "confirmed" on baseRow but render in separate
    // columns (#366) — two independent "Confirmed" badges, not a single shared one.
    expect(within(screen.getByRole("table")).getAllByText("Confirmed")).toHaveLength(2);
  });

  it("shows Cancelled pass status", () => {
    render(<AttendeesTable {...tableProps} items={[{ ...baseRow, status: "cancelled" }]} />);

    expect(within(screen.getByRole("table")).getByText("Cancelled")).toBeTruthy();
  });
});

describe("AttendeesTable Wallet column", () => {
  it("shows both platform icons muted for an attendee with no WalletPass row", () => {
    render(<AttendeesTable {...tableProps} items={[baseRow]} />);

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Wallet")).toBeTruthy();
    expect(screen.getByLabelText("Apple Wallet: Not added")).toBeTruthy();
    expect(screen.getByLabelText("Google Wallet: Not added")).toBeTruthy();
  });

  it("shows a highlighted platform icon once the attendee has registered a device", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[
          {
            ...baseRow,
            wallet_status: {
              apple_active_registrations: 0,
              apple_inactive_registrations: 0,
              google_active_registrations: 1,
              google_inactive_registrations: 0,
            },
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Google Wallet: Registered")).toBeTruthy();
    expect(screen.getByLabelText("Apple Wallet: Not added")).toBeTruthy();
  });

  it("no longer renders the per-row view/revoke icon actions column", () => {
    render(<AttendeesTable {...tableProps} items={[baseRow]} />);

    expect(screen.queryByRole("button", { name: "View attendee" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke pass" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore pass" })).toBeNull();
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
    // useDelayedLoading only shows the text once the fetch has stayed pending past its
    // 200ms grace window (avoids flashing it for a near-instant response) — fake timers
    // must be installed before render so the hook's setTimeout is one of ours.
    vi.useFakeTimers();
    render(<AttendeesTable {...tableProps} loading items={[]} total={0} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("0 attendees")).toBeNull();
  });

  it("never claims '0 attendees' during the no-flash grace window of the very first load, even before Loading… itself appears", () => {
    // Regression test: footSummary must gate on the raw first-load condition, not the
    // delayed flag alone — otherwise, for the first ~200ms of every single page load
    // (fast or slow), "total" is still its pre-fetch default (0) and the footer would
    // wrongly read "0 attendees" instead of showing nothing until Loading… is warranted.
    vi.useFakeTimers();
    render(
      <AttendeesTable {...tableProps} hasLoadedOnce={false} loading items={[]} total={0} />,
    );
    // Deliberately NOT advancing timers past 200ms — this is the pre-delay window.
    expect(screen.queryByText("0 attendees")).toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("shows the shimmer skeleton only on the very first load, not a later filter landing on zero matches", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <AttendeesTable {...tableProps} hasLoadedOnce={false} loading items={[]} total={0} />,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
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
