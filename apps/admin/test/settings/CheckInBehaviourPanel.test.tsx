// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInBehaviourPanel } from "../../src/settings/CheckInBehaviourPanel.js";
import { getTooltipText, renderWithToast } from "../test-utils.js";
import type { EventItemDto, OpsConfigDto } from "../../src/api/types.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchOpsConfig: vi.fn(),
    updateOpsConfig: vi.fn(),
    fetchEventItems: vi.fn(),
  };
});

import { ApiError, fetchEventItems, fetchOpsConfig, updateOpsConfig } from "../../src/api/client.js";

const mockFetchOpsConfig = vi.mocked(fetchOpsConfig);
const mockUpdateOpsConfig = vi.mocked(updateOpsConfig);
const mockFetchEventItems = vi.mocked(fetchEventItems);

function makeOpsConfig(overrides: Partial<OpsConfigDto> = {}): OpsConfigDto {
  return {
    require_confirm_on_scan: false,
    badge_at_entry: false,
    allow_manual_lookup: true,
    auto_advance_on_valid: true,
    ...overrides,
  };
}

const usableBadgeItem: EventItemDto = {
  id: "item-badge",
  key: "badge",
  label: "Badge",
  description: null,
  type: "item",
  enabled: true,
  icon: null,
  config: { issue_on_checkin: true, requires_return: false },
};

function renderPanel(
  props: Partial<{
    eventId: string;
    isArchived: boolean;
    onDirtyChange: (dirty: boolean) => void;
    onSavingChange: (saving: boolean) => void;
  }> = {},
) {
  return renderWithToast(
    <CheckInBehaviourPanel eventId="evt-1" isArchived={false} {...props} />,
  );
}

