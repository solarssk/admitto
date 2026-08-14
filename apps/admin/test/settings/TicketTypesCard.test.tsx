// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventSettingsDto, TicketTypeDto } from "../../src/api/types.js";
import { TicketTypesCard } from "../../src/settings/TicketTypesCard.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchTicketTypes: vi.fn(),
    updateTicketType: vi.fn(),
    createTicketType: vi.fn(),
    deleteTicketType: vi.fn(),
  };
});

import { createTicketType, deleteTicketType, fetchTicketTypes, updateTicketType } from "../../src/api/client.js";

const event = { id: "evt-1", status: "active" } as EventSettingsDto;

const vipType: TicketTypeDto = {
  id: "tt-vip",
  key: "vip",
  label: "VIP",
  color: "purple",
  sort_order: 0,
  attendee_count: 2,
  created_at: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard(
  types: TicketTypeDto[],
  overrides: { fetchError?: unknown } = {},
) {
  if (overrides.fetchError) {
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(overrides.fetchError);
  } else {
    vi.mocked(fetchTicketTypes).mockResolvedValueOnce(types);
  }
  const onDirtyChange = vi.fn();
  const onSaved = vi.fn();
  renderWithToast(
    <TicketTypesCard eventId="evt-1" event={event} onDirtyChange={onDirtyChange} onSaved={onSaved} />,
  );
  return { onDirtyChange, onSaved };
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save" });
}

describe("TicketTypesCard", () => {
  it("loads and renders ticket types from the server", async () => {
    renderCard([vipType]);
    expect(await screen.findByDisplayValue("VIP")).toBeTruthy();
  });

  it("renders an inline error with Retry when the catalog fails to load, and Retry re-fetches", async () => {
    renderCard([], { fetchError: new Error("network down") });
    expect(await screen.findByText("Failed to load ticket types.")).toBeTruthy();

    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([vipType]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByDisplayValue("VIP")).toBeTruthy();
  });

  it("disables Save until a field actually changes", async () => {
    const { onDirtyChange } = renderCard([vipType]);
    await screen.findByDisplayValue("VIP");

    expect(saveButton()).toHaveProperty("disabled", true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("exposes an accessible label for each row's label input", async () => {
    renderCard([vipType]);
    expect(await screen.findByLabelText("Ticket type label for VIP")).toBeTruthy();
  });

  it("does not call updateTicketType when blurring without an actual change", async () => {
    renderCard([vipType]);
    const input = (await screen.findByDisplayValue("VIP")) as HTMLInputElement;

    fireEvent.blur(input);
    expect(saveButton()).toHaveProperty("disabled", true);

    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.blur(input);
    expect(input.value).toBe("VIP");
    expect(saveButton()).toHaveProperty("disabled", true);
    expect(updateTicketType).not.toHaveBeenCalled();
  });

  it("defers a label edit until Save is clicked", async () => {
    const { onDirtyChange } = renderCard([vipType]);
    const input = (await screen.findByDisplayValue("VIP")) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "VIP Gold" } });
    fireEvent.blur(input);

    expect(input.value).toBe("VIP Gold");
    expect(updateTicketType).not.toHaveBeenCalled();
    expect(saveButton()).toHaveProperty("disabled", false);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    vi.mocked(updateTicketType).mockResolvedValueOnce({ ...vipType, label: "VIP Gold" });
    fireEvent.click(saveButton());

    await waitFor(() => expect(updateTicketType).toHaveBeenCalledWith("evt-1", "tt-vip", { label: "VIP Gold", color: "purple" }));
    await waitFor(() => expect(saveButton()).toHaveProperty("disabled", true));
  });

  it("commits the label on Enter, same as blur - still deferred until Save", async () => {
    renderCard([vipType]);
    const input = (await screen.findByDisplayValue("VIP")) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "VIP Gold" } });
    // The component calls the native .blur() on Enter (not a synthesized blur event), which is a
    // no-op unless the element is actually focused first.
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input.value).toBe("VIP Gold");
    expect(updateTicketType).not.toHaveBeenCalled();
    expect(saveButton()).toHaveProperty("disabled", false);
  });

  it("does not commit the label for a non-Enter key", async () => {
    const { onDirtyChange } = renderCard([vipType]);
    const input = (await screen.findByDisplayValue("VIP")) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "VIP Gold" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(saveButton()).toHaveProperty("disabled", true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("Reset discards a pending label edit without ever calling updateTicketType", async () => {
    renderCard([vipType]);
    const input = (await screen.findByDisplayValue("VIP")) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "VIP Gold" } });
    fireEvent.blur(input);
    expect(saveButton()).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(await screen.findByDisplayValue("VIP")).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", true);
    expect(updateTicketType).not.toHaveBeenCalled();
  });

  it("opens the color popover and defers the picked color until Save", async () => {
    renderCard([vipType]);
    await screen.findByDisplayValue("VIP");

    fireEvent.click(screen.getByRole("button", { name: "Color: Purple" }));
    fireEvent.click(screen.getByRole("button", { name: "Blue" }));

    expect(updateTicketType).not.toHaveBeenCalled();
    expect(saveButton()).toHaveProperty("disabled", false);

    vi.mocked(updateTicketType).mockResolvedValueOnce({ ...vipType, color: "blue" });
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateTicketType).toHaveBeenCalledWith("evt-1", "tt-vip", { label: "VIP", color: "blue" }));
  });

  it("closes the color popover on outside click and on Escape", async () => {
    renderCard([vipType]);
    await screen.findByDisplayValue("VIP");
    const swatchButton = screen.getByRole("button", { name: "Color: Purple" });

    fireEvent.click(swatchButton);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(swatchButton);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens an empty draft row on click without calling createTicketType yet", async () => {
    renderCard([vipType]);
    await screen.findByDisplayValue("VIP");

    fireEvent.click(screen.getByRole("button", { name: "Add ticket type" }));

    expect(screen.getByLabelText("New ticket type label")).toBeTruthy();
    expect(createTicketType).not.toHaveBeenCalled();
  });

  it("queues the new type as a pending draft row, created only on Save", async () => {
    const { onDirtyChange } = renderCard([vipType]);
    await screen.findByDisplayValue("VIP");

    fireEvent.click(screen.getByRole("button", { name: "Add ticket type" }));
    const input = screen.getByLabelText("New ticket type label") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Staff" } });
    fireEvent.blur(input);

    expect(createTicketType).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Staff")).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", false);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    vi.mocked(createTicketType).mockResolvedValueOnce({
      id: "tt-new",
      key: "staff",
      label: "Staff",
      color: "blue",
      sort_order: 1,
      attendee_count: 0,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(createTicketType).toHaveBeenCalledWith("evt-1", { label: "Staff", color: "blue" }));
    await waitFor(() => expect(saveButton()).toHaveProperty("disabled", true));
    // Draft row's placeholder is replaced by the real, saved row - still showing the same label.
    expect(screen.getByDisplayValue("Staff")).toBeTruthy();
  });

  it("Reset discards a pending new ticket type without ever calling createTicketType", async () => {
    renderCard([vipType]);
    await screen.findByDisplayValue("VIP");

    fireEvent.click(screen.getByRole("button", { name: "Add ticket type" }));
    const input = screen.getByLabelText("New ticket type label") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Staff" } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue("Staff")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.queryByDisplayValue("Staff")).toBeNull();
    expect(createTicketType).not.toHaveBeenCalled();
  });

  it("commits the draft on Enter directly, without relying on blur", async () => {
    renderCard([vipType]);
    await screen.findByDisplayValue("VIP");

    fireEvent.click(screen.getByRole("button", { name: "Add ticket type" }));
    const input = screen.getByLabelText("New ticket type label") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Staff" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByDisplayValue("Staff")).toBeTruthy();
    expect(createTicketType).not.toHaveBeenCalled();
  });

  it("does not commit when focus moves to the color swatch, and queues the color actually picked (CodeRabbit review)", async () => {
    renderCard([vipType]);
    await screen.findByDisplayValue("VIP");

    fireEvent.click(screen.getByRole("button", { name: "Add ticket type" }));
    const input = screen.getByLabelText("New ticket type label") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Staff" } });

    // Moving focus from the label to the swatch toggle - still inside the draft row - must not
    // commit with whatever color was set at that moment.
    const swatchButton = screen.getByRole("button", { name: "Color: Blue" });
    fireEvent.blur(input, { relatedTarget: swatchButton });
    // Draft row stays open (not yet committed to the list) - the input still shows what was typed.
    expect(screen.getByLabelText("New ticket type label")).toBeTruthy();
    expect(createTicketType).not.toHaveBeenCalled();

    fireEvent.click(swatchButton);
    fireEvent.click(screen.getByRole("button", { name: "Green" }));

    // Focus now genuinely leaves the row.
    fireEvent.blur(swatchButton, { relatedTarget: null });

    expect(screen.getByDisplayValue("Staff")).toBeTruthy();
    expect(createTicketType).not.toHaveBeenCalled();

    vi.mocked(createTicketType).mockResolvedValueOnce({
      id: "tt-new",
      key: "staff",
      label: "Staff",
      color: "green",
      sort_order: 1,
      attendee_count: 0,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(createTicketType).toHaveBeenCalledWith("evt-1", { label: "Staff", color: "green" }));
  });

  it("cancels the draft without calling createTicketType when blurred empty", async () => {
    renderCard([vipType]);
    await screen.findByDisplayValue("VIP");

    fireEvent.click(screen.getByRole("button", { name: "Add ticket type" }));
    fireEvent.blur(screen.getByLabelText("New ticket type label"));

    expect(createTicketType).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("New ticket type label")).toBeNull();
  });

  it("cancels the draft on Escape without calling createTicketType", async () => {
    renderCard([vipType]);
    await screen.findByDisplayValue("VIP");

    fireEvent.click(screen.getByRole("button", { name: "Add ticket type" }));
    const input = screen.getByLabelText("New ticket type label") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Staff" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(createTicketType).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("New ticket type label")).toBeNull();
  });

  it("shows a clear warning toast (not the generic error) when Save hits a label conflict, and keeps the edit for retry", async () => {
    renderCard([vipType]);
    const input = (await screen.findByDisplayValue("VIP")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Staff" } });
    fireEvent.blur(input);

    vi.mocked(updateTicketType).mockRejectedValueOnce(new ApiError(409, "label_conflict", "label_conflict"));
    fireEvent.click(saveButton());

    expect(await screen.findByText('"Staff" is already used by another ticket type in this event.')).toBeTruthy();
    // Still dirty (unsent) so the admin can fix the name and retry without retyping.
    expect(screen.getByDisplayValue("Staff")).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", false);
  });

  it("shows a warning toast (not the generic error) when Save hits the per-event type limit", async () => {
    renderCard([vipType]);
    await screen.findByDisplayValue("VIP");
    fireEvent.click(screen.getByRole("button", { name: "Add ticket type" }));
    const input = screen.getByLabelText("New ticket type label") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Staff" } });
    fireEvent.blur(input);

    vi.mocked(createTicketType).mockRejectedValueOnce(
      new ApiError(422, "type_limit_reached", "type_limit_reached"),
    );
    fireEvent.click(saveButton());

    expect(await screen.findByText("Ticket type limit reached for this event.")).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", false);
  });

  it("shows the generic error toast when Save fails for an unexpected reason, onSaved is not called", async () => {
    const { onSaved } = renderCard([vipType]);
    const input = (await screen.findByDisplayValue("VIP")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "VIP Gold" } });
    fireEvent.blur(input);

    // A plain (non-ApiError) rejection always falls through to the caller's fallback message,
    // unlike ApiError which can map to a fixed operator-safe string for a known code first.
    vi.mocked(updateTicketType).mockRejectedValueOnce(new Error("network down"));
    fireEvent.click(saveButton());

    expect(await screen.findByText('Failed to save "VIP Gold".')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("saves successfully, toasts success, and calls onSaved", async () => {
    const { onSaved, onDirtyChange } = renderCard([vipType]);
    const input = (await screen.findByDisplayValue("VIP")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "VIP Gold" } });
    fireEvent.blur(input);

    vi.mocked(updateTicketType).mockResolvedValueOnce({ ...vipType, label: "VIP Gold" });
    fireEvent.click(saveButton());

    expect(await screen.findByText("Ticket types saved.")).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  // Delete stays an immediate, individually-confirmed action - its own ConfirmDialog is already
  // the explicit gesture, unlike label/color edits and new rows, which defer to Save/Reset.
  describe("delete (unchanged - immediate, not deferred to Save)", () => {
    it("keeps the confirm dialog open with an inline error when delete fails (type_in_use)", async () => {
      vi.mocked(deleteTicketType).mockRejectedValueOnce(new ApiError(409, "type_in_use", "type_in_use"));
      renderCard([vipType]);
      await screen.findByDisplayValue("VIP");

      fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));

      expect(await screen.findByText(/This type is still assigned to attendees/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    });

    it("shows a generic inline delete error when delete fails for an unexpected reason", async () => {
      vi.mocked(deleteTicketType).mockRejectedValueOnce(new ApiError(500, "server error", "server error"));
      renderCard([vipType]);
      await screen.findByDisplayValue("VIP");

      fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));

      expect(await screen.findByText("Something went wrong. Try again.")).toBeTruthy();
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("deletes a ticket type immediately on confirm and calls onSaved, with no Save step", async () => {
      vi.mocked(deleteTicketType).mockResolvedValueOnce(undefined);
      const { onSaved } = renderCard([vipType]);
      await screen.findByDisplayValue("VIP");

      fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));

      await waitFor(() => expect(deleteTicketType).toHaveBeenCalledWith("evt-1", "tt-vip"));
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByDisplayValue("VIP")).toBeNull();
      expect(saveButton()).toHaveProperty("disabled", true);
    });

    it("closes the delete confirm dialog on Cancel without calling deleteTicketType", async () => {
      renderCard([vipType]);
      await screen.findByDisplayValue("VIP");

      fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
      const dialog = screen.getByRole("dialog", { name: 'Remove "VIP"?' });
      expect(dialog).toBeTruthy();
      expect(
        within(dialog).getByText(/This type will no longer be available for new attendee assignments/),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(deleteTicketType).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: 'Remove "VIP"?' })).toBeNull();
    });
  });
});
