// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendeeDetailDrawer } from "../../src/attendees/AttendeeDetailDrawer.js";

vi.mock("../../src/api/client.js", () => ({
  fetchAttendeeDetail: vi.fn(),
  fetchEventItems: vi.fn(),
  updateAttendee: vi.fn(),
  resendTicket: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { fetchAttendeeDetail, fetchEventItems } from "../../src/api/client.js";

const mockDetail = {
  id: "att-1",
  name: "Anna Alpha",
  email: "anna@example.com",
  company: "Acme",
  department: "Ops",
  ticket_type: "vip",
  custom_data: {},
  status: "registered",
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

function renderDrawer(onClose = vi.fn()) {
  render(
    <AttendeeDetailDrawer
      eventId="evt-1"
      attendeeId="att-1"
      onClose={onClose}
      onUpdated={() => {}}
    />,
  );
  return onClose;
}

describe("AttendeeDetailDrawer discard guard", () => {
  it("shows confirm dialog when closing with unsaved changes", async () => {
    vi.mocked(fetchAttendeeDetail).mockResolvedValue(mockDetail);
    vi.mocked(fetchEventItems).mockResolvedValue([]);

    renderDrawer();
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna Beta" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Discard changes?")).toBeTruthy();
  });

  it("closes without dialog when there are no changes", async () => {
    vi.mocked(fetchAttendeeDetail).mockResolvedValue(mockDetail);
    vi.mocked(fetchEventItems).mockResolvedValue([]);

    const onClose = renderDrawer();
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
