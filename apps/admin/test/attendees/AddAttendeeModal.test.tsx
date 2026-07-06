// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddAttendeeModal } from "../../src/attendees/AddAttendeeModal.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    createAttendee: vi.fn(),
    fetchEventItems: vi.fn().mockResolvedValue([]),
  };
});

import { ApiError, createAttendee } from "../../src/api/client.js";

const mockCreateAttendee = vi.mocked(createAttendee);

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

  it("shows operator-safe add failure", async () => {
    mockCreateAttendee.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    render(
      <AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jan Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jan@example.com" } });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Add attendee" }));
    await waitFor(() => {
      expect(screen.getByText(/Failed to add attendee/)).toBeTruthy();
    });
  });
});
