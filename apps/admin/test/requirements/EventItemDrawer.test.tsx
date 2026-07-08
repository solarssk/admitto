// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventItemDto } from "../../src/api/types.js";
import { EventItemDrawer } from "../../src/requirements/EventItemDrawer.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    deleteEventItem: vi.fn(),
    updateEventItem: vi.fn(),
  };
});

import { deleteEventItem, updateEventItem } from "../../src/api/client.js";

const addToast = vi.fn();
vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return { ...actual, useToast: () => ({ addToast }) };
});

const badgeWithNullConfig: EventItemDto = {
  id: "item-badge",
  key: "badge",
  label: "Badge",
  type: "item",
  enabled: true,
  icon: null,
  config: null,
};

const giftbagItem: EventItemDto = {
  id: "item-gift",
  key: "giftbag",
  label: "Gift bag",
  type: "item",
  enabled: true,
  icon: null,
  config: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDrawer(item: EventItemDto) {
  renderWithToast(
    <EventItemDrawer
      eventId="evt-1"
      item={item}
      onClose={vi.fn()}
      onUpdated={vi.fn()}
    />,
  );
}

describe("EventItemDrawer", () => {
  it("shows issue on check-in On when badge config is null", () => {
    renderDrawer(badgeWithNullConfig);
    expect(screen.getByRole("switch", { name: "Issue on check-in" })).toHaveProperty(
      "checked",
      true,
    );
  });

  it("persists issue_on_checkin true when saving badge with null config", async () => {
    vi.mocked(updateEventItem).mockResolvedValueOnce({
      ...badgeWithNullConfig,
      config: { issue_on_checkin: true, requires_return: false },
    });
    renderDrawer(badgeWithNullConfig);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(updateEventItem).toHaveBeenCalledWith(
        "evt-1",
        "item-badge",
        expect.objectContaining({
          config: expect.objectContaining({ issue_on_checkin: true }),
        }),
      );
    });
  });

  it("fires toast when delete returns item_in_use", async () => {
    vi.mocked(deleteEventItem).mockRejectedValueOnce(
      new ApiError(409, "item_in_use", "item_in_use"),
    );
    renderDrawer(giftbagItem);
    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        expect.stringMatching(/issued to attendees — disable it instead of deleting/),
        "warning",
      );
    });
    expect(screen.queryByText(/issued to attendees — disable it instead of deleting/)).toBeNull();
  });

  it("fires warning toast when save returns item_in_use", async () => {
    vi.mocked(updateEventItem).mockRejectedValueOnce(
      new ApiError(409, "item_in_use", "item_in_use"),
    );
    renderDrawer(giftbagItem);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        expect.stringMatching(/issued to attendees — record returns before disabling/),
        "warning",
      );
    });
    expect(screen.queryByText(/issued to attendees/)).toBeNull();
  });

  it("fires error toast for generic save failure", async () => {
    vi.mocked(updateEventItem).mockRejectedValueOnce(new Error("network error"));
    renderDrawer(giftbagItem);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        expect.stringMatching(/Failed to save item/),
        "error",
      );
    });
    expect(screen.queryByText(/Failed to save item/)).toBeNull();
  });

  it("fires toast for generic delete failure", async () => {
    vi.mocked(deleteEventItem).mockRejectedValueOnce(new ApiError(409, "key_conflict", "key_conflict"));
    renderDrawer(giftbagItem);
    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        expect.stringMatching(/Failed to delete item/),
        "error",
      );
    });
    expect(screen.queryByText(/Failed to delete item/)).toBeNull();
  });
});
