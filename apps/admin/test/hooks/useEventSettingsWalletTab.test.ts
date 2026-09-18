// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import type { EventSettingsTab } from "../../src/settings/eventSettingsTabs.js";

vi.mock("../../src/api/client.js", () => ({
  fetchEventCustomFields: vi.fn(),
  fetchEventLocation: vi.fn(),
  fetchWalletPushHistory: vi.fn(),
}));

import { fetchEventCustomFields } from "../../src/api/client.js";
import { useWalletCustomFields } from "../../src/hooks/useEventSettingsWalletTab.js";

const WALLET_TAB: ReadonlySet<EventSettingsTab> = new Set(["wallet"]);
const NO_TABS: ReadonlySet<EventSettingsTab> = new Set([]);

function makeField(overrides: Partial<EventCustomFieldDto> = {}): EventCustomFieldDto {
  return {
    id: "cf-1",
    source_field: "t_shirt_size",
    label: "T-Shirt size",
    description: null,
    type: "select",
    required: false,
    options: ["S", "M", "L"],
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.mocked(fetchEventCustomFields).mockReset();
});

describe("useWalletCustomFields", () => {
  it("does not fetch before the Wallet tab has been visited", () => {
    renderHook(() => useWalletCustomFields("evt-1", NO_TABS));
    expect(fetchEventCustomFields).not.toHaveBeenCalled();
  });

  it("fetches once the Wallet tab is visited and returns the resolved list", async () => {
    vi.mocked(fetchEventCustomFields).mockResolvedValueOnce([makeField()]);

    const { result } = renderHook(() => useWalletCustomFields("evt-1", WALLET_TAB));
    expect(result.current).toBeUndefined();

    await waitFor(() => expect(result.current).toEqual([makeField()]));
    expect(fetchEventCustomFields).toHaveBeenCalledTimes(1);
    expect(fetchEventCustomFields).toHaveBeenCalledWith("evt-1", expect.any(AbortSignal));
  });

  it("does not re-fetch on a re-render for the same event", async () => {
    vi.mocked(fetchEventCustomFields).mockResolvedValueOnce([]);
    const { result, rerender } = renderHook(
      ({ eventId }: { eventId: string }) => useWalletCustomFields(eventId, WALLET_TAB),
      { initialProps: { eventId: "evt-1" } },
    );
    await waitFor(() => expect(result.current).toEqual([]));

    rerender({ eventId: "evt-1" });
    expect(fetchEventCustomFields).toHaveBeenCalledTimes(1);
  });

  it("re-fetches and clears the previous event's fields when eventId changes (bot review)", async () => {
    vi.mocked(fetchEventCustomFields).mockResolvedValueOnce([makeField({ source_field: "a_field" })]);
    const { result, rerender } = renderHook(
      ({ eventId }: { eventId: string }) => useWalletCustomFields(eventId, WALLET_TAB),
      { initialProps: { eventId: "evt-A" } },
    );
    await waitFor(() => expect(result.current).toEqual([makeField({ source_field: "a_field" })]));

    let resolveB: (items: EventCustomFieldDto[]) => void = () => {};
    vi.mocked(fetchEventCustomFields).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveB = resolve;
      }),
    );
    rerender({ eventId: "evt-B" });

    // Event A's stale fields must not be offered for event B while B's own fetch is in flight -
    // returning them here would let an admin save a mapping B's attendees can never resolve.
    expect(result.current).toBeUndefined();
    expect(fetchEventCustomFields).toHaveBeenCalledTimes(2);
    expect(fetchEventCustomFields).toHaveBeenLastCalledWith("evt-B", expect.any(AbortSignal));

    act(() => resolveB([makeField({ source_field: "b_field" })]));
    await waitFor(() => expect(result.current).toEqual([makeField({ source_field: "b_field" })]));
  });

  it("leaves the result undefined when the fetch fails (preview-only, no error surfaced)", async () => {
    vi.mocked(fetchEventCustomFields).mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useWalletCustomFields("evt-1", WALLET_TAB));

    await waitFor(() => expect(fetchEventCustomFields).toHaveBeenCalled());
    // Give the rejected promise's .catch a turn to settle before asserting the steady state.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBeUndefined();
  });
});
