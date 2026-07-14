// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddAttendeeModal } from "../../src/attendees/AddAttendeeModal.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    createAttendee: vi.fn(),
    fetchEventCustomFields: vi.fn().mockResolvedValue([]),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
  };
});

import { ApiError, createAttendee, fetchTicketTypes } from "../../src/api/client.js";

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

  it("populates the Ticket type dropdown from the event's catalog and submits the selected key (batch 04 / #351)", async () => {
    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([
      { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 0, created_at: "2026-01-01T00:00:00.000Z" },
    ]);
    mockCreateAttendee.mockResolvedValueOnce({} as never);
    render(
      <AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />,
    );

    const select = await screen.findByLabelText<HTMLSelectElement>("Ticket type");
    await waitFor(() => expect(screen.getByRole("option", { name: "VIP" })).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jan Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jan@example.com" } });
    fireEvent.change(select, { target: { value: "vip" } });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Add attendee" }));

    await waitFor(() =>
      expect(mockCreateAttendee).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({ ticket_type: "vip" }),
      ),
    );
  });

  it("shows an inline alert when the ticket-type catalog fails to load, and clears it on reopen", async () => {
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    const { rerender } = render(
      <AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />,
    );

    const alert = await screen.findByText("Failed to load ticket types.");
    expect(alert.getAttribute("role")).toBe("alert");

    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([]);
    rerender(<AddAttendeeModal eventId="evt-1" open={false} onClose={() => {}} onCreated={() => {}} />);
    rerender(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);

    await waitFor(() => {
      expect(screen.queryByText("Failed to load ticket types.")).toBeNull();
    });
  });
});
