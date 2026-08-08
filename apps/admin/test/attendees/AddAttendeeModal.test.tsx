// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

import { ApiError, createAttendee, fetchEventCustomFields, fetchTicketTypes } from "../../src/api/client.js";

const mockCreateAttendee = vi.mocked(createAttendee);
const mockFetchEventCustomFields = vi.mocked(fetchEventCustomFields);
const mockFetchTicketTypes = vi.mocked(fetchTicketTypes);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AddAttendeeModal delayed loading", () => {
  it("shows both loading hints once the fetches have genuinely taken a moment", () => {
    mockFetchEventCustomFields.mockImplementation(() => new Promise(() => {}));
    mockFetchTicketTypes.mockImplementation(() => new Promise(() => {}));
    try {
      vi.useFakeTimers();
      render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByText("Loading attribute fields…")).toBeTruthy();
      expect(screen.getByText("Loading ticket types…")).toBeTruthy();
    } finally {
      // Never-resolving mocks would otherwise leak into every later test in this file.
      mockFetchEventCustomFields.mockResolvedValue([]);
      mockFetchTicketTypes.mockResolvedValue([]);
    }
  });
});

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

    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan Kowalski" } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Email *"), {
      target: { value: "jan@example.com" },
    });

    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
  });

  it("keeps Email out of browser/password-manager email autofill, and moves the Required hint down to the actions row", () => {
    render(
      <AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />,
    );

    const email = screen.getByLabelText("Email *") as HTMLInputElement;
    expect(email.type).toBe("text");
    expect(email.inputMode).toBe("email");
    expect(email.autocomplete).toBe("off");
    expect(email.getAttribute("data-1p-ignore")).toBe("true");
    expect(email.getAttribute("data-lpignore")).toBe("true");

    expect(screen.getByText(/enter their email and first name/i)).toBeTruthy();

    const requiredHint = screen.getByText("* Required");
    const addButton = screen.getByRole("button", { name: "Add attendee" });
    // Same row as the action buttons, not up near the title.
    expect(requiredHint.parentElement).toBe(addButton.closest(".add-attendee-modal__actions"));
  });

  it("shows operator-safe add failure", async () => {
    mockCreateAttendee.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    render(
      <AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });
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

    fireEvent.click(screen.getByRole("button", { name: /^Ticket type,/ }));
    await screen.findByRole("button", { name: "VIP" });

    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
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
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));
    const { rerender } = render(
      <AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />,
    );

    const alert = await screen.findByText("Failed to load ticket types.");
    expect(alert.getAttribute("role")).toBe("alert");

    // AddAttendeeModal has no Retry button (same as the attribute-fields sibling error) - closing
    // and reopening the dialog re-runs the load effect, which is this component's retry path.
    rerender(
      <AddAttendeeModal eventId="evt-1" open={false} onClose={() => {}} onCreated={() => {}} />,
    );
    rerender(
      <AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Failed to load ticket types.")).toBeNull();
    });
  });

  it("still allows submitting a typeless attendee while the ticket-type catalog failed to load (PO follow-up)", async () => {
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);

    await screen.findByText("Failed to load ticket types.");

    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });

    // ticket_type is optional - a broken catalog fetch must not block adding an attendee with no
    // type, even though the dropdown itself has nothing but the blank option to offer right now.
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
  });

  it("still allows submitting a typeless attendee while the ticket-type catalog is still loading (PO follow-up)", async () => {
    let resolveTicketTypes!: (types: unknown[]) => void;
    vi.mocked(fetchTicketTypes).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTicketTypes = resolve;
      }),
    );
    render(<AddAttendeeModal eventId="evt-1" open onClose={() => {}} onCreated={() => {}} />);

    await screen.findByText("Loading ticket types…");
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });

    // Same reasoning as the load-failure case above - loading is a transient state, not a reason
    // to block adding a typeless attendee.
    expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    resolveTicketTypes([]);
    await waitFor(() => {
      expect(screen.queryByText("Loading ticket types…")).toBeNull();
    });
    expect((screen.getByRole("button", { name: "Add attendee" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("does not submit event A's selected ticket type after switching to event B while the modal stays open (audit review)", async () => {
    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([
      { id: "tt-a", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 0, created_at: "2026-01-01T00:00:00.000Z" },
    ]);
    const { rerender } = render(
      <AddAttendeeModal eventId="evt-a" open onClose={() => {}} onCreated={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Ticket type,/ }));
    await screen.findByRole("button", { name: "VIP" });
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Jan Kowalski" } });
    fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "jan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    expect(screen.getByRole("button", { name: "Ticket type, VIP" })).toBeTruthy();

    // Event B's own catalog fetch never settles in this test - submitting must still be allowed
    // (ticket_type is optional), but the "vip" selection from event A must not leak through to it.
    vi.mocked(fetchTicketTypes).mockReturnValueOnce(new Promise(() => {}));
    mockCreateAttendee.mockResolvedValueOnce({} as never);
    rerender(<AddAttendeeModal eventId="evt-b" open onClose={() => {}} onCreated={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ticket type, none selected" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Add attendee" }));

    await waitFor(() => expect(mockCreateAttendee).toHaveBeenCalled());
    expect(mockCreateAttendee).toHaveBeenCalledWith(
      "evt-b",
      expect.objectContaining({ ticket_type: undefined }),
    );
  });
});
