// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDelayedLoading, whenShown } from "../../src/hooks/useDelayedLoading.js";

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

describe("whenShown", () => {
  it("renders the given content when show is true", () => {
    render(<>{whenShown(true, <p>Loading…</p>)}</>);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders nothing when show is false", () => {
    render(<>{whenShown(false, <p>Loading…</p>)}</>);
    expect(screen.queryByText("Loading…")).toBeNull();
  });
});
