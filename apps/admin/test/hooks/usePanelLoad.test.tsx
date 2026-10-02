// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePanelLoad } from "../../src/hooks/usePanelLoad.js";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, hangUntilAborted } from "../test-utils.js";

afterEach(() => {
  vi.useRealTimers();
});

const FALLBACK = "Could not load the panel.";

describe("usePanelLoad", () => {
  it("applies the answer to the panel's state, and has the content ready", async () => {
    const apply = vi.fn();
    const { result } = renderHook(() => usePanelLoad({ fetch: async () => "settings", apply, fallback: FALLBACK }));
    await act(async () => {});
    expect(apply).toHaveBeenCalledExactlyOnceWith("settings");
    expect(result.current.gate.showContent).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("draws nothing for 200ms, then the placeholder, keeps it for 400ms, and says it is taking longer after 8 seconds", async () => {
    vi.useFakeTimers();
    const first = deferred<string>();
    const { result } = renderHook(() => usePanelLoad({ fetch: () => first.promise, apply: vi.fn(), fallback: FALLBACK }));
    expect(result.current.gate).toMatchObject({ showIndicator: false, showContent: false });
    await advanceTimers(200);
    expect(result.current.gate.showIndicator).toBe(true);
    expect(result.current.slow).toBe(false);
    await advanceTimers(7800);
    expect(result.current.slow).toBe(true);

    await act(async () => first.resolve("settings"));
    expect(result.current.gate.showContent).toBe(false);
    await advanceTimers(400);
    expect(result.current.gate.showContent).toBe(true);
  });

  it("does not need a stable fetch or apply: a new function each render is not a new load", async () => {
    const fetchCalls = vi.fn(async () => "settings");
    const { rerender } = renderHook(() => usePanelLoad({ fetch: (signal) => fetchCalls(signal as never), apply: () => {}, fallback: FALLBACK }));
    await act(async () => {});
    rerender();
    rerender();
    await act(async () => {});
    expect(fetchCalls).toHaveBeenCalledTimes(1);
  });

  it("ends in an error with the operator-safe text when the load fails, and keeps it on screen with a busy Retry until the answer is in", async () => {
    vi.useFakeTimers();
    const again = deferred<string>();
    const apply = vi.fn();
    const fetchPanel = vi.fn().mockRejectedValueOnce(new Error("boom")).mockReturnValueOnce(again.promise);
    const { result } = renderHook(() => usePanelLoad({ fetch: fetchPanel, apply, fallback: FALLBACK }));
    await act(async () => {});
    expect(result.current.error).toBe(FALLBACK);
    expect(result.current.gate.showContent).toBe(true);
    expect(result.current.retrying).toBe(false);

    act(() => {
      void result.current.retry();
    });
    // No placeholder: the error stays, and its Retry is busy.
    expect(result.current.error).toBe(FALLBACK);
    expect(result.current.gate.showContent).toBe(true);
    expect(result.current.retrying).toBe(true);
    await advanceTimers(5000);
    expect(result.current.retrying).toBe(true);

    await act(async () => again.resolve("settings"));
    await advanceTimers(400);
    expect(result.current).toMatchObject({ error: null, retrying: false });
    expect(apply).toHaveBeenCalledExactlyOnceWith("settings");
  });

  it("keeps the error after a Retry that fails again, with its Retry no longer busy once 400ms have passed", async () => {
    vi.useFakeTimers();
    const fetchPanel = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePanelLoad({ fetch: fetchPanel, apply: vi.fn(), fallback: FALLBACK }));
    await act(async () => {});
    await act(async () => {
      await result.current.retry();
    });
    await advanceTimers(400);
    expect(result.current).toMatchObject({ error: FALLBACK, retrying: false });
    expect(fetchPanel).toHaveBeenCalledTimes(2);
  });

  it("treats an answer that cannot be applied as a failed load, also on a Retry: the error stays, never a blank panel", async () => {
    const apply = vi.fn(() => {
      throw new TypeError("unexpected shape");
    });
    const { result } = renderHook(() => usePanelLoad({ fetch: async () => "settings", apply, fallback: FALLBACK }));
    await act(async () => {});
    expect(result.current.error).toBe(FALLBACK);

    await act(async () => {
      await result.current.retry();
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe(FALLBACK);
    expect(result.current.gate.showContent).toBe(true);
  });

  it("does nothing on a Retry when the panel has loaded: its form is not touched", async () => {
    const fetchPanel = vi.fn(async () => "settings");
    const apply = vi.fn();
    const { result } = renderHook(() => usePanelLoad({ fetch: fetchPanel, apply, fallback: FALLBACK }));
    await act(async () => {});
    await act(async () => {
      await result.current.retry();
    });
    expect(fetchPanel).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("gives up after 30 seconds, in the time limit's own words, and abandons the request", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchPanel = (s: AbortSignal) => {
      signal = s;
      return hangUntilAborted(s) as Promise<string>;
    };
    const { result } = renderHook(() => usePanelLoad({ fetch: fetchPanel, apply: vi.fn(), fallback: FALLBACK }));
    await advanceTimers(LOAD_TIMEOUT_MS);
    await advanceTimers(0);
    expect(result.current.error).toBe(LOAD_TIMEOUT_MESSAGE);
    expect(signal?.aborted).toBe(true);
  });

  it("gives up after 30 seconds even for a request that ignores its signal", async () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const { result } = renderHook(() => usePanelLoad({ fetch: () => new Promise<string>(() => {}), apply, fallback: FALLBACK }));
    await advanceTimers(LOAD_TIMEOUT_MS);
    await advanceTimers(0);
    expect(result.current.error).toBe(LOAD_TIMEOUT_MESSAGE);
    expect(apply).not.toHaveBeenCalled();
  });
});
