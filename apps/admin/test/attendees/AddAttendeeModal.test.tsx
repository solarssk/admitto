// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddAttendeeModal } from "../../src/attendees/AddAttendeeModal.js";

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  createAttendee: vi.fn(),
  fetchEventItems: vi.fn().mockResolvedValue([]),
}));

afterEach(cleanup);

describe("AddAttendeeModal", () => {
  it("keeps submit disabled until email, name, and attribute fields are ready", async () => {
    render(
      <AddAttendeeModal
        eventId="evt-1"
        open
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    const submit = screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jan Kowalski" } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "jan@example.com" },
    });

    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
  });
});
