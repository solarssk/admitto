// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDelayedLoading, useLoadingGate } from "../../src/hooks/useDelayedLoading.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDelayedLoading", () => {
  it("stays false while isLoading resolves before the delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useDelayedLoading(isLoading, 200),
      { initialProps: { isLoading: true } },
    );
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(false);

    // Resolves before the 200ms threshold — the spinner must never have shown.
    rerender({ isLoading: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(false);
  });

  it("flips true once isLoading has stayed true past the delay", () => {
    const { result } = renderHook(() => useDelayedLoading(true, 200));
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);
  });

  it("resets to false as soon as isLoading turns false, even after showing", () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useDelayedLoading(isLoading, 200),
      { initialProps: { isLoading: true } },
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);

    rerender({ isLoading: false });
    expect(result.current).toBe(false);
  });

  it("uses the default 200ms delay when none is passed", () => {
    const { result } = renderHook(() => useDelayedLoading(true));
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });
});

describe("useLoadingGate", () => {
  const gate = (isLoading: boolean) => renderHook(({ l }) => useLoadingGate(l), { initialProps: { l: isLoading } });

  it("goes straight to the content when the load finishes before the delay (no indicator at all)", () => {
    const { result, rerender } = gate(true);
    expect(result.current).toEqual({ showIndicator: false, showContent: false });

    act(() => {
      vi.advanceTimersByTime(150);
    });
    rerender({ l: false });
    expect(result.current).toEqual({ showIndicator: false, showContent: true });
  });

  it("shows the indicator after 200ms", () => {
    const { result } = gate(true);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toEqual({ showIndicator: true, showContent: false });
  });

  it("keeps an indicator that already appeared up for at least 400ms before showing the content", () => {
    const { result, rerender } = gate(true);
    act(() => {
      vi.advanceTimersByTime(200); // indicator appears at t=200
    });
    act(() => {
      vi.advanceTimersByTime(50); // load finishes at t=250, only 50ms after the indicator appeared
    });
    rerender({ l: false });
    expect(result.current).toEqual({ showIndicator: true, showContent: false });

    act(() => {
      vi.advanceTimersByTime(349);
    });
    expect(result.current.showContent).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1); // 400ms after the indicator appeared
    });
    expect(result.current).toEqual({ showIndicator: false, showContent: true });
  });

  it("swaps to the content right away when the indicator has already been up longer than 400ms", () => {
    const { result, rerender } = gate(true);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    rerender({ l: false });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toEqual({ showIndicator: false, showContent: true });
  });

  it("keeps the indicator up across an overlapping reload instead of flashing it off and on", () => {
    const { result, rerender } = gate(true);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ l: false });
    rerender({ l: true });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toEqual({ showIndicator: true, showContent: false });
  });

  it("honours custom delay and minimum visible time", () => {
    const { result, rerender } = renderHook(
      ({ l }) => useLoadingGate(l, { delayMs: 50, minVisibleMs: 100 }),
      { initialProps: { l: true } },
    );
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.showIndicator).toBe(true);
    rerender({ l: false });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toEqual({ showIndicator: false, showContent: true });
  });
});
