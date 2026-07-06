// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { AttendeeDetailDrawer } from "../../src/attendees/AttendeeDetailDrawer.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAttendeeDetail: vi.fn(),
    fetchEventItems: vi.fn(),
    updateAttendee: vi.fn(),
    resendTicket: vi.fn(),
  };
});

import {
  fetchAttendeeDetail,
  fetchEventItems,
  resendTicket,
  updateAttendee,
} from "../../src/api/client.js";

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
  deliveries: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDrawer() {
  render(
    <AttendeeDetailDrawer
      eventId="evt-1"
      attendeeId="att-1"
      eventTimezone="Europe/Warsaw"
      onClose={vi.fn()}
      onUpdated={vi.fn()}
    />,
  );
}

describe("AttendeeDetailDrawer operator errors", () => {
  it("shows load failure", async () => {
    vi.mocked(fetchAttendeeDetail).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderDrawer();
    await waitFor(() => {
      expect(screen.getByText(/Failed to load attendee/)).toBeTruthy();
    });
  });

  it("shows email_conflict on save", async () => {
    vi.mocked(fetchAttendeeDetail).mockResolvedValueOnce(detail);
    vi.mocked(fetchEventItems).mockResolvedValueOnce([]);
    vi.mocked(updateAttendee).mockRejectedValueOnce(new ApiError(409, "email_conflict", "email_conflict"));
    renderDrawer();
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.getByText(/already used by another attendee/)).toBeTruthy();
    });
  });

  it("shows stale_write on save", async () => {
    vi.mocked(fetchAttendeeDetail).mockResolvedValueOnce(detail);
    vi.mocked(fetchEventItems).mockResolvedValueOnce([]);
    vi.mocked(updateAttendee).mockRejectedValueOnce(new ApiError(409, "stale_write", "stale_write"));
    renderDrawer();
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna Beta" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.getByText(/changed by someone else/)).toBeTruthy();
    });
  });

  it("shows generic save failure", async () => {
    vi.mocked(fetchAttendeeDetail).mockResolvedValueOnce(detail);
    vi.mocked(fetchEventItems).mockResolvedValueOnce([]);
    vi.mocked(updateAttendee).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderDrawer();
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna Beta" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.getByText(/Failed to save changes/)).toBeTruthy();
    });
  });

  it("shows resend failure", async () => {
    vi.mocked(fetchAttendeeDetail).mockResolvedValueOnce(detail);
    vi.mocked(fetchEventItems).mockResolvedValueOnce([]);
    vi.mocked(resendTicket).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderDrawer();
    await waitFor(() => expect(screen.getByRole("button", { name: "Resend ticket" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Resend ticket" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByText(/Resend failed/)).toBeTruthy();
    });
  });
});
