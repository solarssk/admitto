// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@admitto/ui";
import { RequirementsPage } from "../../src/pages/RequirementsPage.js";
import type { EventItemDto, OpsConfigDto } from "../../src/api/types.js";

const fetchEventItems = vi.fn();
const fetchOpsConfig = vi.fn();
const updateEventItem = vi.fn();
const createEventItem = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  fetchEventItems: (...args: unknown[]) => fetchEventItems(...args),
  fetchOpsConfig: (...args: unknown[]) => fetchOpsConfig(...args),
  updateEventItem: (...args: unknown[]) => updateEventItem(...args),
  createEventItem: (...args: unknown[]) => createEventItem(...args),
  deleteEventItem: vi.fn(),
  updateOpsConfig: vi.fn(),
}));

const reportApiError = vi.fn();
vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError }),
}));

const addToast = vi.fn();
vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return { ...actual, useToast: () => ({ addToast }) };
});

const badgeItem: EventItemDto = {
  id: "item-badge",
  key: "badge",
  label: "Badge",
  description: null,
  type: "item",
  enabled: true,
  icon: null,
  config: { issue_on_checkin: true, requires_return: false },
};

function makeOpsConfig(overrides: Partial<OpsConfigDto> = {}): OpsConfigDto {
  return {
    require_confirm_on_scan: false,
    badge_at_entry: true,
    allow_manual_lookup: true,
    auto_advance_on_valid: true,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/admin/events/evt-1/requirements"]}>
        <Routes>
          <Route path="/admin/events/:eventId/requirements" element={<RequirementsPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RequirementsPage badge/ops-config sync", () => {
  it("refreshes ops config after disabling the badge item, so the toggle doesn't show stale ON", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);
    fetchOpsConfig
      .mockResolvedValueOnce(makeOpsConfig({ badge_at_entry: true }))
      .mockResolvedValueOnce(makeOpsConfig({ badge_at_entry: false }));
    updateEventItem.mockResolvedValueOnce({ ...badgeItem, enabled: false });

    renderPage();

    const badgeToggle = await screen.findByRole("switch", { name: "Issue badge at entry" });
    await waitFor(() => expect(badgeToggle).toHaveProperty("checked", true));

    fireEvent.click(screen.getByRole("switch", { name: "Disable Badge" }));

    await waitFor(() => {
      expect(fetchOpsConfig).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(badgeToggle).toHaveProperty("checked", false);
    });
  });

  it("still shows the success toast when the item update succeeds but the ops-config refresh fails", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);
    fetchOpsConfig
      .mockResolvedValueOnce(makeOpsConfig({ badge_at_entry: true }))
      .mockRejectedValueOnce(new Error("network error"));
    updateEventItem.mockResolvedValueOnce({ ...badgeItem, enabled: false });

    renderPage();
    await screen.findByRole("switch", { name: "Issue badge at entry" });

    fireEvent.click(screen.getByRole("switch", { name: "Disable Badge" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Item disabled — saved", "success");
    });
    expect(addToast).not.toHaveBeenCalledWith(
      expect.stringMatching(/Failed to update item/),
      "error",
    );
  });

  it("shows the enabled toast when toggling an item back on", async () => {
    const disabledGiftbag: EventItemDto = {
      ...badgeItem,
      id: "item-gift",
      key: "giftbag",
      label: "Gift bag",
      enabled: false,
    };
    fetchEventItems.mockResolvedValue([disabledGiftbag]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());
    updateEventItem.mockResolvedValueOnce({ ...disabledGiftbag, enabled: true });

    renderPage();
    fireEvent.click(await screen.findByRole("switch", { name: "Enable Gift bag" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Item enabled — saved", "success");
    });
  });

  it("does not refetch ops config when toggling a non-badge item", async () => {
    const giftbag: EventItemDto = { ...badgeItem, id: "item-gift", key: "giftbag", label: "Gift bag" };
    fetchEventItems.mockResolvedValue([giftbag]);
    fetchOpsConfig.mockResolvedValueOnce(makeOpsConfig());
    updateEventItem.mockResolvedValueOnce({ ...giftbag, enabled: false });

    renderPage();
    await screen.findByRole("switch", { name: "Issue badge at entry" });

    fireEvent.click(screen.getByRole("switch", { name: "Disable Gift bag" }));

    await waitFor(() => {
      expect(updateEventItem).toHaveBeenCalled();
    });
    expect(fetchOpsConfig).toHaveBeenCalledTimes(1);
  });
});

