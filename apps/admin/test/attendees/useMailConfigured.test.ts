// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const fetchEventMailSettings = vi.fn();
vi.mock("../../src/api/client.js", () => ({
  fetchEventMailSettings: (...args: unknown[]) => fetchEventMailSettings(...args),
}));

const { useMailConfigured } = await import("../../src/attendees/useMailConfigured.js");

function mailSettings(provider: string | null) {
  return { fields: { provider: { value: provider } } };
}

describe("useMailConfigured (Codecov review — previously extracted, never directly tested)", () => {
  it("never calls the API and stays undefined when eventId is missing", () => {
    const { result } = renderHook(() => useMailConfigured(undefined));
    expect(result.current).toBeUndefined();
    expect(fetchEventMailSettings).not.toHaveBeenCalled();
  });

  it("resolves to true for a real transport", async () => {
    fetchEventMailSettings.mockResolvedValue(mailSettings("graph"));
    const { result } = renderHook(() => useMailConfigured("evt-1"));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("resolves to false for no transport or export_only", async () => {
    fetchEventMailSettings.mockResolvedValue(mailSettings("export_only"));
    const { result } = renderHook(() => useMailConfigured("evt-1"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("fails open (undefined) when the fetch rejects", async () => {
    fetchEventMailSettings.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useMailConfigured("evt-1"));
    await waitFor(() => expect(fetchEventMailSettings).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });

  it("ignores a resolved fetch for an eventId that's no longer current (abort branch)", async () => {
    let resolveFirst!: (value: unknown) => void;
    fetchEventMailSettings.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    fetchEventMailSettings.mockResolvedValueOnce(mailSettings("graph"));

    const { result, rerender } = renderHook(({ eventId }) => useMailConfigured(eventId), {
      initialProps: { eventId: "evt-1" },
    });

    rerender({ eventId: "evt-2" });
    await waitFor(() => expect(result.current).toBe(true));

    // The stale evt-1 fetch resolving late must not clobber evt-2's already-settled value.
    resolveFirst(mailSettings(null));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe(true);
  });

  it("ignores a rejected fetch for an eventId that's no longer current (abort branch)", async () => {
    let rejectFirst!: (err: unknown) => void;
    fetchEventMailSettings.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectFirst = reject)),
    );
    fetchEventMailSettings.mockResolvedValueOnce(mailSettings("smtp"));

    const { result, rerender } = renderHook(({ eventId }) => useMailConfigured(eventId), {
      initialProps: { eventId: "evt-1" },
    });

    rerender({ eventId: "evt-2" });
    await waitFor(() => expect(result.current).toBe(true));

    rejectFirst(new Error("stale request failed"));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe(true);
  });
});
