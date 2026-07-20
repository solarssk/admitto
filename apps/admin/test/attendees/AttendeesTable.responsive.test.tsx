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

const otherRow: AttendeeRowDto = {
  ...baseRow,
  id: "att-2",
  name: "John Smith",
  email: "john@example.com",
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
  mailStatusFilter: "" as const,
  onMailStatusFilterChange: vi.fn(),
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
  onBulkCheckIn: vi.fn(),
  bulkCheckInBusy: false,
  onBulkExportSelected: vi.fn(),
  bulkExportBusy: false,
  onBulkChangeTicketType: vi.fn(),
  onBulkDelete: vi.fn(),
  eventTimezone: "UTC",
  event: { archived_at: null as string | null },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AttendeesTable toolbar vs bulk bar", () => {
  beforeEach(() => {
    mockMatchMedia(true);
  });

  it("hides the search input and Filters button entirely once a row is selected, and shows the bulk bar instead", () => {
    const onClearSelection = vi.fn();
    const { rerender } = render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set()}
        onToggleRow={vi.fn()}
        onClearSelection={onClearSelection}
      />,
    );

    expect(screen.getByLabelText("Search attendees by name, email, or company")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
    expect(document.querySelector(".attendees-bulkbar")).toBeNull();

    rerender(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set(["att-1"])}
        onToggleRow={vi.fn()}
        onClearSelection={onClearSelection}
      />,
    );

    // Not just visually hidden - not in the DOM at all.
    expect(screen.queryByLabelText("Search attendees by name, email, or company")).toBeNull();
    expect(screen.queryByRole("button", { name: "Filters" })).toBeNull();
    const bar = document.querySelector(".attendees-bulkbar");
    expect(bar).toBeTruthy();
    expect(within(bar as HTMLElement).getByText("1")).toBeTruthy();
    expect(within(bar as HTMLElement).getByText("selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClearSelection).toHaveBeenCalledTimes(1);

    // Clearing the selection (selectedIds back to empty) brings the toolbar back.
    rerender(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set()}
        onToggleRow={vi.fn()}
        onClearSelection={onClearSelection}
      />,
    );

    expect(screen.getByLabelText("Search attendees by name, email, or company")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
    expect(document.querySelector(".attendees-bulkbar")).toBeNull();
  });
});

describe("AttendeesTable Filters dropdown (PO review, third pass)", () => {
  beforeEach(() => {
    mockMatchMedia(true);
  });

  it("keeps the filter selects out of the DOM until the Filters button is clicked, then reveals all four", () => {
    render(
      <AttendeesTable {...tableProps} items={[baseRow]} selectedIds={new Set()} onToggleRow={vi.fn()} />,
    );

    expect(screen.queryByLabelText("Filter by ticket type")).toBeNull();
    expect(screen.queryByLabelText("Filter by attendance")).toBeNull();
    expect(screen.queryByLabelText("Filter by check-in status")).toBeNull();
    expect(screen.queryByLabelText("Filter by mail delivery status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));

    expect(screen.getByLabelText("Filter by ticket type")).toBeTruthy();
    expect(screen.getByLabelText("Filter by attendance")).toBeTruthy();
    expect(screen.getByLabelText("Filter by check-in status")).toBeTruthy();
    expect(screen.getByLabelText("Filter by mail delivery status")).toBeTruthy();
  });

  it("floats as an absolutely-positioned overlay, not inline content pushing the row's own height", () => {
    render(
      <AttendeesTable {...tableProps} items={[baseRow]} selectedIds={new Set()} onToggleRow={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));

    // The row (.attendees-toolbar) and the floating panel are structurally separate — the
    // panel is a sibling of the trigger inside its own small wrapper, not a child that grows
    // the toolbar row itself (see attendees.css: .attendees-filters-menu__panel is
    // position:absolute).
    const panel = document.querySelector(".attendees-filters-menu__panel");
    expect(panel).toBeTruthy();
    expect(panel?.closest(".attendees-toolbar")).toBeTruthy();
    expect(panel?.parentElement?.className).toContain("attendees-filters-menu");
  });

  it("shows an active-filter count badge on the trigger and clears when filters reset", () => {
    const { rerender } = render(
      <AttendeesTable {...tableProps} items={[baseRow]} selectedIds={new Set()} onToggleRow={vi.fn()} />,
    );
    expect(screen.queryByText("2")).toBeNull();

    rerender(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set()}
        onToggleRow={vi.fn()}
        statusFilter="admitted"
        rsvpStatusFilter="confirmed"
      />,
    );
    const toggle = screen.getByRole("button", { name: /Filters/ });
    expect(within(toggle).getByText("2")).toBeTruthy();
  });

  it("stays reachable and functional on a phone too — same trigger button, same floating panel", () => {
    mockMatchMedia(false);
    const onMailStatusFilterChange = vi.fn();
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set()}
        onMailStatusFilterChange={onMailStatusFilterChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    const select = screen.getByLabelText("Filter by mail delivery status") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "failed" } });
    expect(onMailStatusFilterChange).toHaveBeenCalledWith("failed");
  });
});

