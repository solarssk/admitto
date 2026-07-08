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
  createEventItem: vi.fn(),
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
