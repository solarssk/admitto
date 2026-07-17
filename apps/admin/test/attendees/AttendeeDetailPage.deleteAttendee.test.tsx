// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();
const deleteAttendee = vi.fn();

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

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
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
    fetchEventMailSettings: vi.fn().mockResolvedValue({
      eventId: "evt-1",
      organizationId: "org-1",
      isProduction: false,
      hasEventOverride: false,
      fields: { provider: { value: "graph", source: "organization", locked: false } },
    }),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
    deleteAttendee: (...args: unknown[]) => deleteAttendee(...args),
  };
});

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "att-1",
    name: "Anna Alpha",
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
    ticket_ref: null,
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
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/att-1"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<AttendeeDetailPage />} />
        <Route path="/admin/events/:eventId/attendees" element={<div>Attendees list marker</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openDeleteDialog() {
  await screen.findByRole("heading", { name: "Anna Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Delete attendee/ }));
  await screen.findByText("Permanently delete this attendee?");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttendeeDetailPage — Delete attendee (GDPR erasure, #356)", () => {
  it("keeps the confirm button disabled until the attendee's exact name is typed", async () => {
    mockLoad(baseDetail());
    renderPage();
    await openDeleteDialog();

    const confirmButton = screen.getByRole("button", { name: "Delete attendee" });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    const input = screen.getByLabelText('Type the attendee\'s name to confirm: "Anna Alpha"');
    fireEvent.change(input, { target: { value: "wrong name" } });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "Anna Alpha" } });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("deletes, toasts, and navigates back to the attendees list on success", async () => {
    deleteAttendee.mockResolvedValueOnce(undefined);
    mockLoad(baseDetail());
    renderPage();
    await openDeleteDialog();

    fireEvent.change(screen.getByLabelText('Type the attendee\'s name to confirm: "Anna Alpha"'), {
      target: { value: "Anna Alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete attendee" }));

    await screen.findByText("Attendees list marker");
    expect(deleteAttendee).toHaveBeenCalledWith("evt-1", "att-1");
    expect(await screen.findByText("Attendee permanently deleted")).toBeTruthy();
  });

  it("shows an inline error and keeps the dialog open when the delete fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    deleteAttendee.mockRejectedValueOnce(new ApiError(403, "forbidden", "forbidden"));
    mockLoad(baseDetail());
    renderPage();
    await openDeleteDialog();

    fireEvent.change(screen.getByLabelText('Type the attendee\'s name to confirm: "Anna Alpha"'), {
      target: { value: "Anna Alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete attendee" }));

    await screen.findByText("You do not have access.");
    expect(screen.getByText("Permanently delete this attendee?")).toBeTruthy();
  });
});
