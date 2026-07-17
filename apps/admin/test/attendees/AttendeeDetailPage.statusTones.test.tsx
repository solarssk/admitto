// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
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
      fields: { provider: { value: null, source: "organization", locked: false } },
    }),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
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
      </Routes>
    </MemoryRouter>,
  );
}

/** The pass, rsvp, mail, and check-in chips share one icon class prefix and are only
 * distinguished by their `<strong>` label, so a plain class-selector query can't tell them
 * apart - this walks to the chip that owns the given label first. */
function chipIconClasses(container: HTMLElement, label: string): string {
  const strong = Array.from(container.querySelectorAll(".attendee-status-chip strong")).find(
    (el) => el.textContent === label,
  );
  const chip = strong?.closest(".attendee-status-chip");
  const icon = chip?.querySelector(".attendee-status-chip__icon");
  return icon?.className ?? "";
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttendeeDetailPage status strip icon tones (Codecov review — passStatusTone/rsvpTone fallback branches)", () => {
  it("falls back to a neutral pass icon for a status with no dedicated tone (cancelled)", async () => {
    mockLoad(baseDetail({ status: "cancelled" }));
    const { container } = renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(chipIconClasses(container, "Registration")).toContain("attendee-status-chip__icon--neutral");
  });

  it("shows a warn rsvp icon for a tentative attendee", async () => {
    mockLoad(baseDetail({ rsvp_status: "tentative" }));
    const { container } = renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(chipIconClasses(container, "Attendance")).toContain("attendee-status-chip__icon--warn");
  });

  it("falls back to a neutral rsvp icon for a status with no dedicated tone (none)", async () => {
    mockLoad(baseDetail({ rsvp_status: "none" }));
    const { container } = renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(chipIconClasses(container, "Attendance")).toContain("attendee-status-chip__icon--neutral");
  });
});

describe("AttendeeDetailPage Activity log tab (Codecov review — action_log rendering was never exercised)", () => {
  it("renders a real action_log entry with its actor and detail text", async () => {
    mockLoad(
      baseDetail({
        action_log: [
          {
            id: "log-1",
            action_type: "attendee_edited",
            actor_display: "Bob Operator",
            metadata: {
              fields: ["company"],
              field_changes: { company: { from: "Old Co", to: "Acme" } },
            },
            created_at: "2026-01-02T10:00:00.000Z",
            client_timezone: "Europe/Warsaw",
          },
        ],
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("tab", { name: "Activity log" }));

    await screen.findByText("Bob Operator");
    expect(screen.getByText(/company/i)).toBeTruthy();
  });
});
