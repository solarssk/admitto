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

  it("disables delete for the default badge item with an explanatory tooltip", () => {
    renderDrawer(badgeWithNullConfig);
    const deleteButton = screen.getByRole("button", { name: "Delete item" }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.closest(".at-tooltip")?.getAttribute("data-tooltip")).toMatch(
      /Default item/,
    );
  });

  it("keeps delete enabled for non-default items", () => {
    renderDrawer(giftbagItem);
    const deleteButton = screen.getByRole("button", { name: "Delete item" }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(false);
    expect(deleteButton.closest(".at-tooltip")).toBeNull();
  });

  it("fires toast when delete returns default_item", async () => {
    // Defensive fallback: the Delete button is disabled for the badge item,
    // so this path only guards against races/future misuse of the handler.
    vi.mocked(deleteEventItem).mockRejectedValueOnce(
      new ApiError(409, "default_item", "default_item"),
    );
    renderDrawer(giftbagItem);
    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        expect.stringMatching(/can't be deleted — turn off Active instead/),
        "warning",
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

  it("blocks save and shows an inline error when a contents row has a source field but no label", async () => {
    renderDrawer(giftbagItem);
    fireEvent.click(screen.getByRole("button", { name: "Add field hint" }));
    fireEvent.change(screen.getByLabelText("Import key"), { target: { value: "shirt_size" } });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(
        screen.getByText("Each contents row needs both a label and a source field."),
      ).toBeTruthy();
    });
    expect(addToast).not.toHaveBeenCalled();
    expect(updateEventItem).not.toHaveBeenCalled();
  });

  it("clears the contents validation error once the user fills in the missing label", async () => {
    renderDrawer(giftbagItem);
    fireEvent.click(screen.getByRole("button", { name: "Add field hint" }));
    fireEvent.change(screen.getByLabelText("Import key"), { target: { value: "shirt_size" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(
        screen.getByText("Each contents row needs both a label and a source field."),
      ).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Shirt size" } });

    expect(
      screen.queryByText("Each contents row needs both a label and a source field."),
    ).toBeNull();
  });

  it("edits details, icon, and a full contents row, then saves the assembled payload", async () => {
    vi.mocked(updateEventItem).mockResolvedValueOnce(giftbagItem);
    renderDrawer(giftbagItem);

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Gift bag (large)" } });
    fireEvent.change(screen.getByLabelText("Description (shown to operators)"), {
      target: { value: "Large tote bag." },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Item active" }));
    fireEvent.click(screen.getByRole("button", { name: "Gift" }));
    fireEvent.click(screen.getByRole("switch", { name: "Requires return" }));

    fireEvent.click(screen.getByRole("button", { name: "Add field hint" }));
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Shirt size" } });
    fireEvent.change(screen.getByLabelText("Import key"), { target: { value: "shirt_size" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Required" }));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.change(screen.getByLabelText("Select options"), { target: { value: "S\nM\nL" } });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateEventItem).toHaveBeenCalledWith("evt-1", "item-gift", {
        label: "Gift bag (large)",
        description: "Large tote bag.",
        enabled: false,
        icon: "gift",
        config: {
          requires_return: true,
          contents: [
            {
              label: "Shirt size",
              source_field: "shirt_size",
              type: "select",
              required: true,
              options: ["S", "M", "L"],
            },
          ],
        },
      });
    });
  });

  it("removes a contents row so it's no longer saved", async () => {
    const itemWithRow: EventItemDto = {
      ...giftbagItem,
      config: {
        requires_return: false,
        contents: [{ label: "Shirt size", source_field: "shirt_size" }],
      },
    };
    vi.mocked(updateEventItem).mockResolvedValueOnce(itemWithRow);
    renderDrawer(itemWithRow);

    expect(screen.getByLabelText("Display label")).toHaveProperty("value", "Shirt size");
    fireEvent.click(screen.getByRole("button", { name: "Remove row" }));
    expect(screen.queryByLabelText("Display label")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateEventItem).toHaveBeenCalledWith(
        "evt-1",
        "item-gift",
        expect.objectContaining({ config: { requires_return: false } }),
      );
    });
  });

  it("toggles Issue on check-in for the badge item and saves it", async () => {
    const badgeIssueOnCheckin: EventItemDto = {
      ...badgeWithNullConfig,
      config: { issue_on_checkin: true, requires_return: false },
    };
    vi.mocked(updateEventItem).mockResolvedValueOnce(badgeIssueOnCheckin);
    renderDrawer(badgeIssueOnCheckin);

    fireEvent.click(screen.getByRole("switch", { name: "Issue on check-in" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateEventItem).toHaveBeenCalledWith(
        "evt-1",
        "item-badge",
        expect.objectContaining({
          config: expect.objectContaining({ issue_on_checkin: false }),
        }),
      );
    });
  });
});
