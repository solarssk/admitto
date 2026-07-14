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

import { deleteTicketType, updateTicketType } from "../../src/api/client.js";

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
});
