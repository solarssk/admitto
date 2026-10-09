// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";
import { REMOVE_ARCHIVED_TOOLTIP } from "../../src/attendees/removeAttendee.js";
import { baseAttendeeDetailEvent, getTooltipText, mockMatchMedia, renderWithToast } from "../test-utils.js";
import { loadAttendeeDetailData } from "./attendeeDetailPageSetup.js";

// Archived-lockdown coverage needs the event itself archived, unlike every sibling
// AttendeeDetailPage.*.test.tsx file, so this overrides attendeeDetailPageSetup.ts's shared
// (non-archived) react-router mock locally - a later, file-local vi.mock() call for the same
// path wins over the setupFile's earlier registration (verified empirically).
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: { ...baseAttendeeDetailEvent, archived_at: "2026-01-01T00:00:00.000Z" },
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

function expectArchivedLock(control: HTMLElement) {
  expect((control as HTMLButtonElement | HTMLSelectElement).disabled).toBe(true);
  const describedBy = control.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  const description = document.getElementById(describedBy!);
  expect(description?.textContent).toBe(ARCHIVED_ACTION_TOOLTIP);
  expect(getTooltipText(control)).toBe(ARCHIVED_ACTION_TOOLTIP);
}

describe("AttendeeDetailPage archived lockdown", () => {
  it("disables Revoke pass (in More actions) and Edit for a registered attendee", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expectArchivedLock(screen.getByRole("menuitem", { name: /Revoke pass/ }));
    // Edit mode can't be entered at all on an archived event — the read-only
    // view stays up, no Save button ever renders, and the RSVP select (now
    // inside the Edit modal) is unreachable along with the rest of the form (#361).
    expectArchivedLock(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Attendance" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    // Back is read-only navigation and must stay usable.
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables restore pass for a revoked attendee", async () => {
    mockLoad(baseDetail({ status: "revoked" }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expectArchivedLock(screen.getByRole("menuitem", { name: /Restore pass/ }));
  });

  it("keeps the More actions trigger and Erase open, but locks Resend ticket and Remove from event (#356)", async () => {
    // The trigger itself must stay clickable on an archived event - privacy requests can
    // legally arrive after an event ends, and the erase endpoint doesn't block on archived_at.
    // Resend ticket keeps its own inner archived lock. Remove from event changes Reports, which
    // are final once the event is archived, so it is off with a tooltip of its own that names
    // Erase as the way to answer a privacy request.
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    const trigger = screen.getByRole("button", { name: "More actions" });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(trigger);

    expectArchivedLock(await screen.findByRole("menuitem", { name: /Resend ticket/ }));
    const eraseItem = screen.getByRole("menuitem", { name: /Erase personal data/ });
    expect((eraseItem as HTMLButtonElement).disabled).toBe(false);
    const removeItem = screen.getByRole("menuitem", { name: /Remove from event/ });
    expect((removeItem as HTMLButtonElement).disabled).toBe(true);
    expect(getTooltipText(removeItem)).toBe(REMOVE_ARCHIVED_TOOLTIP);
  });

  it("turns off Remove from event for an erased attendee too, and keeps the same reason on its tooltip", async () => {
    mockLoad(
      baseDetail({
        name: "Placeholder name from the server",
        erased_at: "2026-10-08T12:00:00.000Z",
        admitted_at: "2026-09-01T10:00:00.000Z",
        check_in_status: "admitted" as const,
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: /Erased attendee/ });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const removeItem = await screen.findByRole("menuitem", { name: /Remove from event/ });
    expect((removeItem as HTMLButtonElement).disabled).toBe(true);
    expect(getTooltipText(removeItem)).toBe(REMOVE_ARCHIVED_TOOLTIP);
  });

  it("has no way across to Remove from the Erase dialog, since there is no Remove to go to", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Erase personal data/ }));
    const dialog = await screen.findByRole("dialog", { name: "Erase this person's personal data?" });

    expect(within(dialog).queryByRole("button", { name: "Use Remove from event" })).toBeNull();
    expect(within(dialog).queryByText("A duplicate or a mistake?")).toBeNull();
  });
});
