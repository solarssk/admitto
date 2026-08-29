// @vitest-environment jsdom
// This import must come first, before every other import in the file - see
// attendeeDetailPageMocks.ts's own doc comment for why.
import { mockModule, mockOutletEvent } from "./attendeeDetailPageMocks.js";
import {
  baseAttendeeDetail,
  baseAttendeeDetailEvent,
  getTooltipText,
  mockAttendeeDetailLoad,
  mockMatchMedia,
  renderAttendeeDetailRoute,
} from "../test-utils.js";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { loadAttendeeDetailData } from "../../src/attendees/attendeeDetailForm.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";

vi.mock("../../src/attendees/attendeeDetailForm.js");
vi.mock("../../src/auth/AuthProvider.js");

vi.mock("react-router", (importOriginal) =>
  mockOutletEvent(importOriginal, () => ({ ...baseAttendeeDetailEvent, archived_at: "2026-01-01T00:00:00.000Z" })),
);

vi.mock("../../src/api/client.js", (importOriginal) =>
  mockModule(importOriginal, () => ({
    updateAttendee: vi.fn(),
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    revokeAttendeeCheckIn: vi.fn(),
  })),
);

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return { ...baseAttendeeDetail, created_at: "2026-01-01T00:00:00.000Z", ...overrides };
}

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  mockAttendeeDetailLoad(loadAttendeeDetailData, detail);
}

function renderPage() {
  renderAttendeeDetailRoute(<AttendeeDetailPage />);
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

  it("keeps the More actions trigger and Delete attendee open, but still locks Resend ticket (#356)", async () => {
    // The trigger itself must stay clickable on an archived event - GDPR erasure requests can
    // legally arrive after an event ends, and the DELETE endpoint doesn't block on archived_at.
    // Resend ticket keeps its own inner archived lock; Delete attendee has none.
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    const trigger = screen.getByRole("button", { name: "More actions" });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(trigger);

    expectArchivedLock(await screen.findByRole("menuitem", { name: /Resend ticket/ }));
    const deleteItem = screen.getByRole("menuitem", { name: /Delete attendee/ });
    expect((deleteItem as HTMLButtonElement).disabled).toBe(false);
  });
});