beforeEach(() => {
  mockFetchOpsConfig.mockReset();
  mockUpdateOpsConfig.mockReset();
  mockFetchEventItems.mockReset();
  mockFetchEventItems.mockResolvedValue([usableBadgeItem]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("CheckInBehaviourPanel — load", () => {
  it("shows the saved toggle states once loaded", async () => {
    mockFetchOpsConfig.mockResolvedValue(
      makeOpsConfig({ require_confirm_on_scan: true, allow_manual_lookup: false }),
    );
    renderPanel();

    expect(await screen.findByRole("switch", { name: "Require confirmation on scan" })).toHaveProperty(
      "checked",
      true,
    );
    expect(screen.getByRole("switch", { name: "Allow manual lookup" })).toHaveProperty("checked", false);
    expect(screen.getByRole("switch", { name: "Auto-advance on valid scan" })).toHaveProperty("checked", true);
  });

  it("shows a retry EmptyState on load failure, and recovers when Retry succeeds", async () => {
    mockFetchOpsConfig.mockRejectedValueOnce(new Error("network error")).mockResolvedValueOnce(makeOpsConfig());
    renderPanel();

    await screen.findByText("Could not load check-in behaviour");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("switch", { name: "Require confirmation on scan" })).toBeTruthy();
  });

  it("shows the loading placeholder only once the fetch has genuinely taken a moment", () => {
    mockFetchOpsConfig.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderPanel();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("does not apply a successful response that resolves after the load was aborted by unmount", async () => {
    let resolveLoad: ((value: OpsConfigDto) => void) | undefined;
    mockFetchOpsConfig.mockImplementationOnce(() => new Promise((resolve) => (resolveLoad = resolve)));
    const rendered = renderPanel();
    await waitFor(() => expect(mockFetchOpsConfig).toHaveBeenCalled());

    rendered.unmount();
    resolveLoad!(makeOpsConfig());

    // Nothing to assert on an unmounted tree beyond "this didn't throw" - the real
    // regression this guards is a setState-after-unmount warning.
  });

  it("ignores a load aborted by unmount rather than surfacing its rejection as an error", async () => {
    let rejectLoad: ((reason: unknown) => void) | undefined;
    mockFetchOpsConfig.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectLoad = reject)),
    );
    const rendered = renderPanel();
    await waitFor(() => expect(mockFetchOpsConfig).toHaveBeenCalled());

    rendered.unmount();
    rejectLoad!(new Error("stale request failed"));

    // Nothing to assert on an unmounted tree beyond "this didn't throw" - the real
    // regression this guards is an unhandled rejection / setState-after-unmount warning.
  });
});

describe("CheckInBehaviourPanel — dirty state and save", () => {
  it("reports dirty after a toggle and clears it after a successful save, sending only the changed field", async () => {
    mockFetchOpsConfig.mockResolvedValue(makeOpsConfig());
    mockUpdateOpsConfig.mockResolvedValue(makeOpsConfig({ require_confirm_on_scan: true }));
    const onDirtyChange = vi.fn();
    renderPanel({ onDirtyChange });

    fireEvent.click(await screen.findByRole("switch", { name: "Require confirmation on scan" }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdateOpsConfig).toHaveBeenCalledWith("evt-1", { require_confirm_on_scan: true });
    });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(await screen.findByText("Check-in behaviour saved.")).toBeTruthy();
  });

  it("sends a single patch covering every changed field", async () => {
    mockFetchOpsConfig.mockResolvedValue(makeOpsConfig());
    mockUpdateOpsConfig.mockResolvedValue(
      makeOpsConfig({
        require_confirm_on_scan: true,
        allow_manual_lookup: false,
        auto_advance_on_valid: false,
      }),
    );
    renderPanel();

    fireEvent.click(await screen.findByRole("switch", { name: "Require confirmation on scan" }));
    fireEvent.click(screen.getByRole("switch", { name: "Allow manual lookup" }));
    fireEvent.click(screen.getByRole("switch", { name: "Auto-advance on valid scan" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdateOpsConfig).toHaveBeenCalledWith("evt-1", {
        require_confirm_on_scan: true,
        allow_manual_lookup: false,
        auto_advance_on_valid: false,
      });
    });
  });

  it("resets the draft back to the saved values without calling the API", async () => {
    mockFetchOpsConfig.mockResolvedValue(makeOpsConfig());
    renderPanel();

    const toggle = await screen.findByRole("switch", { name: "Require confirmation on scan" });
    fireEvent.click(toggle);
    expect(await screen.findByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(toggle).toHaveProperty("checked", false);
    expect(screen.queryByText("Unsaved changes")).toBeFalsy();
    expect(mockUpdateOpsConfig).not.toHaveBeenCalled();
  });

  it("shows a toast and keeps the draft on save failure", async () => {
    mockFetchOpsConfig.mockResolvedValue(makeOpsConfig());
    mockUpdateOpsConfig.mockRejectedValue(new Error("boom"));
    renderPanel();

    const toggle = await screen.findByRole("switch", { name: "Require confirmation on scan" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Failed to save check-in behaviour.")).toBeTruthy();
    expect(toggle).toHaveProperty("checked", true);
  });

  it("shows the safe generic message on save failure, not the raw API error code", async () => {
    mockFetchOpsConfig.mockResolvedValue(makeOpsConfig());
    mockUpdateOpsConfig.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPanel();

    fireEvent.click(await screen.findByRole("switch", { name: "Require confirmation on scan" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Failed to save check-in behaviour.")).toBeTruthy();
    expect(screen.queryByText("secret_internal")).toBeNull();
  });
});

describe("CheckInBehaviourPanel — badge dependency", () => {
  it("disables Issue badge at entry with an explanatory tooltip when there is no badge item at all", async () => {
    mockFetchEventItems.mockResolvedValue([]);
    mockFetchOpsConfig.mockResolvedValue(makeOpsConfig());
    renderPanel();

    const toggle = (await screen.findByRole("switch", {
      name: "Issue badge at entry",
    })) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(getTooltipText(toggle)).toMatch(/badge item is disabled/);
  });

  it("disables Issue badge at entry when the badge item itself is disabled", async () => {
    mockFetchEventItems.mockResolvedValue([{ ...usableBadgeItem, enabled: false }]);
    mockFetchOpsConfig.mockResolvedValue(makeOpsConfig());
    renderPanel();

    const toggle = (await screen.findByRole("switch", {
      name: "Issue badge at entry",
    })) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(getTooltipText(toggle)).toMatch(/badge item is disabled/);
  });

  it("disables Issue badge at entry when the badge item has Issue on check-in off", async () => {
    mockFetchEventItems.mockResolvedValue([
      { ...usableBadgeItem, config: { issue_on_checkin: false } },
    ]);
    mockFetchOpsConfig.mockResolvedValue(makeOpsConfig());
    renderPanel();

    const toggle = (await screen.findByRole("switch", {
      name: "Issue badge at entry",
    })) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(getTooltipText(toggle)).toMatch(/Issue on check-in/);
  });

  it("enables Issue badge at entry when the badge item is active and usable", async () => {
    mockFetchEventItems.mockResolvedValue([usableBadgeItem]);
    mockFetchOpsConfig.mockResolvedValue(makeOpsConfig());
    renderPanel();

    const toggle = (await screen.findByRole("switch", {
      name: "Issue badge at entry",
    })) as HTMLInputElement;
    expect(toggle.disabled).toBe(false);
    expect(getTooltipText(toggle)).toBeNull();
  });

  it("on a 409 badge_item_inactive save error, reverts and disables the badge toggle with a warning toast", async () => {
    mockFetchEventItems.mockResolvedValue([usableBadgeItem]);
    mockFetchOpsConfig.mockResolvedValue(makeOpsConfig({ badge_at_entry: false }));
    mockUpdateOpsConfig.mockRejectedValue(new ApiError(409, "badge_item_inactive", "badge_item_inactive"));
    renderPanel();

    const toggle = await screen.findByRole("switch", { name: "Issue badge at entry" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        screen.getByText("Can't enable this. The badge item is disabled or has \"Issue on check-in\" turned off."),
      ).toBeTruthy();
    });
    expect(toggle).toHaveProperty("checked", false);
    expect((toggle as HTMLInputElement).disabled).toBe(true);
  });
});

describe("CheckInBehaviourPanel — archived", () => {
  it("shows an archived note, disables every switch, and hides the footer", async () => {
    mockFetchOpsConfig.mockResolvedValue(makeOpsConfig());
    renderPanel({ isArchived: true });

    await screen.findByText("This event is archived - check-in behaviour cannot be changed.");
    for (const name of [
      "Issue badge at entry",
      "Require confirmation on scan",
      "Allow manual lookup",
      "Auto-advance on valid scan",
    ]) {
      expect((screen.getByRole("switch", { name }) as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });
});
