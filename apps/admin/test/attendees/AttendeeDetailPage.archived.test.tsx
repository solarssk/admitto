// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";
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
        archived_at: "2026-01-01T00:00:00.000Z",
      },
    }),
  };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    updateAttendee: vi.fn(),
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    revokeAttendeeCheckIn: vi.fn(),
  };
});

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "att-1",
    name: "Anna",
    email: "anna@example.com",
    company: null,
    department: null,
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

function expectArchivedLock(control: HTMLElement) {
  expect((control as HTMLButtonElement | HTMLSelectElement).disabled).toBe(true);
  const describedBy = control.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  const description = document.getElementById(describedBy!);
  expect(description?.textContent).toBe(ARCHIVED_ACTION_TOOLTIP);
  expect(control.closest(".at-tooltip")).toBeTruthy();
}

describe("AttendeeDetailPage archived lockdown", () => {
  it("disables More actions (resend ticket), revoke menu, and Edit for a registered attendee", async () => {
    mockLoad(baseDetail());
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    expectArchivedLock(screen.getByRole("button", { name: "More actions" }));
    expectArchivedLock(screen.getByRole("button", { name: "Revoke" }));
    // Edit mode can't be entered at all on an archived event — the read-only
    // view stays up, no Save button ever renders, and the RSVP select (now
    // inside the Edit modal) is unreachable along with the rest of the form (#361).
    expectArchivedLock(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Attendance" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();

    // Back is read-only navigation and must stay usable.
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables restore pass for a revoked attendee", async () => {
    mockLoad(baseDetail({ status: "revoked" }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    expectArchivedLock(screen.getByRole("button", { name: "Restore pass" }));
  });
});
