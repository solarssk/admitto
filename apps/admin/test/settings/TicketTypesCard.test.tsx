// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventSettingsDto, TicketTypeDto } from "../../src/api/types.js";
import { TicketTypesCard } from "../../src/settings/TicketTypesCard.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    updateTicketType: vi.fn(),
    createTicketType: vi.fn(),
    deleteTicketType: vi.fn(),
  };
});

import { createTicketType, deleteTicketType, updateTicketType } from "../../src/api/client.js";

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
  overrides: { error?: string | null; onRetry?: () => void } = {},
) {
  const onChanged = vi.fn();
  renderWithToast(
    <TicketTypesCard
      eventId="evt-1"
      event={event}
      types={types}
      loading={false}
      onChanged={onChanged}
      {...overrides}
    />,
  );
  return { onChanged };
}

describe("TicketTypesCard", () => {
  it("reverts the label input when the update fails, instead of leaving the unsaved edit shown", async () => {
    vi.mocked(updateTicketType).mockRejectedValueOnce(new ApiError(500, "server error"));
    renderCard([vipType]);

    const input = screen.getByDisplayValue("VIP") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "VIP Gold" } });
    fireEvent.blur(input);

    await waitFor(() => expect(updateTicketType).toHaveBeenCalledWith("evt-1", "tt-vip", { label: "VIP Gold" }));
    await waitFor(() => expect(input.value).toBe("VIP"));
  });

  it("keeps a failed label update from calling onChanged", async () => {
    vi.mocked(updateTicketType).mockRejectedValueOnce(new ApiError(500, "server error"));
    const { onChanged } = renderCard([vipType]);

    const input = screen.getByDisplayValue("VIP") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "VIP Gold" } });
    fireEvent.blur(input);

    await waitFor(() => expect(updateTicketType).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows a clear warning toast (not the generic error) on a label conflict while renaming", async () => {
    vi.mocked(updateTicketType).mockRejectedValueOnce(new ApiError(409, "label_conflict", "label_conflict"));
    renderCard([vipType]);

    const input = screen.getByDisplayValue("VIP") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Staff" } });
    fireEvent.blur(input);

    expect(await screen.findByText('"Staff" is already used by another ticket type in this event.')).toBeTruthy();
    // Same revert-on-failure behavior as any other update failure.
    await waitFor(() => expect(input.value).toBe("VIP"));
  });

  it("shows a clear warning toast (not the generic error) on a label conflict while adding", async () => {
    vi.mocked(createTicketType).mockRejectedValueOnce(new ApiError(409, "label_conflict", "label_conflict"));
    renderCard([vipType]);

    fireEvent.click(screen.getByRole("button", { name: "Add ticket type" }));

    expect(
      await screen.findByText('A ticket type named "New type" already exists for this event.'),
    ).toBeTruthy();
  });

  it("exposes an accessible label for each row's label input", () => {
    renderCard([vipType]);
    expect(screen.getByLabelText("Ticket type label for VIP")).toBeTruthy();
  });

  it("keeps the confirm dialog open with an inline error when delete fails (type_in_use)", async () => {
    vi.mocked(deleteTicketType).mockRejectedValueOnce(new ApiError(409, "type_in_use", "type_in_use"));
    renderCard([vipType]);

    fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(screen.getByText(/Can't remove "VIP" — attendees still have this type\./)).toBeTruthy(),
    );
    // The dialog itself (not just a toast) is still open, with the same target and a Cancel path.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("renders an inline error with Retry instead of the list when the catalog failed to load (CodeRabbit review)", () => {
    const onRetry = vi.fn();
    renderCard([], { error: "Failed to load ticket types.", onRetry });

    expect(screen.getByText("Failed to load ticket types.")).toBeTruthy();
    expect(screen.queryByText("No ticket types yet. Add at least one before sending tickets.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("commits an actual label change and calls onChanged", async () => {
    vi.mocked(updateTicketType).mockResolvedValueOnce({ ...vipType, label: "VIP Gold" });
    const { onChanged } = renderCard([vipType]);

    const input = screen.getByDisplayValue("VIP") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "VIP Gold" } });
    fireEvent.blur(input);

    await waitFor(() => expect(updateTicketType).toHaveBeenCalledWith("evt-1", "tt-vip", { label: "VIP Gold" }));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("does not call updateTicketType when blurring without an actual change", () => {
    renderCard([vipType]);
    const input = screen.getByDisplayValue("VIP") as HTMLInputElement;

    fireEvent.blur(input);
    expect(updateTicketType).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.blur(input);
    expect(updateTicketType).not.toHaveBeenCalled();
    expect(input.value).toBe("VIP");
  });

  it("opens the color popover and calls onUpdate with the picked color", async () => {
    vi.mocked(updateTicketType).mockResolvedValueOnce({ ...vipType, color: "blue" });
    renderCard([vipType]);

    fireEvent.click(screen.getByRole("button", { name: "Color: Purple" }));
    fireEvent.click(screen.getByRole("button", { name: "Blue" }));

    await waitFor(() => expect(updateTicketType).toHaveBeenCalledWith("evt-1", "tt-vip", { color: "blue" }));
  });

  it("adds a new ticket type and calls onChanged", async () => {
    vi.mocked(createTicketType).mockResolvedValueOnce({
      id: "tt-new",
      key: "new_type",
      label: "New type",
      color: "blue",
      sort_order: 1,
      attendee_count: 0,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const { onChanged } = renderCard([vipType]);

    fireEvent.click(screen.getByRole("button", { name: "Add ticket type" }));

    await waitFor(() =>
      expect(createTicketType).toHaveBeenCalledWith("evt-1", { label: "New type", color: "blue" }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("shows a warning toast (not the generic error) when the per-event type limit is reached", async () => {
    vi.mocked(createTicketType).mockRejectedValueOnce(
      new ApiError(422, "type_limit_reached", "type_limit_reached"),
    );
    renderCard([vipType]);

    fireEvent.click(screen.getByRole("button", { name: "Add ticket type" }));

    expect(await screen.findByText("Ticket type limit reached for this event.")).toBeTruthy();
  });

  it("deletes a ticket type on confirm and calls onChanged", async () => {
    vi.mocked(deleteTicketType).mockResolvedValueOnce(undefined);
    const { onChanged } = renderCard([vipType]);

    fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(deleteTicketType).toHaveBeenCalledWith("evt-1", "tt-vip"));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the color popover on outside click and on Escape", () => {
    renderCard([vipType]);
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

  it("commits the label on Enter, same as blur", async () => {
    vi.mocked(updateTicketType).mockResolvedValueOnce({ ...vipType, label: "VIP Gold" });
    renderCard([vipType]);

    const input = screen.getByDisplayValue("VIP") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "VIP Gold" } });
    // The component calls the native .blur() on Enter (not a synthesized blur event), which is a
    // no-op unless the element is actually focused first.
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(updateTicketType).toHaveBeenCalledWith("evt-1", "tt-vip", { label: "VIP Gold" }));
  });

  it("closes the delete confirm dialog on Cancel without calling deleteTicketType", () => {
    renderCard([vipType]);

    fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
    expect(screen.getByText('Remove "VIP"? This cannot be undone.')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteTicketType).not.toHaveBeenCalled();
    expect(screen.queryByText('Remove "VIP"? This cannot be undone.')).toBeNull();
  });
});
