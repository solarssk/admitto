// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupReady, useOptionsLoad } from "../../src/hooks/useOptionsLoad.js";
import { deferred } from "../test-utils.js";

afterEach(() => {
  vi.useRealTimers();
});
const settle = () => act(async () => {});

describe("useOptionsLoad", () => {
  it("is loading until the first answer, then offers it", async () => {
    const first = deferred<string[]>();
    const load = () => first.promise;
    const { result } = renderHook(() => useOptionsLoad(load, "Could not load things."));
    expect(result.current).toMatchObject({ items: [], loading: true, error: null });
    await act(async () => first.resolve(["a", "b"]));
    expect(result.current).toMatchObject({ items: ["a", "b"], loading: false, error: null });
  });

  it("reads nothing, and is not loading, while it is not enabled", async () => {
    const load = vi.fn(async () => ["a"]);
    const { result } = renderHook(() => useOptionsLoad(load, "Could not load things.", false));
    await settle();
    expect(load).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("reads afresh, with the placeholder, each time it becomes enabled again", async () => {
    const load = vi.fn(async () => ["a"]);
    const { result, rerender } = renderHook(({ enabled }: { enabled: boolean }) => useOptionsLoad(load, "Could not load things.", enabled), {
      initialProps: { enabled: true },
    });
    await settle();
    expect(result.current.loading).toBe(false);

    rerender({ enabled: false });
    await settle();
    const second = deferred<string[]>();
    load.mockReturnValueOnce(second.promise);
    rerender({ enabled: true });
    expect(result.current.loading).toBe(true);
    await act(async () => second.resolve(["b"]));
    expect(result.current).toMatchObject({ items: ["b"], loading: false });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shows the placeholder again when the request is for something else (a new load function), but not for a retry", async () => {
    const loadA = vi.fn(async () => ["a"]);
    const { result, rerender } = renderHook(({ load }: { load: () => Promise<string[]> }) => useOptionsLoad(load, "Could not load things."), {
      initialProps: { load: loadA },
    });
    await settle();
    expect(result.current.loading).toBe(false);
    const forB = deferred<string[]>();
    const loadB = () => forB.promise;
    rerender({ load: loadB });
    expect(result.current.loading).toBe(true);
    await act(async () => forB.resolve(["b"]));
    expect(result.current.items).toEqual(["b"]);
  });

  it("says it failed instead of offering an empty list, and a Retry reruns only this request, keeping the error on screen meanwhile", async () => {
    const retrying = deferred<string[]>();
    const load = vi.fn().mockRejectedValueOnce(new Error("network down")).mockReturnValueOnce(retrying.promise);
    const { result } = renderHook(() => useOptionsLoad(load, "Could not load things."));
    await settle();
    expect(result.current).toMatchObject({ error: "Could not load things.", loading: false, items: [] });

    act(() => result.current.retry());
    expect(result.current.error).toBe("Could not load things.");
    expect(result.current.retrying).toBe(true);
    await act(async () => retrying.resolve(["a"]));
    expect(result.current).toMatchObject({ error: null, items: ["a"] });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("ignores a request that fails after it was replaced by a retry, and after the hook was left", async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, unmount } = renderHook(() => useOptionsLoad(load, "Could not load things."));
    act(() => result.current.retry());
    await act(async () => first.reject(new Error("late failure")));
    expect(result.current.error).toBeNull();
    expect(result.current.retrying).toBe(true);
    unmount();
    await act(async () => second.reject(new Error("after the page was left")));
  });

  it("says that the server did not answer in time, in the time limit's own words, and abandons the request", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const load = (s: AbortSignal) =>
      new Promise<string[]>((_resolve, reject) => {
        signal = s;
        s.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    const { result } = renderHook(() => useOptionsLoad(load, "Could not load things."));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(result.current.error).toBe("Could not load things. The server did not answer in time. Check your connection and try again.");
    expect(signal?.aborted).toBe(true);
  });
});

describe("lookupReady", () => {
  it("is true only when the lookup is neither on its way nor failed", () => {
    expect(lookupReady({ loading: false, error: null })).toBe(true);
    expect(lookupReady({ loading: true, error: null })).toBe(false);
    expect(lookupReady({ loading: false, error: "Could not load things." })).toBe(false);
  });
});
