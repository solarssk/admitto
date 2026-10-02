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
    reload: () => Promise.resolve(),
    update: () => {},
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
});
