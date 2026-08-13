// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttendeesTable, type AttendeesTableProps } from "../../src/attendees/AttendeesTable.js";
import { mockMatchMedia } from "../test-utils.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const walletRow: AttendeeRowDto = {
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
  wallet_status: {
    apple_active_registrations: 1,
    apple_inactive_registrations: 0,
    google_active_registrations: 0,
    google_inactive_registrations: 0,
  },
};

const tableProps: AttendeesTableProps = {
  items: [],
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
  onSearchChange: vi.fn(),
  onStatusFilterChange: vi.fn(),
  onTicketTypeFilterChange: vi.fn(),
  onRsvpStatusFilterChange: vi.fn(),
  onMailStatusFilterChange: vi.fn(),
  sortBy: "name" as const,
  sortDir: "asc" as const,
  onSortChange: vi.fn(),
  onViewAttendee: vi.fn(),
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  selectedIds: new Set(["att-1"]),
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
  onBulkChangeRsvpStatus: vi.fn(),
  itemCount: 1,
  onBulkRevokeItems: vi.fn(),
  bulkRevokeItemsBusy: false,
  onBulkRevokePass: vi.fn(),
  bulkRevokePassBusy: false,
  onBulkVoidWallet: vi.fn(),
  onBulkReissueWallet: vi.fn(),
  onBulkDeleteWallet: vi.fn(),
  bulkVoidWalletBusy: false,
  bulkReissueWalletBusy: false,
  bulkDeleteWalletBusy: false,
  onBulkDelete: vi.fn(),
  eventTimezone: "UTC",
  event: { archived_at: null as string | null },
};

function openMoreActionsMenu() {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  return within(screen.getByRole("menu"));
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AttendeesTable wallet bulk-action busy labels", () => {
  it("shows the busy label while a bulk void is in flight", () => {
    render(<AttendeesTable {...tableProps} items={[walletRow]} bulkVoidWalletBusy />);
    const menu = openMoreActionsMenu();
    expect(menu.getByRole("menuitem", { name: /^Voiding wallet passes…/ })).toBeTruthy();
  });

  it("shows the busy label while a bulk reissue is in flight", () => {
    render(<AttendeesTable {...tableProps} items={[walletRow]} bulkReissueWalletBusy />);
    const menu = openMoreActionsMenu();
    expect(menu.getByRole("menuitem", { name: /^Pushing updates…/ })).toBeTruthy();
  });

  it("shows the busy label while a bulk delete is in flight", () => {
    render(<AttendeesTable {...tableProps} items={[walletRow]} bulkDeleteWalletBusy />);
    const menu = openMoreActionsMenu();
    expect(menu.getByRole("menuitem", { name: /^Deleting wallet passes…/ })).toBeTruthy();
  });
});
