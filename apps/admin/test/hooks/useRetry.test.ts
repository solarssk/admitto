// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRetry } from "../../src/hooks/useRetry.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useRetry", () => {
  it("starts idle, and a run that is not a retry's is not busy, so a first failure shows an idle Retry", () => {
    const { result } = renderHook(() => useRetry());
    expect(result.current.token).toBe(0);
    expect(result.current.busy).toBe(false);
    let isRetry = true;
    act(() => {
      isRetry = result.current.begin();
    });
    expect(isRetry).toBe(false);
    act(() => {
      result.current.end();
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.busy).toBe(false);
  });

  it("is busy at once on the click and re-runs the effect through the token", () => {
    const { result } = renderHook(() => useRetry());
    act(() => result.current.retry());
    expect(result.current.busy).toBe(true);
    expect(result.current.token).toBe(1);
  });

  it("tells the next run it is a retry's, once, and keeps busy through that run", () => {
    const { result } = renderHook(() => useRetry());
    act(() => result.current.retry());
    let first = false;
    let second = true;
    act(() => {
      first = result.current.begin();
    });
    expect(first).toBe(true);
    expect(result.current.busy).toBe(true);
    act(() => {
      second = result.current.begin();
    });
    expect(second).toBe(false);
  });

  it("stays busy for at least 400ms when the answer comes sooner, then turns idle", () => {
    const { result } = renderHook(() => useRetry());
    act(() => result.current.retry());
    act(() => {
      result.current.begin();
      vi.advanceTimersByTime(30);
      result.current.end();
    });
    expect(result.current.busy).toBe(true);
    act(() => {
      vi.advanceTimersByTime(369);
    });
    expect(result.current.busy).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current.busy).toBe(false);
  });

  it("drops a pending retry's busy state when another kind of run (another event) replaces it", () => {
    const { result } = renderHook(() => useRetry());
    act(() => result.current.retry());
    act(() => {
      result.current.begin(); // the retry's run
    });
    act(() => {
      result.current.begin(); // an event switch re-runs the effect without a retry
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.busy).toBe(false);
  });
});
