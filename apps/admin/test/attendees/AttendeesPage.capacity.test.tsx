// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { getTooltipText, mockMatchMedia, renderWithToast } from "../test-utils.js";
import type { AttendeeRowDto, EventDto } from "../../src/api/types.js";

const fetchEventAttendees = vi.fn();

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
  has_issued_items: false,
  wallet_status: null,
};

function baseEvent(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: "evt-1",
    title: "Demo",
    slug: "demo",
    timezone: "UTC",
    date: "2026-07-01",
    event_hours_start: null,
    event_hours_end: null,
    location: null,
    organization_id: "org-1",
    archived_at: null,
    wallet_enabled: false,
    wallet_apple_enabled: false,
    wallet_google_enabled: false,
    wallet_samsung_enabled: false,
    wallet_configured: false,
    ...overrides,
  };
}

let mockEvent: EventDto = baseEvent();
let mockRefreshEvent: () => Promise<void> = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js");

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchEventAttendees: (...args: unknown[]) => fetchEventAttendees(...args),
  fetchTicketTypes: vi.fn().mockResolvedValue([]),
  fetchEventItems: vi.fn().mockResolvedValue([]),
  fetchEventTemplates: vi.fn().mockResolvedValue([]),
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
  bulkRevokeCheckIn: vi.fn(),
  bulkRevokePass: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({ event: mockEvent, refreshEvent: mockRefreshEvent }),
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
  fetchEventAttendees.mockResolvedValue({
    items: [registeredRow],
    total: 1,
    page: 1,
    pageSize: 25,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockEvent = baseEvent();
  mockRefreshEvent = vi.fn();
});

describe("AttendeesPage capacity lockdown", () => {
  it("disables Add attendee with a capacity tooltip once active_attendee_count reaches capacity", async () => {
    mockEvent = baseEvent({ capacity: 400, active_attendee_count: 400 });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    const addButton = screen.getByRole("button", { name: "+ Add attendee" }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
    expect(getTooltipText(addButton)).toBe(
      "Event is at capacity (400/400). Free a slot or increase capacity to add more attendees.",
    );
  });

  it("leaves Add attendee enabled below capacity", async () => {
    mockEvent = baseEvent({ capacity: 400, active_attendee_count: 399 });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    const addButton = screen.getByRole("button", { name: "+ Add attendee" }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(false);
  });

  it("leaves Add attendee enabled when the event has no capacity limit", async () => {
    mockEvent = baseEvent({ capacity: null, active_attendee_count: 10_000 });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    const addButton = screen.getByRole("button", { name: "+ Add attendee" }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(false);
  });

  it("does not refresh the event on mount when the event has no capacity limit", async () => {
    mockEvent = baseEvent({ capacity: null, active_attendee_count: 10_000 });
    mockRefreshEvent = vi.fn().mockResolvedValue(undefined);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });
    expect(mockRefreshEvent).not.toHaveBeenCalled();
  });

  // Bug: EventLayout stays mounted across in-event navigation and only re-fetches on an eventId
  // change - so navigating Attendees -> an attendee's Detail page -> back to Attendees (a new
  // AttendeesPage mount, same EventLayout instance) can find a *stale but defined* count if the
  // Detail page deleted, revoked, or restored that attendee (changing the capacity-consuming
  // population) without refreshing the layout's cached event. Skipping the mount refresh just
  // because a number was already present would leave Add attendee's disabled state wrong until
  // another mutation or a full reload.
  it("refreshes the event on mount even when active_attendee_count already looks known, to pick up a stale count from a sibling route's mutation", async () => {
    mockEvent = baseEvent({ capacity: 400, active_attendee_count: 400 });
    mockRefreshEvent = vi.fn().mockImplementation(async () => {
      // Simulates a sibling AttendeeDetailPage delete that happened before this mount, which the
      // layout's cached event never picked up.
      mockEvent = baseEvent({ capacity: 400, active_attendee_count: 399 });
    });
    renderPage();

    await waitFor(() => expect(mockRefreshEvent).toHaveBeenCalledTimes(1));
    const addButton = await screen.findByRole("button", { name: "+ Add attendee" });
    await waitFor(() => expect((addButton as HTMLButtonElement).disabled).toBe(false));
  });

  // Bug: EventsPickerPage navigates to an event with router state carrying that EventCard's own
  // DTO (from GET /api/admin/events, the picker list), which EventLayout renders immediately
  // instead of re-fetching - but that list endpoint never computes active_attendee_count (only
  // the single-event fetch does). Left unfixed, a capacity-full event reached via the picker
  // read active_attendee_count as undefined forever on this page, and "?? 0" left Add attendee
  // enabled even though the event was actually full.
  it("fetches the missing active count on mount when the event arrived without one (picker navigation-state snapshot), and disables Add attendee once it comes back full", async () => {
    mockEvent = baseEvent({ capacity: 400, active_attendee_count: undefined });
    mockRefreshEvent = vi.fn().mockImplementation(async () => {
      // Mirrors what a real refreshEvent() does: fetch the single-event endpoint (which does
      // compute active_attendee_count) and update EventLayout's state, re-rendering this page's
      // outlet context with the fuller event.
      mockEvent = baseEvent({ capacity: 400, active_attendee_count: 400 });
    });
    renderPage();

    await waitFor(() => expect(mockRefreshEvent).toHaveBeenCalledTimes(1));

    const addButton = await screen.findByRole("button", { name: "+ Add attendee" });
    await waitFor(() => expect((addButton as HTMLButtonElement).disabled).toBe(true));
    expect(getTooltipText(addButton)).toBe(
      "Event is at capacity (400/400). Free a slot or increase capacity to add more attendees.",
    );
  });
});
