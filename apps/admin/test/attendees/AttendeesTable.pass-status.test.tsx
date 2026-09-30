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
  ticketTypeFilter: [],
  rsvpStatusFilter: [],
  mailStatusFilter: [],
  availableTypes: [] as string[],
  onSearchChange: vi.fn(),
  onStatusFilterChange: vi.fn(),
  onTicketTypeFilterChange: vi.fn(),
  onRsvpStatusFilterChange: vi.fn(),
  onMailStatusFilterChange: vi.fn(),
  customFieldSelectValues: {},
  onCustomFieldSelectChange: vi.fn(),
  customFieldTextInputs: {},
  onCustomFieldTextInputChange: vi.fn(),
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
  eventId: "evt-1",
  event: { archived_at: null as string | null },
  walletPlatforms: { apple: true, google: true, samsung: false, any: true },
  walletConfigured: true,
};

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe("AttendeesTable pass status badge", () => {
  it("shows Confirmed pass status (#352/#366 split columns)", () => {
    render(<AttendeesTable {...tableProps} items={[{ ...baseRow, status: "confirmed" }]} />);

    // rsvp_status and status are both "confirmed" on baseRow but render in separate
    // columns (#366) - two independent "Confirmed" badges, not a single shared one.
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

  it("omits the whole Wallet column (header and cells) when no wallet platform is enabled", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        walletPlatforms={{ apple: false, google: false, samsung: false, any: false }}
      />,
    );

    const table = within(screen.getByRole("table"));
    expect(table.queryByText("Wallet")).toBeNull();
    expect(screen.queryByLabelText(/Apple Wallet:/)).toBeNull();
    expect(screen.queryByLabelText(/Google Wallet:/)).toBeNull();
  });

  it("shows only the enabled platform's icon when just one wallet platform is on", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        walletPlatforms={{ apple: true, google: false, samsung: false, any: true }}
      />,
    );

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Wallet")).toBeTruthy();
    expect(screen.getByLabelText("Apple Wallet: Not added")).toBeTruthy();
    expect(screen.queryByLabelText(/Google Wallet:/)).toBeNull();
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
  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks the existing rows and marks the table busy at once while re-fetching", () => {
    const { container } = render(
      <AttendeesTable {...tableProps} loading items={[baseRow]} />,
    );

    const wrap = container.querySelector(".attendees-table-wrap");
    expect(wrap?.classList.contains("attendees-table-wrap--loading")).toBe(true);
    expect(wrap?.getAttribute("aria-busy")).toBe("true");
    // Not dimmed yet, and no bar: a refetch that answers within 200ms never shows either.
    expect(wrap?.classList.contains("attendees-table-wrap--dim")).toBe(false);
    expect(screen.queryByRole("status", { name: "Refreshing attendees" })).toBeNull();
  });

  it("dims the rows and runs a bar along the list once the re-fetch has taken 200ms", () => {
    vi.useFakeTimers();
    const { container } = render(<AttendeesTable {...tableProps} loading items={[baseRow]} />);
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(container.querySelector(".attendees-table-wrap--dim")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector(".attendees-table-wrap--dim")).not.toBeNull();
    const bar = screen.getByRole("status", { name: "Refreshing attendees" });
    expect(bar.className).toContain("at-topbar--container");
    // The bar rides the top edge of the list region, which is the positioned ancestor.
    expect(bar.parentElement?.classList.contains("attendees-list-region")).toBe(true);
  });

  it("does not dim the rows once loading finishes", () => {
    const { container } = render(
      <AttendeesTable {...tableProps} loading={false} items={[baseRow]} />,
    );

    const wrap = container.querySelector(".attendees-table-wrap");
    expect(wrap?.classList.contains("attendees-table-wrap--loading")).toBe(false);
    expect(wrap?.classList.contains("attendees-table-wrap--dim")).toBe(false);
    expect(wrap?.getAttribute("aria-busy")).toBe("false");
  });

  it("keeps the footer empty instead of claiming 0 attendees while loading with nothing on screen", () => {
    // The list above already shows the skeleton then, so the footer neither repeats it as text nor
    // reads "0 attendees" against a total that has not been set from a real response yet.
    vi.useFakeTimers();
    render(<AttendeesTable {...tableProps} loading items={[]} total={0} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.queryByText("0 attendees")).toBeNull();
  });

  it("never claims '0 attendees' during the very first load, however long the wait has been", () => {
    // Regression test: footSummary must gate on the raw first-load condition - otherwise, for as
    // long as the fetch is in flight, "total" is still its pre-fetch default (0) and the footer
    // would wrongly read "0 attendees" instead of showing nothing.
    vi.useFakeTimers();
    render(
      <AttendeesTable {...tableProps} hasLoadedOnce={false} loading items={[]} total={0} />,
    );
    expect(screen.queryByText("0 attendees")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByText("0 attendees")).toBeNull();
  });

  it("holds the skeleton's space invisibly for 200ms, then fades it in", () => {
    vi.useFakeTimers();
    const { container } = render(
      <AttendeesTable {...tableProps} hasLoadedOnce={false} loading items={[]} total={0} />,
    );
    const holder = () => container.querySelector("table[aria-hidden='true']")?.closest("[class*='at-']");
    expect(holder()?.className).toContain("at-loading-hold");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(holder()?.className).toContain("at-fade-in");
    expect(holder()?.className).not.toContain("at-loading-hold");
  });

  it("never shows the skeleton for a first load that answers within 200ms", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <AttendeesTable {...tableProps} hasLoadedOnce={false} loading items={[]} total={0} />,
    );
    act(() => {
      vi.advanceTimersByTime(150);
    });
    rerender(<AttendeesTable {...tableProps} hasLoadedOnce loading={false} items={[baseRow]} total={1} />);
    expect(container.querySelector("table[aria-hidden='true']")).toBeNull();
    expect(container.querySelector(".attendees-list-region")?.className).toContain("at-fade-in");
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("keeps a skeleton that did appear for at least 400ms before the rows replace it", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <AttendeesTable {...tableProps} hasLoadedOnce={false} loading items={[]} total={0} />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
    });
    rerender(<AttendeesTable {...tableProps} hasLoadedOnce loading={false} items={[baseRow]} total={1} />);
    // The skeleton has been up for 0ms of its 400ms minimum.
    expect(container.querySelector("table[aria-hidden='true']")).not.toBeNull();
    expect(screen.queryByText(baseRow.name)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(container.querySelector("table[aria-hidden='true']")).toBeNull();
    expect(screen.getByText(baseRow.name)).toBeTruthy();
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

    // The first load has settled; the skeleton leaves after its 400ms minimum.
    rerender(<AttendeesTable {...tableProps} hasLoadedOnce loading={false} items={[]} total={0} />);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(container.querySelector("table[aria-hidden='true']")).toBeNull();
    expect(screen.getByText("No matches")).toBeTruthy();

    // A later filter/search landing on zero matches dims the empty state in place instead of
    // flashing the skeleton again.
    rerender(<AttendeesTable {...tableProps} hasLoadedOnce loading items={[]} total={0} />);
    expect(container.querySelector("table[aria-hidden='true']")).toBeNull();
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  describe("skeleton size", () => {
    const skeletonRows = (container: HTMLElement) =>
      container.querySelectorAll("table[aria-hidden='true'] tbody tr").length;
    const renderFirstLoad = () =>
      render(<AttendeesTable {...tableProps} hasLoadedOnce={false} loading items={[]} total={0} />);

    it("draws the default number of rows when it does not know the list's size", () => {
      expect(skeletonRows(renderFirstLoad().container)).toBe(6);
    });

    it("draws as many rows as this event's list had last time", () => {
      localStorage.setItem("admitto_attendees_rows_evt-1", "3");
      expect(skeletonRows(renderFirstLoad().container)).toBe(3);
    });

    it("does not use another event's size", () => {
      localStorage.setItem("admitto_attendees_rows_evt-2", "3");
      expect(skeletonRows(renderFirstLoad().container)).toBe(6);
    });

    it("never draws fewer than one row, nor more than fifty", () => {
      localStorage.setItem("admitto_attendees_rows_evt-1", "0");
      expect(skeletonRows(renderFirstLoad().container)).toBe(1);
      cleanup();
      localStorage.setItem("admitto_attendees_rows_evt-1", "500");
      expect(skeletonRows(renderFirstLoad().container)).toBe(50);
    });

    it("ignores a remembered value that is not a number", () => {
      localStorage.setItem("admitto_attendees_rows_evt-1", "many");
      expect(skeletonRows(renderFirstLoad().container)).toBe(6);
    });

    it("sizes the mobile card skeleton the same way", () => {
      mockMatchMedia(false);
      localStorage.setItem("admitto_attendees_rows_evt-1", "2");
      const { container } = renderFirstLoad();
      expect(container.querySelectorAll(".attendees-cards .attendees-card")).toHaveLength(2);
    });

    it("remembers how many rows a finished load showed", () => {
      render(<AttendeesTable {...tableProps} loading={false} items={[baseRow, { ...baseRow, id: "att-2" }]} />);
      expect(localStorage.getItem("admitto_attendees_rows_evt-1")).toBe("2");
    });

    it("remembers nothing while the first load is still running", () => {
      renderFirstLoad();
      expect(localStorage.getItem("admitto_attendees_rows_evt-1")).toBeNull();
    });

    it("keeps working when the browser refuses storage", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("denied");
      });
      const { container } = renderFirstLoad();
      expect(skeletonRows(container)).toBe(6);
      cleanup();
      expect(() =>
        render(<AttendeesTable {...tableProps} loading={false} items={[baseRow]} />),
      ).not.toThrow();
      vi.restoreAllMocks();
    });
  });

  it("omits the Wallet column from the shimmer skeleton too when no wallet platform is enabled", () => {
    vi.useFakeTimers();
    const { container } = render(
      <AttendeesTable
        {...tableProps}
        walletPlatforms={{ apple: false, google: false, any: false }}
        hasLoadedOnce={false}
        loading
        items={[]}
        total={0}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const table = container.querySelector("table[aria-hidden='true']") as HTMLElement;
    expect(table).toBeTruthy();
    expect(within(table).queryByText("Wallet")).toBeNull();
    expect(table.querySelector("td[colspan='8']")).toBeTruthy();
    expect(table.querySelector("td[colspan='9']")).toBeNull();
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
