// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";
import type { AttendeeRowDto } from "../../src/api/types.js";

const fetchEventAttendees = vi.fn();
const fetchEventMailSettings = vi.fn();
const reportApiError = vi.fn();

function makeRow(id: string, name: string): AttendeeRowDto {
  return {
    id,
    name,
    email: `${id}@example.com`,
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
}

function mailSettings(provider: string | null) {
  return {
    eventId: "evt-1",
    organizationId: "org-1",
    isProduction: false,
    hasEventOverride: false,
    fields: { provider: { value: provider, source: "organization", locked: false } },
  };
}

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
  fetchEventItems: vi.fn().mockResolvedValue([]),
  fetchEventTemplates: vi.fn().mockResolvedValue([]),
  fetchEventMailSettings: (...args: unknown[]) => fetchEventMailSettings(...args),
  exportAttendees: vi.fn(),
  bulkResendTickets: vi.fn(),
  sendEventBulk: vi.fn(),
  updateAttendee: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: {
        id: "evt-1",
        title: "Demo",
        timezone: "UTC",
        date: "2026-07-01",
        location: null,
        attendee_count: 1,
        archived_at: null,
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
  fetchEventAttendees.mockResolvedValue({
    items: [makeRow("att-1", "Jane Doe")],
    total: 1,
    page: 1,
    pageSize: 25,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AttendeesPage header Send tickets — mail-configured gate", () => {
  it("disables Send tickets with an explanatory tooltip when neither the event nor the org has a mail transport", async () => {
    fetchEventMailSettings.mockResolvedValue(mailSettings(null));
    renderPage();

    const sendTicketsButton = await screen.findByRole("button", { name: "Send tickets" });

    await waitFor(() => expect(sendTicketsButton.disabled).toBe(true));
    const describedBy = sendTicketsButton.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/no mail transport configured/i);
  });

  it("keeps Send tickets enabled when a real transport (smtp/graph/powerautomate) resolves, inherited or dedicated", async () => {
    fetchEventMailSettings.mockResolvedValue(mailSettings("graph"));
    renderPage();

    const sendTicketsButton = await screen.findByRole("button", { name: "Send tickets" });
    await waitFor(() => expect(fetchEventMailSettings).toHaveBeenCalled());
    expect(sendTicketsButton.disabled).toBe(false);
  });

  it('treats "export_only" as not actually configured, same as EventMailSettingsCard\'s own check', async () => {
    fetchEventMailSettings.mockResolvedValue(mailSettings("export_only"));
    renderPage();

    const sendTicketsButton = await screen.findByRole("button", { name: "Send tickets" });
    await waitFor(() => expect(sendTicketsButton.disabled).toBe(true));
  });

  it("does not block the button while the mail-settings fetch is still pending or if it fails (fails open)", async () => {
    fetchEventMailSettings.mockRejectedValue(new Error("network down"));
    renderPage();

    const sendTicketsButton = await screen.findByRole("button", { name: "Send tickets" });
    await waitFor(() => expect(fetchEventMailSettings).toHaveBeenCalled());
    expect(sendTicketsButton.disabled).toBe(false);
  });
});