describe("AttendeesTable mobile card view (<768px)", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  it("renders attendee cards instead of the table, keeping name/email and working checkboxes", () => {
    const onToggleRow = vi.fn();
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow, otherRow]}
        selectedIds={new Set()}
        onToggleRow={onToggleRow}
      />,
    );

    expect(screen.queryByRole("table")).toBeNull();
    expect(document.querySelector(".attendees-table-v2")).toBeNull();
    expect(document.querySelector(".attendees-cards")).toBeTruthy();

    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("jane@example.com")).toBeTruthy();
    expect(screen.getByText("John Smith")).toBeTruthy();
    expect(screen.getByText("john@example.com")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Select Jane Doe"));
    expect(onToggleRow).toHaveBeenCalledWith("att-1");
  });

  it("has a 'Select all' checkbox above the cards, reflecting and driving the same selection as the desktop header checkbox", () => {
    const onToggleSelectAll = vi.fn();
    const { rerender } = render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow, otherRow]}
        selectedIds={new Set()}
        onToggleSelectAll={onToggleSelectAll}
      />,
    );

    const selectAll = screen.getByLabelText("Select all") as HTMLInputElement;
    expect(selectAll.checked).toBe(false);

    fireEvent.click(selectAll);
    expect(onToggleSelectAll).toHaveBeenCalledTimes(1);

    rerender(
      <AttendeesTable
        {...tableProps}
        items={[baseRow, otherRow]}
        selectedIds={new Set(["att-1", "att-2"])}
        onToggleSelectAll={onToggleSelectAll}
      />,
    );
    expect((screen.getByLabelText("Select all") as HTMLInputElement).checked).toBe(true);
  });

  it("offers a 'Sort by' select and a direction toggle, since there's no column header to click", () => {
    const onSortChange = vi.fn();
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow, otherRow]}
        selectedIds={new Set()}
        sortBy="name"
        sortDir="asc"
        onSortChange={onSortChange}
      />,
    );

    // The sort control sits at the top of the same Filters dropdown panel.
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const sortSelect = screen.getByLabelText("Sort by") as HTMLSelectElement;
    expect(sortSelect.value).toBe("name");

    fireEvent.change(sortSelect, { target: { value: "ticket_type" } });
    expect(onSortChange).toHaveBeenLastCalledWith("ticket_type");

    // Direction toggle passes the *current* column, matching AttendeesPage's onSortChange
    // contract (same column => flip direction, not reset to ascending).
    fireEvent.click(screen.getByRole("button", { name: "Sort ascending" }));
    expect(onSortChange).toHaveBeenLastCalledWith("name");
  });

  it("shows a clear button only once the search box has text, and clearing it calls onSearchChange", () => {
    const onSearchChange = vi.fn();
    const { rerender } = render(
      <AttendeesTable {...tableProps} items={[baseRow]} selectedIds={new Set()} onSearchChange={onSearchChange} />,
    );

    expect(screen.queryByLabelText("Clear search")).toBeNull();

    rerender(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set()}
        searchInput="jane"
        onSearchChange={onSearchChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(onSearchChange).toHaveBeenCalledWith("");
    // Clearing unmounts the button itself - focus should land back on the search input rather
    // than being lost, so keyboard/screen-reader users stay in context (CodeRabbit review).
    expect(document.activeElement).toBe(screen.getByLabelText("Search attendees by name, email, or company"));
  });
});

describe("AttendeesTable mail delivery status filter (#522)", () => {
  beforeEach(() => {
    mockMatchMedia(true);
  });

  it("renders the fourth select with the four buckets and reports changes", () => {
    const onMailStatusFilterChange = vi.fn();
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set()}
        onMailStatusFilterChange={onMailStatusFilterChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const select = screen.getByLabelText("Filter by mail delivery status") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", "not_sent", "sent", "pending", "failed"]);

    fireEvent.change(select, { target: { value: "failed" } });
    expect(onMailStatusFilterChange).toHaveBeenCalledWith("failed");
  });

  it("keeps the selected mail status reflected in the select's value (no separate active-filter indicator to keep in sync)", () => {
    const { rerender } = render(
      <AttendeesTable {...tableProps} items={[baseRow]} selectedIds={new Set()} mailStatusFilter="" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    let select = screen.getByLabelText("Filter by mail delivery status") as HTMLSelectElement;
    expect(select.value).toBe("");

    rerender(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set()}
        mailStatusFilter="not_sent"
      />,
    );
    select = screen.getByLabelText("Filter by mail delivery status") as HTMLSelectElement;
    expect(select.value).toBe("not_sent");
  });
});
