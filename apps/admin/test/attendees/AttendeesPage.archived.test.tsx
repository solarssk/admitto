// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const fetchEventAttendees = vi.fn();
const reportApiError = vi.fn();

const registeredRow: AttendeeRowDto = {
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

const revokedRow: AttendeeRowDto = {
  ...registeredRow,
  id: "att-2",
  name: "John Smith",
  email: "john@example.com",
  status: "revoked",
};

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError }),
}));

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  fetchEventAttendees: (...args: unknown[]) => fetchEventAttendees(...args),
  fetchTicketTypes: vi.fn().mockResolvedValue([]),
  fetchEventTemplates: vi.fn().mockResolvedValue([
    {
      id: "tpl-ticket",
      name: "ticket",
      label: "Ticket",
      template_format: "html",
      subject_template: "",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ]),
  fetchEventMailSettings: vi.fn().mockResolvedValue({
    eventId: "evt-1",
    organizationId: "org-1",
    isProduction: false,
    hasEventOverride: false,
    fields: { provider: { value: "smtp", source: "organization", locked: false } },
  }),
  exportAttendees: vi.fn(),
  bulkResendTickets: vi.fn(),
  sendEventBulk: vi.fn(),
  bulkDeleteAttendees: vi.fn(),
  bulkCheckInAttendees: vi.fn(),
  updateAttendee: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: {
        id: "evt-1",
        title: "Demo",
        timezone: "UTC",
        date: "2026-07-01",
        location: null,
        attendee_count: 2,
        archived_at: "2026-01-01T00:00:00.000Z",
      },
    }),
  };
});

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees" element={<AttendeesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AttendeesPage archived lockdown", () => {
  it("disables every mutating control with the archived tooltip, leaving read-only controls enabled", async () => {
    fetchEventAttendees.mockResolvedValue({
      items: [registeredRow, revokedRow],
      total: 2,
      page: 1,
      pageSize: 25,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    const importButton = screen.getByRole("button", { name: "Import" });
    const addButton = screen.getByRole("button", { name: "+ Add attendee" });
    const sendTicketsButton = screen.getByRole("button", { name: "Send tickets" });
    const revokeButton = screen.getByRole("button", { name: "Revoke pass" });
    const restoreButton = screen.getByRole("button", { name: "Restore pass" });

    for (const control of [importButton, addButton, sendTicketsButton, revokeButton, restoreButton]) {
      expect(control.disabled).toBe(true);
      const describedBy = control.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      const description = document.getElementById(describedBy!);
      expect(description?.textContent).toBe(ARCHIVED_ACTION_TOOLTIP);
      expect(control.closest(".at-tooltip")).toBeTruthy();
    }

    // The page-header toolbar buttons sit at the very top of the page — their
    // tooltip grows downward so the scroll container's overflow boundary can't
    // clip it (real bug found in testing). Per-row controls further down the
    // table keep the default upward placement.
    for (const control of [importButton, addButton, sendTicketsButton]) {
      expect(control.closest(".at-tooltip")?.classList.contains("at-tooltip--below")).toBe(true);
    }
    for (const control of [revokeButton, restoreButton]) {
      expect(control.closest(".at-tooltip")?.classList.contains("at-tooltip--below")).toBe(false);
    }

    // Read-only controls stay usable on archived events — the export formats now live behind a
    // single "Export" menu button (#354) instead of three standalone buttons.
    const exportTrigger = screen.getByRole("button", { name: "Export" });
    expect(exportTrigger.disabled).toBe(false);
    fireEvent.click(exportTrigger);
    expect(screen.getByRole("menuitem", { name: /^XLSX/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^CSV/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^PDF/ })).toBeTruthy();
    const viewButtons = screen.getAllByRole("button", { name: "View attendee" });
    expect(viewButtons.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
  });

  it("locks the bulk bar's Send tickets but leaves Delete reachable (#356 follow-up)", async () => {
    fetchEventAttendees.mockResolvedValue({
      items: [registeredRow, revokedRow],
      total: 2,
      page: 1,
      pageSize: 25,
    });

    renderPage();
    await screen.findByText("Jane Doe");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Doe" }));
    await waitFor(() => expect(document.querySelector(".attendees-bulkbar")).toBeTruthy());
    const bar = document.querySelector(".attendees-bulkbar") as HTMLElement;

    const bulkSendButton = within(bar).getByRole("button", { name: "Send tickets" });
    expect((bulkSendButton as HTMLButtonElement).disabled).toBe(true);
    // Manual check-in for an event that's already over doesn't make sense (matches
    // revoke-checkin/bulk-resend, unlike bulk-delete below).
    const bulkCheckInButton = within(bar).getByRole("button", { name: "Check in" });
    expect((bulkCheckInButton as HTMLButtonElement).disabled).toBe(true);
    // GDPR erasure requests can legally arrive after an event ends; the bulk-delete endpoint
    // doesn't block on archived_at either (matches the single-attendee Delete attendee action).
    const moreActionsButton = within(bar).getByRole("button", { name: "More actions" });
    expect((moreActionsButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(moreActionsButton);
    const deleteItem = within(bar).getByRole("menuitem", { name: /^Delete/ });
    expect((deleteItem as HTMLButtonElement).disabled).toBe(false);
  });
});
