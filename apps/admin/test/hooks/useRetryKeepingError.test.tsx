// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRetryKeepingError } from "../../src/hooks/useRetryKeepingError.js";
import { advanceTimers, deferred } from "../test-utils.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("useRetryKeepingError", () => {
  it("shows the failure that is there, and nothing when there is none", () => {
    const { result, rerender } = renderHook(({ error }) => useRetryKeepingError(error, async () => {}), {
      initialProps: { error: null as string | null },
    });
    expect(result.current.error).toBeNull();
    rerender({ error: "Could not load." });
    expect(result.current.error).toBe("Could not load.");
  });

  it("does nothing on a retry when there is no failure to retry", async () => {
    const run = vi.fn(async () => {});
    const { result } = renderHook(() => useRetryKeepingError(null, run));
    await act(async () => result.current.retry());
    expect(run).not.toHaveBeenCalled();
    expect(result.current.running).toBe(false);
  });

  it("keeps the error on screen, with a busy Retry, while the request runs again, even though the failure was cleared", async () => {
    vi.useFakeTimers();
    const again = deferred<void>();
    const run = vi.fn(() => again.promise);
    const { result, rerender } = renderHook(({ error }) => useRetryKeepingError(error, run), {
      initialProps: { error: "Could not load." as string | null },
    });
    act(() => {
      void result.current.retry();
    });
    // The request starts by clearing the failure, as every load does.
    rerender({ error: null });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.running).toBe(true);
    expect(result.current.retrying).toBe(true);
    expect(result.current.error).toBe("Could not load.");

    await act(async () => again.resolve());
    expect(result.current.running).toBe(false);
    // Busy for at least 400ms, so a retry that fails again at once still shows that it ran.
    expect(result.current.retrying).toBe(true);
    await advanceTimers(400);
    expect(result.current.retrying).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("ends the busy state when the request throws", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => useRetryKeepingError("Could not load.", run));
    await act(async () => {
      await result.current.retry().catch(() => {});
    });
    expect(result.current.running).toBe(false);
  });
});
