// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCardLoad } from "../../src/hooks/useCardLoad.js";
import type { ListLoad } from "../../src/hooks/useListLoad.js";
import { advanceTimers } from "../test-utils.js";

function list(over: Partial<ListLoad<string[]>>): ListLoad<string[]> {
  return {
    data: null,
    loading: false,
    refreshing: false,
    error: null,
    refreshError: null,
    enabled: true,
    reload: () => Promise.resolve(),
    update: () => {},
    poll: () => Promise.resolve(),
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCardLoad", () => {
  it("holds the content back and draws the placeholder after 200ms while the first load runs", async () => {
    const { result } = renderHook(() => useCardLoad(list({ loading: true })));
    expect(result.current.gate.showContent).toBe(false);
    expect(result.current.gate.showIndicator).toBe(false);
    await advanceTimers(200);
    expect(result.current.gate.showIndicator).toBe(true);
    expect(result.current.slow).toBe(false);
    await advanceTimers(7_800);
    expect(result.current.slow).toBe(true);
  });

  it("treats a list that has not been asked yet (no answer, no error) as a wait, not as an empty list", () => {
    const { result } = renderHook(() => useCardLoad(list({ loading: false })));
    expect(result.current.gate.showContent).toBe(false);
  });

  it("is idle, not waiting, while its list is not enabled: nothing is held back and no timer runs for it", async () => {
    const { result } = renderHook(() => useCardLoad(list({ enabled: false })));
    expect(result.current.idle).toBe(true);
    expect(result.current.gate.showContent).toBe(true);

    await advanceTimers(30_000);
    expect(result.current.gate.showIndicator).toBe(false);
    expect(result.current.slow).toBe(false);
  });

  it("counts the placeholder's 200ms and the 8 seconds from the moment the list is enabled, however long the card was idle", async () => {
    const { result, rerender } = renderHook(({ enabled }: { enabled: boolean }) => useCardLoad(list({ enabled })), {
      initialProps: { enabled: false },
    });
    await advanceTimers(60_000);

    rerender({ enabled: true });
    expect(result.current.idle).toBe(false);
    expect(result.current.gate.showContent).toBe(false);
    expect(result.current.gate.showIndicator).toBe(false);
    expect(result.current.slow).toBe(false);
    await advanceTimers(200);
    expect(result.current.gate.showIndicator).toBe(true);
    expect(result.current.slow).toBe(false);
    await advanceTimers(7_800);
    expect(result.current.slow).toBe(true);
  });

  it("starts over when the list is left before it has answered: the placeholder and the 8 second note go, and count from the next request", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useCardLoad(list({ enabled, loading: enabled })),
      { initialProps: { enabled: true } },
    );
    await advanceTimers(8_000);
    expect(result.current.gate.showIndicator).toBe(true);
    expect(result.current.slow).toBe(true);

    rerender({ enabled: false });
    await advanceTimers(0);
    expect(result.current.idle).toBe(true);
    expect(result.current.slow).toBe(false);
    await advanceTimers(10_000);

    rerender({ enabled: true });
    expect(result.current.gate.showIndicator).toBe(false);
    expect(result.current.slow).toBe(false);
    await advanceTimers(200);
    expect(result.current.gate.showIndicator).toBe(true);
    expect(result.current.slow).toBe(false);
  });

  it("is not idle once it has an answer or a failure, whether or not its list is enabled", () => {
    expect(renderHook(() => useCardLoad(list({ enabled: false, data: ["a"] }))).result.current.idle).toBe(false);
    expect(renderHook(() => useCardLoad(list({ enabled: false, error: "Could not load." }))).result.current.idle).toBe(false);
  });

  it("shows the content straight away once there is an answer", () => {
    const { result } = renderHook(() => useCardLoad(list({ data: ["a"] })));
    expect(result.current.gate.showContent).toBe(true);
  });

  it("shows a failure, not a placeholder, and keeps it while its Retry runs", async () => {
    const reload = vi.fn(() => new Promise<void>(() => {}));
    const { result } = renderHook(() => useCardLoad(list({ error: "Could not load.", reload })));
    expect(result.current.gate.showContent).toBe(true);
    expect(result.current.failure.error).toBe("Could not load.");

    await act(async () => {
      void result.current.failure.retry();
    });
    expect(reload).toHaveBeenCalledOnce();
    expect(result.current.failure.retrying).toBe(true);
    expect(result.current.failure.error).toBe("Could not load.");
  });

  it("waits for an answer that is not one to show (alsoWaiting), like a first load, and says so only after 200ms", async () => {
    const { result, rerender } = renderHook(({ alsoWaiting }: { alsoWaiting: boolean }) => useCardLoad(list({ data: [] }), { alsoWaiting }), {
      initialProps: { alsoWaiting: false },
    });
    expect(result.current.gate.showContent).toBe(true);

    rerender({ alsoWaiting: true });
    expect(result.current.gate.showContent).toBe(false);
    expect(result.current.gate.showIndicator).toBe(false);
    await advanceTimers(200);
    expect(result.current.gate.showIndicator).toBe(true);

    rerender({ alsoWaiting: false });
    await advanceTimers(400);
    expect(result.current.gate.showContent).toBe(true);
  });

  it("does not wait for an answer that is not one to show while its list is not enabled", async () => {
    const { result } = renderHook(() => useCardLoad(list({ enabled: false, data: [] }), { alsoWaiting: true }));
    expect(result.current.gate.showContent).toBe(true);
  });
});
