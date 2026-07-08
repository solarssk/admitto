// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventItemDto } from "../../src/api/types.js";
import { EventItemDrawer } from "../../src/requirements/EventItemDrawer.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    deleteEventItem: vi.fn(),
    updateEventItem: vi.fn(),
  };
});

import { deleteEventItem, updateEventItem } from "../../src/api/client.js";

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
  render(
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

  it("shows in-use banner when delete returns item_in_use", async () => {
    vi.mocked(deleteEventItem).mockRejectedValueOnce(
      new ApiError(409, "item_in_use", "item_in_use"),
    );
    renderDrawer(giftbagItem);
    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.getByText(/issued to attendees — disable it instead of deleting/)).toBeTruthy();
    });
  });

  it("shows generic delete failure for other 409 responses", async () => {
    vi.mocked(deleteEventItem).mockRejectedValueOnce(new ApiError(409, "key_conflict", "key_conflict"));
    renderDrawer(giftbagItem);
    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.getByText(/Failed to delete item/)).toBeTruthy();
    });
    expect(screen.queryByText(/issued to attendees — disable it instead of deleting/)).toBeNull();
  });
});
