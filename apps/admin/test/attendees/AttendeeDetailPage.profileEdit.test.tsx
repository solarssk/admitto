// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();

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

const updateAttendee = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    updateAttendee: (...args: unknown[]) => updateAttendee(...args),
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    revokeAttendeeCheckIn: vi.fn(),
    fetchTicketTypes: vi.fn().mockResolvedValue([
      { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 1, created_at: "2026-01-01T00:00:00.000Z" },
      { id: "tt-2", key: "standard", label: "Standard", color: "gray", sort_order: 1, attendee_count: 0, created_at: "2026-01-01T00:00:00.000Z" },
    ]),
  };
});

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "att-1",
    name: "Anna",
    email: "anna@example.com",
    company: "Acme",
    department: "Eng",
    ticket_type: "vip",
    custom_data: { dietary: "vegan" },
    status: "registered" as const,
    admitted_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    check_in_status: "not_admitted" as const,
    last_mail_status: null,
    rsvp_status: "confirmed" as const,
    rsvp_updated_at: null,
    rsvp_source: null,
    ticket_ref: null,
    deliveries: [],
    action_log: [],
    ...overrides,
  };
}

const attributeFields = [{ label: "Dietary", source_field: "dietary", type: "text" as const }];

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields, itemsWarning: null });
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttendeeDetailPage profile edit (active event)", () => {
  it("edits every profile field and a custom attribute, then saves the combined patch", async () => {
    mockLoad(baseDetail());
    let resolveSave!: (value: ReturnType<typeof baseDetail>) => void;
    updateAttendee.mockReturnValueOnce(new Promise((resolve) => (resolveSave = resolve)));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "anna.b@example.com" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna B." } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme Corp" } });
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "Sales" } });
    fireEvent.change(screen.getByLabelText("Ticket type"), { target: { value: "standard" } });
    fireEvent.change(screen.getByLabelText("Dietary"), { target: { value: "vegetarian" } });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    // While the save is in flight, every profile field (including custom
    // attributes) stays disabled — not just the Save button.
    await waitFor(() => {
      expect((screen.getByLabelText("Dietary") as HTMLInputElement).disabled).toBe(true);
    });
    resolveSave(baseDetail({ name: "Anna B." }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenCalledWith(
        "evt-1",
        "att-1",
        expect.objectContaining({
          email: "anna.b@example.com",
          name: "Anna B.",
          company: "Acme Corp",
          department: "Sales",
          ticket_type: "standard",
          custom_data_fields: { dietary: "vegetarian" },
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Profile saved/);
    });
    expect((screen.getByLabelText("Dietary") as HTMLInputElement).disabled).toBe(false);
  });

  it("shows the email-conflict inline error instead of a toast, without saving", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    updateAttendee.mockRejectedValueOnce(new ApiError(409, "email in use", "email_conflict"));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "taken@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("This email is already used by another attendee in this event."),
    ).toBeTruthy();
  });

  it("opens the Resend ticket panel", async () => {
    mockLoad(baseDetail());
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Resend ticket" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Resend ticket/);
  });

  it("changes RSVP status and saves it", async () => {
    mockLoad(baseDetail());
    updateAttendee.mockResolvedValueOnce(baseDetail({ rsvp_status: "declined" }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.change(screen.getByRole("combobox", { name: "RSVP status" }), {
      target: { value: "declined" },
    });

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenCalledWith(
        "evt-1",
        "att-1",
        expect.objectContaining({ rsvp_status: "declined" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Status updated/);
    });
  });
});
