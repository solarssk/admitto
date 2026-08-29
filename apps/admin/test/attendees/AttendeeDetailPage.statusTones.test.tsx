// @vitest-environment jsdom
// This import must come first, before every other import in the file - see
// attendeeDetailPageMocks.ts's own doc comment for why.
import { mockModule, mockOutletEvent } from "./attendeeDetailPageMocks.js";
import {
  baseAttendeeDetail,
  baseAttendeeDetailEvent,
  mockAttendeeDetailLoad,
  mockMatchMedia,
  renderAttendeeDetailRoute,
} from "../test-utils.js";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { loadAttendeeDetailData } from "../../src/attendees/attendeeDetailForm.js";

vi.mock("../../src/attendees/attendeeDetailForm.js");
vi.mock("../../src/auth/AuthProvider.js");

vi.mock("react-router", (importOriginal) =>
  mockOutletEvent(importOriginal, () => baseAttendeeDetailEvent),
);

vi.mock("../../src/api/client.js", (importOriginal) =>
  mockModule(importOriginal, () => ({
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
  })),
);

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...baseAttendeeDetail,
    company: "Acme",
    department: "Eng",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  mockAttendeeDetailLoad(loadAttendeeDetailData, detail);
}

function renderPage() {
  return renderAttendeeDetailRoute(<AttendeeDetailPage />);
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

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AttendeeDetailPage status strip icon tones (Codecov review — passStatusTone/rsvpTone fallback branches)", () => {
  it("falls back to a neutral pass icon for a status with no dedicated tone (cancelled)", async () => {
    mockLoad(baseDetail({ status: "cancelled" }));
    const { container } = renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(chipIconClasses(container, "Pass")).toContain("attendee-status-chip__icon--neutral");
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

  it("shows a neutral (not error) Ticket delivery icon for a stopped send, distinct from the RSVP domain's cancelled tone", async () => {
    // Regression: mailTone() used to resolve the raw "cancelled" status straight against the
    // shared status-map, landing on the unrelated attendee/RSVP "cancelled" entry (error/red) -
    // the same collision fixed for MailStatusBadge itself, but this icon read the status
    // separately and was missed in that pass.
    mockLoad(baseDetail({ last_mail_status: "cancelled" }));
    const { container } = renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(chipIconClasses(container, "Ticket delivery")).toContain("attendee-status-chip__icon--neutral");
    expect(chipIconClasses(container, "Ticket delivery")).not.toContain("attendee-status-chip__icon--error");
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

describe("AttendeeDetailPage Delivery history (Codecov review — the no-timestamp fallback was never exercised)", () => {
  it("shows '-' instead of a date/time stack when a delivery row has no timestamp at all", async () => {
    mockLoad(
      baseDetail({
        deliveries: [
          {
            id: "del-1",
            attendee_id: "att-1",
            attendee_name: "Anna",
            purpose: "initial",
            status: "sent",
            provider: "graph",
            provider_message_id: null,
            attempts: 1,
            retryable: null,
            recipient_email: "anna@example.com",
            rendered_subject: "Your ticket",
            template_id: null,
            template_name: null,
            queued_at: "",
            accepted_at: null,
            sent_at: null,
            failed_at: null,
            error_code: null,
            error: null,
            client_timezone: null,
          },
        ],
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Your ticket").closest(".attendee-delivery")?.textContent).toContain("-");
  });

  it("shows a neutral icon tooltip for a cancelled delivery row, not the RSVP domain's error tone", async () => {
    mockLoad(
      baseDetail({
        deliveries: [
          {
            id: "del-cancelled",
            attendee_id: "att-1",
            attendee_name: "Anna",
            purpose: "initial",
            status: "cancelled",
            provider: "graph",
            provider_message_id: null,
            attempts: 1,
            retryable: null,
            recipient_email: "anna@example.com",
            rendered_subject: "Your ticket",
            template_id: null,
            template_name: null,
            queued_at: "2026-01-02T10:00:00.000Z",
            accepted_at: null,
            sent_at: null,
            failed_at: null,
            error_code: null,
            error: null,
            client_timezone: null,
          },
        ],
      }),
    );
    const { container } = renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    const row = screen.getByText("Your ticket").closest(".attendee-delivery");
    expect(row?.querySelector(".ti-ban")).toBeTruthy();
    const icon = row?.querySelector(".attendee-delivery__icon");
    expect(icon?.className).toContain("attendee-delivery__icon--neutral");
    expect(icon?.getAttribute("aria-label")).toBe("Cancelled");
    expect(container.querySelector(".attendee-delivery__icon--error")).toBeNull();
  });
});
