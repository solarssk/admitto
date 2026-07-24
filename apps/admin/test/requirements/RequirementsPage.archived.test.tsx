// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { RequirementsPage } from "../../src/pages/RequirementsPage.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";
import type { EventItemDto, OpsConfigDto } from "../../src/api/types.js";
import { getTooltipText } from "../test-utils.js";

const fetchEventItems = vi.fn();
const fetchEventCustomFields = vi.fn();
const fetchOpsConfig = vi.fn();

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
  fetchEventCustomFields: (...args: unknown[]) => fetchEventCustomFields(...args),
  fetchOpsConfig: (...args: unknown[]) => fetchOpsConfig(...args),
  updateEventItem: vi.fn(),
  createEventItem: vi.fn(),
  deleteEventItem: vi.fn(),
  updateOpsConfig: vi.fn(),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError: vi.fn() }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: { id: "evt-1", title: "Demo", archived_at: "2026-01-01T00:00:00.000Z" },
    }),
  };
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

beforeEach(() => {
  fetchEventCustomFields.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function expectArchivedLock(control: HTMLElement) {
  expect((control as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
  const describedBy = control.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  const description = document.getElementById(describedBy!);
  expect(description?.textContent).toBe(ARCHIVED_ACTION_TOOLTIP);
  expect(getTooltipText(control)).toBe(ARCHIVED_ACTION_TOOLTIP);
}

describe("RequirementsPage archived lockdown", () => {
  it("disables add item, per-item controls, and all event behaviour switches with the archived reason", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);
    fetchOpsConfig.mockResolvedValue(makeOpsConfig());

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Badge")).toBeTruthy();
    });

    expectArchivedLock(screen.getByRole("button", { name: "Add item" }));
    expectArchivedLock(screen.getByRole("switch", { name: "Disable Badge" }));
    expectArchivedLock(screen.getByRole("button", { name: "Edit item" }));

    // The archived reason must win even though the badge item is fully usable
    // here (so the fallback "badge inactive" tooltip would not otherwise fire).
    expectArchivedLock(await screen.findByRole("switch", { name: "Issue badge at entry" }));
    expectArchivedLock(screen.getByRole("switch", { name: "Require confirmation on scan" }));
    expectArchivedLock(screen.getByRole("switch", { name: "Allow manual lookup" }));
    expectArchivedLock(screen.getByRole("switch", { name: "Auto-advance on valid scan" }));
  });
});
