// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();
const fetchEventMailSettings = vi.fn();

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
  };
});

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [{ role: "admin", scope_type: "organization", scope_id: "org-1" }] }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: {
        id: "evt-1",
        title: "Demo",
        slug: "demo",
        date: "2026-06-01",
        timezone: "Europe/Warsaw",
        location: null,
        attendee_count: 1,
        archived_at: null,
      },
    }),
  };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAttendeeDetail: vi.fn(),
    revokeAttendeeCheckIn: vi.fn(),
    resendTicket: vi.fn(),
    fetchEventMailSettings: (...args: unknown[]) => fetchEventMailSettings(...args),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
  };
});

function mailSettings(provider: string | null) {
  return {
    eventId: "evt-1",
    organizationId: "org-1",
    isProduction: false,
    hasEventOverride: false,
    fields: { provider: { value: provider, source: "organization", locked: false } },
  };
}

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "att-1",
    name: "Anna",
    email: "anna@example.com",
    company: "Acme",
    department: "Eng",
    ticket_type: "vip",
    custom_data: {},
    status: "registered" as const,
    admitted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    check_in_status: "not_admitted" as const,
    last_mail_status: null,
    rsvp_status: "confirmed" as const,
    rsvp_updated_at: null,
    rsvp_source: null,
    deliveries: [],
    action_log: [],
    event_items: [],
    ...overrides,
  };
}

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
}

function renderPage() {
  renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/att-1"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<AttendeeDetailPage />} />
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

describe("AttendeeDetailPage More actions — Resend ticket mail-configured gate (PO review, matches AttendeesPage's Send tickets)", () => {
  it("disables Resend ticket with an explanatory tooltip when neither the event nor the org has a mail transport", async () => {
    fetchEventMailSettings.mockResolvedValue(mailSettings(null));
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const resendItem = await screen.findByRole("menuitem", { name: /Resend ticket/ });

    await waitFor(() => expect((resendItem as HTMLButtonElement).disabled).toBe(true));
    const describedBy = resendItem.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/no mail transport configured/i);
  });

  it("keeps Resend ticket enabled when a real transport resolves, inherited or dedicated", async () => {
    fetchEventMailSettings.mockResolvedValue(mailSettings("graph"));
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const resendItem = await screen.findByRole("menuitem", { name: /Resend ticket/ });
    await waitFor(() => expect(fetchEventMailSettings).toHaveBeenCalled());
    expect((resendItem as HTMLButtonElement).disabled).toBe(false);
  });

  it('treats "export_only" as not actually configured, same as the Attendees list', async () => {
    fetchEventMailSettings.mockResolvedValue(mailSettings("export_only"));
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const resendItem = await screen.findByRole("menuitem", { name: /Resend ticket/ });
    await waitFor(() => expect((resendItem as HTMLButtonElement).disabled).toBe(true));
  });

  it("does not block Resend ticket while the mail-settings fetch is still pending or if it fails (fails open)", async () => {
    fetchEventMailSettings.mockRejectedValue(new Error("network down"));
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const resendItem = await screen.findByRole("menuitem", { name: /Resend ticket/ });
    await waitFor(() => expect(fetchEventMailSettings).toHaveBeenCalled());
    expect((resendItem as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not gate the More actions trigger itself, only the Resend ticket item inside it", async () => {
    // Future menu entries (#356) may have nothing to do with mail - the trigger stays clickable
    // so the operator can still see and use whatever else lives in this menu.
    fetchEventMailSettings.mockResolvedValue(mailSettings(null));
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    const trigger = await screen.findByRole("button", { name: "More actions" });
    await waitFor(() => expect(fetchEventMailSettings).toHaveBeenCalled());
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
  });
});
