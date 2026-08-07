// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttendeesTable } from "../../src/attendees/AttendeesTable.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";
import { getTooltipText, mockMatchMedia } from "../test-utils.js";
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
  has_issued_items: true,
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
  onBulkRevokeCheckIn: vi.fn(),
  bulkRevokeCheckInBusy: false,
  onBulkExportSelected: vi.fn(),
  bulkExportBusy: false,
  onBulkChangeTicketType: vi.fn(),
  itemCount: 1,
  onBulkRevokeItems: vi.fn(),
  bulkRevokeItemsBusy: false,
  onBulkRevokePass: vi.fn(),
  bulkRevokePassBusy: false,
  onBulkDelete: vi.fn(),
  eventTimezone: "UTC",
  event: { archived_at: null as string | null },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

describe("AttendeesTable bulk revoke check-in (PO review, #522 follow-up)", () => {
  beforeEach(() => {
    mockMatchMedia(true);
  });

  const admittedRow = { ...baseRow, check_in_status: "admitted" as const };

  it("disables Check in only once every selected attendee is already checked in", () => {
    const { rerender } = render(
      <AttendeesTable
        {...tableProps}
        items={[admittedRow, otherRow]}
        selectedIds={new Set(["att-1"])}
      />,
    );
    expect((screen.getByRole("button", { name: "Check in" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    // Mixed selection (one admitted, one not) - still real work to do, stays enabled.
    rerender(
      <AttendeesTable
        {...tableProps}
        items={[admittedRow, otherRow]}
        selectedIds={new Set(["att-1", "att-2"])}
      />,
    );
    expect((screen.getByRole("button", { name: "Check in" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("disables the Revoke check-in menu item when nothing in the selection is checked in, enables it otherwise", () => {
    const { rerender } = render(
      <AttendeesTable {...tableProps} items={[baseRow]} selectedIds={new Set(["att-1"])} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      (screen.getByRole("menuitem", { name: /Revoke check-in/ }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // Menu stays open across the rerender (same mounted component) - no need to reopen it.
    rerender(
      <AttendeesTable {...tableProps} items={[admittedRow]} selectedIds={new Set(["att-1"])} />,
    );
    expect(
      (screen.getByRole("menuitem", { name: /Revoke check-in/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("fires onBulkRevokeCheckIn and closes the menu when the item is clicked", () => {
    const onBulkRevokeCheckIn = vi.fn();
    render(
      <AttendeesTable
        {...tableProps}
        items={[admittedRow]}
        selectedIds={new Set(["att-1"])}
        onBulkRevokeCheckIn={onBulkRevokeCheckIn}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Revoke check-in/ }));

    expect(onBulkRevokeCheckIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: /Revoke check-in/ })).toBeNull();
  });

  it("shows 'Revoking check-in…' and disables the item while busy", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[admittedRow]}
        selectedIds={new Set(["att-1"])}
        bulkRevokeCheckInBusy
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const item = screen.getByRole("menuitem", { name: /Revoking check-in…/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });

  it("explains the archived reason on the Revoke check-in item's tooltip, not just the no-one-checked-in reason (code review)", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[admittedRow]}
        selectedIds={new Set(["att-1"])}
        event={{ archived_at: "2026-01-01T00:00:00.000Z" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(getTooltipText(screen.getByRole("menuitem", { name: /Revoke check-in/ }))).toBe(
      "This event is archived. Editing is disabled.",
    );
  });

  it("shows the accurate admitted count in the hint text for a mixed selection, not the raw selection size (PO review)", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[admittedRow, otherRow]}
        selectedIds={new Set(["att-1", "att-2"])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const item = screen.getByRole("menuitem", { name: /Revoke check-in/ });
    // 2 selected, but only 1 (admittedRow) is actually checked in - the hint should reflect
    // that, not the full selection size.
    expect(item.textContent).toContain("Undo check-in for 1 attendee");
    expect(item.textContent).not.toContain("2 attendee");
  });
});

describe("AttendeesTable bulk revoke items (#551)", () => {
  beforeEach(() => {
    mockMatchMedia(true);
  });

  it("is enabled for a non-empty selection when the event has configured items", () => {
    render(<AttendeesTable {...tableProps} items={[baseRow]} selectedIds={new Set(["att-1"])} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      (screen.getByRole("menuitem", { name: /Revoke items/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("disables with a 'no items configured' title when the event has no configured items", () => {
    render(
      <AttendeesTable {...tableProps} items={[baseRow]} selectedIds={new Set(["att-1"])} itemCount={0} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const item = screen.getByRole("menuitem", { name: /Revoke items/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(getTooltipText(item)).toContain("No items configured");
  });

  it("disables with the archived tooltip when the event is archived, even with configured items", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set(["att-1"])}
        event={{ archived_at: "2026-01-01T00:00:00.000Z" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const item = screen.getByRole("menuitem", { name: /Revoke items/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(getTooltipText(item)).toBe(ARCHIVED_ACTION_TOOLTIP);
  });

  it("disables the menu item when nothing in the selection has anything issued, even though the event has configured items (CodeRabbit review)", () => {
    const nothingIssuedRow = { ...baseRow, has_issued_items: false };
    render(
      <AttendeesTable {...tableProps} items={[nothingIssuedRow]} selectedIds={new Set(["att-1"])} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const item = screen.getByRole("menuitem", { name: /Revoke items/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(getTooltipText(item)).toBe("None of the selected attendees have anything issued.");
  });

  it("fires onBulkRevokeItems and closes the menu when the item is clicked", () => {
    const onBulkRevokeItems = vi.fn();
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set(["att-1"])}
        onBulkRevokeItems={onBulkRevokeItems}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Revoke items/ }));

    expect(onBulkRevokeItems).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: /Revoke items/ })).toBeNull();
  });

  it("shows 'Revoking items…' and disables the item while busy", () => {
    render(
      <AttendeesTable {...tableProps} items={[baseRow]} selectedIds={new Set(["att-1"])} bulkRevokeItemsBusy />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const item = screen.getByRole("menuitem", { name: /Revoking items…/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });

  it("reports how many of the selection actually have something issued, not the raw selection size (PO review)", () => {
    const nothingIssuedRow = { ...otherRow, has_issued_items: false };
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow, nothingIssuedRow]}
        selectedIds={new Set(["att-1", "att-2"])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const item = screen.getByRole("menuitem", { name: /Revoke items/ });
    expect(item.textContent).toContain("Reset all issued items for 1 attendee");
    expect(item.textContent).not.toContain("for 2 attendees");
  });

  it("excludes a blocked-pass attendee from the count even when they have something issued (CodeRabbit review)", () => {
    const blockedButIssuedRow = { ...otherRow, has_issued_items: true, status: "revoked" as const };
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow, blockedButIssuedRow]}
        selectedIds={new Set(["att-1", "att-2"])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const item = screen.getByRole("menuitem", { name: /Revoke items/ });
    // Both rows have has_issued_items: true, but the server's own isAdmittable guard would
    // refuse to reset the revoked attendee's items - the hint must not promise to affect them.
    expect(item.textContent).toContain("Reset all issued items for 1 attendee");
    expect(item.textContent).not.toContain("for 2 attendees");
  });
});

describe("AttendeesTable bulk revoke pass (PO review, #549)", () => {
  beforeEach(() => {
    mockMatchMedia(true);
  });

  const revokedRow = { ...baseRow, status: "revoked" as const };

  it("disables Revoke pass only once every selected attendee's pass is already revoked/cancelled", () => {
    const { rerender } = render(
      <AttendeesTable
        {...tableProps}
        items={[revokedRow, otherRow]}
        selectedIds={new Set(["att-1"])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      (screen.getByRole("menuitem", { name: /Revoke pass/ }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // Mixed selection (one revoked, one active) - still real work to do, stays enabled.
    // Menu stays open across the rerender (same mounted component) - no need to reopen it.
    rerender(
      <AttendeesTable
        {...tableProps}
        items={[revokedRow, otherRow]}
        selectedIds={new Set(["att-1", "att-2"])}
      />,
    );
    expect(
      (screen.getByRole("menuitem", { name: /Revoke pass/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("explains the no-op reason on the Revoke pass item's tooltip when disabled", () => {
    render(
      <AttendeesTable {...tableProps} items={[revokedRow]} selectedIds={new Set(["att-1"])} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(getTooltipText(screen.getByRole("menuitem", { name: /Revoke pass/ }))).toBe(
      "The selected attendees' passes are already revoked or cancelled.",
    );
  });

  it("disables with the archived tooltip when the event is archived, even with an active pass", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set(["att-1"])}
        event={{ archived_at: "2026-01-01T00:00:00.000Z" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const item = screen.getByRole("menuitem", { name: /Revoke pass/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(getTooltipText(item)).toBe("This event is archived. Editing is disabled.");
  });

  it("fires onBulkRevokePass and closes the menu when the item is clicked", () => {
    const onBulkRevokePass = vi.fn();
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set(["att-1"])}
        onBulkRevokePass={onBulkRevokePass}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Revoke pass/ }));

    expect(onBulkRevokePass).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: /Revoke pass/ })).toBeNull();
  });

  it("shows 'Revoking pass…' and disables the item while busy", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set(["att-1"])}
        bulkRevokePassBusy
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const item = screen.getByRole("menuitem", { name: /Revoking pass…/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });

  it("shows the accurate active-pass count in the hint, not the raw selection size, for a mixed selection", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[revokedRow, otherRow]}
        selectedIds={new Set(["att-1", "att-2"])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    // 2 selected, but only 1 (otherRow) still has an active pass - the hint must say "1
    // attendee", not "2 attendees" (PO review follow-up, #549).
    expect(
      screen.getByText("Block check-in for 1 attendee", { exact: false }),
    ).toBeTruthy();
    expect(screen.queryByText("Block check-in for 2 attendees", { exact: false })).toBeNull();
  });
});

describe("AttendeesTable mobile bulk bar — 'More' menu's Send tickets item", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  it("carries the archived tooltip when the event is archived", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set(["att-1"])}
        event={{ archived_at: "2026-01-01T00:00:00.000Z" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(getTooltipText(screen.getByRole("menuitem", { name: /Send tickets/ }))).toBe(
      "This event is archived. Editing is disabled.",
    );
  });

  it("carries the no-mail-transport tooltip when canBulkSend is false and the event isn't archived", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set(["att-1"])}
        canBulkSend={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(getTooltipText(screen.getByRole("menuitem", { name: /Send tickets/ }))).toBe(
      "No mail transport configured for this event. Set one up in Event Settings → Mailing.",
    );
  });

  it("shows 'Sending…' while busy and pluralizes the hint for more than one selected attendee", () => {
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow, otherRow]}
        selectedIds={new Set(["att-1", "att-2"])}
        bulkSendBusy
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const item = screen.getByRole("menuitem", { name: /Sending…/ });
    expect(item.textContent).toContain("Email tickets to 2 attendees");
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

    expect(screen.queryByRole("button", { name: /^Filter by ticket type,/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Filter by attendance,/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Filter by check-in status,/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Filter by mail delivery status,/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));

    expect(screen.getByRole("button", { name: /^Filter by ticket type,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Filter by attendance,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Filter by check-in status,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Filter by mail delivery status,/ })).toBeTruthy();
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
        ticketTypeFilter="vip"
      />,
    );
    const toggle = screen.getByRole("button", { name: /Filters/ });
    expect(within(toggle).getByText("3")).toBeTruthy();
  });

  it("exposes the panel as a native fieldset of controls, not a false menu, and moves focus into it on open (CodeRabbit + SonarCloud review)", () => {
    render(
      <AttendeesTable {...tableProps} items={[baseRow]} selectedIds={new Set()} onToggleRow={vi.fn()} />,
    );

    const trigger = screen.getByRole("button", { name: "Filters" });
    // No aria-haspopup at all - not even "true", which the ARIA spec treats as equivalent to
    // "menu". The panel holds native <select>s in a <fieldset>, not menuitems in a menu, so this
    // is a plain disclosure button and aria-expanded alone is the correct pattern (CodeRabbit
    // review on PR #587's FiltersMenu extraction).
    expect(trigger.getAttribute("aria-haspopup")).toBeNull();

    fireEvent.click(trigger);

    // A native <fieldset>/<legend>, not `role="group"` on a div (SonarCloud S6819).
    const panel = document.querySelector(".attendees-filters-menu__panel");
    expect(panel?.tagName).toBe("FIELDSET");
    expect(screen.getByText("Filters", { selector: "legend" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Filter by ticket type,/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /^Filter by mail delivery status,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    expect(onMailStatusFilterChange).toHaveBeenCalledWith("failed");

    fireEvent.click(screen.getByRole("button", { name: /^Filter by mail delivery status,/ }));
    fireEvent.click(screen.getByRole("button", { name: "All mail statuses" }));
    expect(onMailStatusFilterChange).toHaveBeenCalledWith("");
  });

  it("reports ticket type, attendance, and check-in status filter changes", () => {
    const onTicketTypeFilterChange = vi.fn();
    const onRsvpStatusFilterChange = vi.fn();
    const onStatusFilterChange = vi.fn();
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set()}
        ticketTypes={[{ key: "vip", label: "VIP" }]}
        onTicketTypeFilterChange={onTicketTypeFilterChange}
        onRsvpStatusFilterChange={onRsvpStatusFilterChange}
        onStatusFilterChange={onStatusFilterChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));

    fireEvent.click(screen.getByRole("button", { name: /^Filter by ticket type,/ }));
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    expect(onTicketTypeFilterChange).toHaveBeenCalledWith("vip");

    fireEvent.click(screen.getByRole("button", { name: /^Filter by ticket type,/ }));
    fireEvent.click(screen.getByRole("button", { name: "All ticket types" }));
    expect(onTicketTypeFilterChange).toHaveBeenCalledWith("");

    fireEvent.click(screen.getByRole("button", { name: /^Filter by attendance,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
    expect(onRsvpStatusFilterChange).toHaveBeenCalledWith("confirmed");

    fireEvent.click(screen.getByRole("button", { name: /^Filter by attendance,/ }));
    fireEvent.click(screen.getByRole("button", { name: "All attendance statuses" }));
    expect(onRsvpStatusFilterChange).toHaveBeenCalledWith("");
    fireEvent.click(screen.getByRole("button", { name: /^Filter by check-in status,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Checked in" }));
    expect(onStatusFilterChange).toHaveBeenCalledWith("admitted");
  });

  it("does not collide with a real ticket type whose catalog key is literally 'all'", () => {
    // Regression test (#752 review): the ticket-type filter used to double as both an
    // empty-string sentinel AND the literal option id "all". A catalog key of "all" (e.g. a
    // type created from the label "All" via the API or a legacy backfill) then produced two
    // options with the same id, and selecting the real one fired the reset-to-"" path instead
    // of filtering to it. The sentinel now lives entirely in the empty-string value, so a real
    // "all" key can never collide with it.
    const onTicketTypeFilterChange = vi.fn();
    render(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set()}
        ticketTypes={[{ key: "all", label: "All-access pass" }]}
        ticketTypeFilter="all"
        onTicketTypeFilterChange={onTicketTypeFilterChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));

    // The trigger shows the real catalog entry's label, not the "no filter" placeholder.
    expect(screen.getByRole("button", { name: "Filter by ticket type, All-access pass" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Filter by ticket type, All-access pass" }));
    fireEvent.click(screen.getByRole("button", { name: "All-access pass" }));
    expect(onTicketTypeFilterChange).toHaveBeenCalledWith("all");
    expect(onTicketTypeFilterChange).not.toHaveBeenCalledWith("");
  });
});

describe("AttendeesTable mobile card view (<768px)", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  it("shows the mobile card skeleton once the first load has genuinely taken a moment", () => {
    vi.useFakeTimers();
    const { container } = render(
      <AttendeesTable {...tableProps} hasLoadedOnce={false} loading items={[]} total={0} />,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelector("table[aria-hidden='true']")).toBeNull();
    expect(document.querySelector(".attendees-cards")).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "Sort by, Attendee" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Sort by, Attendee" }));
    fireEvent.click(screen.getByRole("button", { name: "Ticket" }));
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
    fireEvent.click(screen.getByRole("button", { name: /^Filter by mail delivery status,/ }));
    for (const label of ["All mail statuses", "Not sent", "Sent", "Pending", "Failed"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    expect(onMailStatusFilterChange).toHaveBeenCalledWith("failed");
  });

  it("keeps the selected mail status reflected in the select's value (no separate active-filter indicator to keep in sync)", () => {
    const { rerender } = render(
      <AttendeesTable {...tableProps} items={[baseRow]} selectedIds={new Set()} mailStatusFilter="" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("button", { name: "Filter by mail delivery status, All mail statuses" })).toBeTruthy();

    rerender(
      <AttendeesTable
        {...tableProps}
        items={[baseRow]}
        selectedIds={new Set()}
        mailStatusFilter="not_sent"
      />,
    );
    expect(screen.getByRole("button", { name: "Filter by mail delivery status, Not sent" })).toBeTruthy();
  });
});
