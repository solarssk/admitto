// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMinimumBusy } from "../../src/hooks/useDelayedLoading.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(initial: boolean, minMs?: number) {
  return renderHook(({ busy }) => useMinimumBusy(busy, minMs), { initialProps: { busy: initial } });
}

describe("useMinimumBusy", () => {
  it("is false while nothing is busy", () => {
    const { result } = setup(false);
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(false);
  });

  it("is true from the first render that is busy, with no delay", () => {
    const { result, rerender } = setup(false);
    rerender({ busy: true });
    expect(result.current).toBe(true);
  });

  it("stays true until 400ms after the start when the work ends sooner, then turns false", () => {
    const { result, rerender } = setup(true);
    act(() => {
      vi.advanceTimersByTime(30);
    });
    rerender({ busy: false });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(369);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it("adds no wait when the work already took longer than the minimum", () => {
    const { result, rerender } = setup(true);
    act(() => {
      vi.advanceTimersByTime(900);
    });
    rerender({ busy: false });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe(false);
  });

  it("keeps the minimum running when the work starts again during the hold", () => {
    const { result, rerender } = setup(true);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ busy: false });
    rerender({ busy: true });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(true);
    rerender({ busy: false });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe(false);
  });

  it("uses the minimum it is given", () => {
    const { result, rerender } = setup(true, 1000);
    rerender({ busy: false });
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });
});
