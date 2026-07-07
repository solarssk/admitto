// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendeeDetailDrawer } from "../../src/attendees/AttendeeDetailDrawer.js";
import { formatUtcDateTime } from "../../src/utils/event-dates.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAttendeeDetail: vi.fn(),
    fetchEventItems: vi.fn(),
  };
});

import { fetchAttendeeDetail, fetchEventItems } from "../../src/api/client.js";

const acceptedDelivery = {
  id: "dlv-1",
  purpose: "resend",
  status: "accepted",
  recipient_email: "anna@example.com",
  rendered_subject: "Your ticket",
  queued_at: "2026-09-01T12:00:00.000Z",
  accepted_at: "2026-09-01T12:00:02.000Z",
  sent_at: null,
  failed_at: null,
  error_code: null,
};

const detail = {
  id: "att-1",
  name: "Anna Alpha",
  email: "anna@example.com",
  company: "Acme",
  department: null,
  ticket_type: "vip",
  custom_data: {},
  status: "registered" as const,
  admitted_at: null,
  updated_at: "2026-01-01T00:00:00.000Z",
  check_in_status: "not_admitted" as const,
  last_mail_status: null,
  deliveries: [acceptedDelivery],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttendeeDetailDrawer communication log", () => {
  it("shows an accepted SMTP send as Sent with the accepted_at timestamp", async () => {
    vi.mocked(fetchAttendeeDetail).mockResolvedValueOnce(detail);
    vi.mocked(fetchEventItems).mockResolvedValueOnce([]);
    render(
      <AttendeeDetailDrawer
        eventId="evt-1"
        attendeeId="att-1"
        eventTimezone="Europe/Warsaw"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Your ticket")).toBeTruthy());
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(
      screen.getByText(formatUtcDateTime(acceptedDelivery.accepted_at)),
    ).toBeTruthy();
  });
});