describe("RequirementsPage — Add item and Edit item", () => {
  it("shows an inline error and does not create an item when the name has no usable characters", async () => {
    fetchEventItems.mockResolvedValue([]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "!!!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create item" }));

    await waitFor(() => {
      expect(screen.getByText("Enter a name using letters or numbers.")).toBeTruthy();
    });
    expect(addToast).not.toHaveBeenCalled();
    expect(createEventItem).not.toHaveBeenCalled();
  });

  it("clears the Add item name error once the user edits the input", async () => {
    fetchEventItems.mockResolvedValue([]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));
    const input = screen.getByLabelText("Item name");
    fireEvent.change(input, { target: { value: "!!!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create item" }));
    await waitFor(() => {
      expect(screen.getByText("Enter a name using letters or numbers.")).toBeTruthy();
    });

    fireEvent.change(input, { target: { value: "Gift bag" } });

    expect(screen.queryByText("Enter a name using letters or numbers.")).toBeNull();
  });

  it("shows a warning toast when creating an item whose name already exists", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventItems.mockResolvedValue([]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());
    createEventItem.mockRejectedValueOnce(new ApiError(409, "key_conflict", "key_conflict"));

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Gift bag" } });
    fireEvent.click(screen.getByRole("button", { name: "Create item" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("An item with this name already exists.", "warning");
    });
  });

  it("closes the Add item modal via the backdrop and via Cancel, without creating", async () => {
    fetchEventItems.mockResolvedValue([]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());

    const { container } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Lanyard" } });
    fireEvent.click(container.querySelector(".event-item-modal__backdrop")!);
    expect(screen.queryByLabelText("Item name")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByLabelText("Item name")).toHaveProperty("value", "");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Item name")).toBeNull();
    expect(createEventItem).not.toHaveBeenCalled();
  });

  it("opens the edit drawer for an item when clicking Edit item", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit item" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Badge" })).toBeTruthy();
  });

  it("closes the Add item modal on Escape", async () => {
    fetchEventItems.mockResolvedValue([]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));
    expect(screen.getByLabelText("Item name")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByLabelText("Item name")).toBeNull();
  });

  it("Event items table has column headers", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());

    renderPage();
    await screen.findByText("Event items");

    expect(screen.getByRole("columnheader", { name: "Item" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Description" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Active" })).toBeTruthy();
  });

  it("shows an item's description in the table", async () => {
    fetchEventItems.mockResolvedValue([{ ...badgeItem, description: "Physical badge at the door." }]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());

    renderPage();

    expect(await screen.findByText("Physical badge at the door.")).toBeTruthy();
  });

  it("clicking Add item again while the modal is already open closes it", async () => {
    fetchEventItems.mockResolvedValue([]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());

    renderPage();
    const addItemButton = await screen.findByRole("button", { name: "Add item" });
    fireEvent.click(addItemButton);
    expect(screen.getByLabelText("Item name")).toBeTruthy();

    fireEvent.click(addItemButton);

    expect(screen.queryByLabelText("Item name")).toBeNull();
  });

  it("flags a colliding name with the unique-suffix hint", async () => {
    fetchEventItems.mockResolvedValue([{ ...badgeItem, key: "gift_bag", label: "Gift bag" }]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Gift bag" } });

    expect(await screen.findByText(/unique suffix added/)).toBeTruthy();
  });
});

describe("RequirementsPage — Active toggle double-submit guard", () => {
  it("does not double-submit when the Active switch is clicked twice before the request resolves", async () => {
    let resolveUpdate: ((value: EventItemDto) => void) | undefined;
    const pending = new Promise<EventItemDto>((resolve) => {
      resolveUpdate = resolve;
    });
    fetchEventItems.mockResolvedValue([badgeItem]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());
    updateEventItem.mockReturnValueOnce(pending);

    renderPage();
    const toggle = await screen.findByRole("switch", { name: "Disable Badge" });

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    resolveUpdate!({ ...badgeItem, enabled: false });

    await waitFor(() => {
      expect(updateEventItem).toHaveBeenCalledTimes(1);
    });
  });
});
