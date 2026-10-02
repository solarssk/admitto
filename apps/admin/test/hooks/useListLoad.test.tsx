// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { useListLoad } from "../../src/hooks/useListLoad.js";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS } from "../../src/utils/loading-timing.js";
import { deferred } from "../test-utils.js";

afterEach(() => {
  vi.useRealTimers();
});

const settle = () => act(async () => {});

type Fetcher = (signal: AbortSignal) => Promise<string>;
function setup(fetcher: Fetcher, extra: { enabled?: boolean; onData?: (data: string) => void; onError?: (error: unknown) => void } = {}) {
  return renderHook(
    ({ fetcher: current }: { fetcher: Fetcher }) => useListLoad({ fetcher: current, fallback: "Could not load the list.", ...extra }),
    { initialProps: { fetcher } },
  );
}

describe("useListLoad", () => {
  it("has nothing to show on the first load, then the answer", async () => {
    const first = deferred<string>();
    const { result } = setup(() => first.promise);
    expect(result.current).toMatchObject({ loading: true, refreshing: false, data: null, error: null });

    await act(async () => first.resolve("rows A"));
    expect(result.current).toMatchObject({ loading: false, refreshing: false, data: "rows A", error: null });
  });

  it("keeps the answer on screen while a changed query is on its way: refreshing, not loading", async () => {
    const { result, rerender } = setup(async () => "rows A");
    await settle();
    const next = deferred<string>();
    rerender({ fetcher: () => next.promise });
    await settle();
    expect(result.current).toMatchObject({ loading: false, refreshing: true, data: "rows A" });

    await act(async () => next.resolve("rows B"));
    expect(result.current).toMatchObject({ refreshing: false, data: "rows B" });
  });

  it("turns a failed first load into an error, and reload is its Retry: a first load again", async () => {
    const fetcher = vi.fn<Fetcher>().mockRejectedValueOnce(new ApiError(500, "boom"));
    const { result } = setup(fetcher);
    await settle();
    expect(result.current).toMatchObject({ loading: false, data: null });
    expect(result.current.error).toBeTruthy();

    const retry = deferred<string>();
    fetcher.mockReturnValueOnce(retry.promise);
    let done!: Promise<void>;
    act(() => {
      done = result.current.reload();
    });
    // Nothing is on screen, so the placeholder takes the list's place again.
    expect(result.current).toMatchObject({ loading: true, refreshing: false, error: null });
    await act(async () => {
      retry.resolve("rows A");
      await done;
    });
    expect(result.current).toMatchObject({ loading: false, data: "rows A", error: null });
  });

  it("replaces the list with an error when a changed query fails, because what is on screen no longer answers it", async () => {
    const { result, rerender } = setup(async () => "rows A");
    await settle();
    rerender({ fetcher: () => Promise.reject(new ApiError(500, "boom")) });
    await settle();
    expect(result.current.error).toBeTruthy();
    expect(result.current.refreshError).toBeNull();
    expect(result.current.refreshing).toBe(false);
  });

  it("treats the Retry after a failed changed query as a first load again: there is nothing on screen to keep", async () => {
    const { result, rerender } = setup(async () => "rows A");
    await settle();
    const retry = deferred<string>();
    const failing = vi.fn<Fetcher>().mockRejectedValueOnce(new ApiError(500, "boom")).mockReturnValueOnce(retry.promise);
    rerender({ fetcher: failing });
    await settle();
    expect(result.current.error).toBeTruthy();

    act(() => {
      void result.current.reload();
    });
    expect(result.current).toMatchObject({ loading: true, refreshing: false, error: null });
    await act(async () => retry.resolve("rows B"));
    expect(result.current).toMatchObject({ loading: false, data: "rows B" });
  });

  it("keeps the list and says it may be older when a reload of the same query fails, and clears that when one works", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce("rows A").mockRejectedValueOnce(new ApiError(500, "boom"));
    const { result } = setup(fetcher);
    await settle();

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toBe("rows A");
    expect(result.current.error).toBeNull();
    expect(result.current.refreshError).toMatch(/^Could not refresh this list, so it may show older details\./);

    fetcher.mockResolvedValueOnce("rows B");
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current).toMatchObject({ data: "rows B", refreshError: null });
  });

  it("gives up after 30 seconds, in the time limit's own words", async () => {
    vi.useFakeTimers();
    const neverAnswers: Fetcher = (signal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    const { result } = setup(neverAnswers);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current).toMatchObject({ loading: false, error: LOAD_TIMEOUT_MESSAGE });
  });

  it("drops an answer that is no longer the latest request, success or failure, and stays refreshing until the newest is in", async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce("rows A").mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = setup(fetcher);
    await settle();
    act(() => {
      void result.current.reload();
      void result.current.reload();
    });

    await act(async () => older.resolve("rows from the older request"));
    // The older one is dropped, and the newer is still on its way.
    expect(result.current).toMatchObject({ data: "rows A", refreshing: true });
    await act(async () => newer.resolve("rows B"));
    expect(result.current).toMatchObject({ data: "rows B", refreshing: false });
  });

  it("does not let an older failure put a warning over a newer answer", async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce("rows A").mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = setup(fetcher);
    await settle();
    act(() => {
      void result.current.reload();
      void result.current.reload();
    });
    await act(async () => newer.resolve("rows B"));
    await act(async () => older.reject(new ApiError(500, "boom")));
    expect(result.current).toMatchObject({ data: "rows B", refreshError: null, error: null });
  });

  it("calls onData with the newest answer only", async () => {
    const onData = vi.fn();
    const older = deferred<string>();
    const newer = deferred<string>();
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce("rows A").mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = setup(fetcher, { onData });
    await settle();
    act(() => {
      void result.current.reload();
      void result.current.reload();
    });
    await act(async () => older.resolve("older"));
    await act(async () => newer.resolve("rows B"));
    expect(onData.mock.calls.map((call) => call[0])).toEqual(["rows A", "rows B"]);
  });

  it("does nothing when there is nothing to load for this viewer", async () => {
    const fetcher = vi.fn<Fetcher>(async () => "rows");
    const { result } = setup(fetcher, { enabled: false });
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ loading: false, data: null });
  });

  it("abandons a reload started by an action too when the page is left", async () => {
    const signals: AbortSignal[] = [];
    const reloading = deferred<string>();
    const fetcher = vi.fn<Fetcher>((signal) => {
      signals.push(signal);
      return signals.length === 1 ? Promise.resolve("rows A") : reloading.promise;
    });
    const { result, unmount } = setup(fetcher);
    await settle();
    act(() => {
      void result.current.reload();
    });
    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(false);
    unmount();
    expect(signals[1]?.aborted).toBe(true);
  });

  it("abandons the request when the page is left, and reports nothing afterwards", async () => {
    const first = deferred<string>();
    let signal: AbortSignal | undefined;
    const onData = vi.fn();
    const { unmount } = setup(
      (s) => {
        signal = s;
        return first.promise;
      },
      { onData },
    );
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => first.resolve("late"));
    expect(onData).not.toHaveBeenCalled();
  });

  it("reloads what the list shows now when the handler that asks for it was made for an older query", async () => {
    const queryA = vi.fn(async () => "rows A");
    const queryB = vi.fn(async () => "rows B");
    const { result, rerender } = setup(queryA);
    await settle();
    // A dialog opened while the list showed query A, and finishes after the list has moved on to query B.
    const handlerMadeForA = result.current.reload;
    rerender({ fetcher: queryB });
    await settle();
    expect(queryB).toHaveBeenCalledTimes(1);

    await act(async () => handlerMadeForA());
    expect(queryA).toHaveBeenCalledTimes(1);
    expect(queryB).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe("rows B");
  });

  it("replaces the rows of the previous query with the error when a reload that took over from a changed query fails", async () => {
    const queryA = vi.fn(async () => "rows A");
    const slowB = deferred<string>();
    const queryB = vi.fn(() => slowB.promise);
    const { result, rerender } = setup(queryA);
    await settle();
    expect(result.current.data).toBe("rows A");

    // Query B is on its way when an action asks for a reload: it supersedes B's request, and then it fails.
    rerender({ fetcher: queryB });
    await settle();
    expect(result.current.refreshing).toBe(true);
    const failing = deferred<string>();
    queryB.mockReturnValueOnce(failing.promise);
    act(() => {
      void result.current.reload();
    });
    await act(async () => failing.reject(new Error("network down")));
    expect(result.current.error).toBe("Could not load the list.");
    expect(result.current.refreshError).toBeNull();
    expect(result.current.refreshing).toBe(false);
  });

  it("replaces rows that may be wrong with the error when a reload that was told not to keep them fails, and keeps them blocked until then", async () => {
    const reloading = deferred<string>();
    const fetcher = vi.fn().mockResolvedValueOnce("rows A").mockReturnValueOnce(reloading.promise);
    const { result } = setup(fetcher);
    await settle();

    act(() => {
      void result.current.reload({ keepRowsOnFailure: false });
    });
    expect(result.current).toMatchObject({ refreshing: true, data: "rows A", error: null });
    await act(async () => reloading.reject(new Error("network down")));
    expect(result.current.error).toBe("Could not load the list.");
    expect(result.current.refreshError).toBeNull();
    expect(result.current.refreshing).toBe(false);
  });

  it("drops an earlier warning that the rows may be older when a later reload takes the rows away with the error", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("rows A")
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"));
    const { result } = setup(fetcher);
    await settle();
    await act(async () => result.current.reload());
    expect(result.current.refreshError).toMatch(/may show older details/);

    await act(async () => result.current.reload({ keepRowsOnFailure: false }));
    expect(result.current.error).toBe("Could not load the list.");
    expect(result.current.refreshError).toBeNull();
  });

  it("shows what an action has confirmed before its refresh, reports it like an answer, and keeps it when the refresh fails", async () => {
    const onData = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce("rows A").mockRejectedValueOnce(new Error("network down"));
    const { result } = setup(fetcher, { onData });
    await settle();

    act(() => result.current.update((current) => `${current} without one`));
    expect(result.current.data).toBe("rows A without one");
    expect(onData).toHaveBeenLastCalledWith("rows A without one");

    await act(async () => result.current.reload());
    expect(result.current.data).toBe("rows A without one");
    expect(result.current.refreshError).toMatch(/may show older details/);
    expect(result.current.error).toBeNull();
  });

  it("lets the answer of the refresh that follows replace what was applied", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce("rows A").mockResolvedValueOnce("rows A, as the server has them");
    const { result } = setup(fetcher);
    await settle();
    act(() => result.current.update(() => "rows A, edited here"));
    await act(async () => result.current.reload());
    expect(result.current.data).toBe("rows A, as the server has them");
  });

  it("applies nothing before the first answer", async () => {
    const first = deferred<string>();
    const onData = vi.fn();
    const { result } = setup(() => first.promise, { onData });
    const change = vi.fn((current: string) => current);
    act(() => result.current.update(change));
    expect(change).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("shows nothing loading when the viewer stops needing the list while it is on its way", async () => {
    const first = deferred<string>();
    const fetcher: Fetcher = () => first.promise;
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useListLoad({ fetcher, fallback: "Could not load the list.", enabled }),
      { initialProps: { enabled: true } },
    );
    expect(result.current.loading).toBe(true);

    rerender({ enabled: false });
    await settle();
    expect(result.current).toMatchObject({ loading: false, refreshing: false, data: null, error: null });
    await act(async () => first.resolve("late"));
    expect(result.current.data).toBeNull();
  });
});

describe("useListLoad poll (the live refresh of a list)", () => {
  it("replaces the answer on screen with the newest one without a sign of it: no loading, no refreshing", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce("rows A");
    const { result } = setup(fetcher);
    await settle();

    const tick = deferred<string>();
    fetcher.mockReturnValueOnce(tick.promise);
    act(() => {
      void result.current.poll();
    });
    expect(result.current).toMatchObject({ loading: false, refreshing: false, data: "rows A" });

    await act(async () => tick.resolve("rows B"));
    expect(result.current).toMatchObject({ loading: false, refreshing: false, data: "rows B", error: null, refreshError: null });
  });

  it("reports its answer like any other (onData) and takes it for the answer of the current query", async () => {
    const onData = vi.fn();
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce("rows A").mockResolvedValueOnce("rows B");
    const { result } = setup(fetcher, { onData });
    await settle();

    await act(async () => {
      await result.current.poll();
    });
    expect(onData).toHaveBeenLastCalledWith("rows B");

    // The rows are the current query's, so a reload that fails afterwards keeps them with a warning.
    fetcher.mockRejectedValueOnce(new ApiError(500, "boom"));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current).toMatchObject({ data: "rows B", error: null });
    expect(result.current.refreshError).toBeTruthy();
  });

  it("does nothing while a request somebody waits for is on its way: it never takes over from a query or a reload", async () => {
    const first = deferred<string>();
    const fetcher = vi.fn<Fetcher>().mockReturnValueOnce(first.promise);
    const { result } = setup(fetcher);
    await act(async () => {
      await result.current.poll();
    });
    // The first load is still on its way: no second request, and its answer is not dropped.
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve("rows A"));
    expect(result.current).toMatchObject({ loading: false, data: "rows A" });

    const reloading = deferred<string>();
    fetcher.mockReturnValueOnce(reloading.promise);
    act(() => {
      void result.current.reload();
    });
    await act(async () => {
      await result.current.poll();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => reloading.resolve("rows B"));
    expect(result.current).toMatchObject({ refreshing: false, data: "rows B" });
  });

  it("does not start a second tick while the previous one is on its way, and applies the slow one's answer when it comes", async () => {
    const slow = deferred<string>();
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce("rows A").mockReturnValueOnce(slow.promise);
    const { result } = setup(fetcher);
    await settle();

    act(() => {
      void result.current.poll();
    });
    await act(async () => {
      await result.current.poll();
      await result.current.poll();
    });
    // The two later ticks wait for the first: no request piles up, and the first is not made stale by them.
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(async () => slow.resolve("rows B"));
    expect(result.current).toMatchObject({ data: "rows B", error: null });
  });

  it("ticks again once the previous tick has ended, also when it failed", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce("rows A").mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValueOnce("rows B");
    const { result } = setup(fetcher);
    await settle();

    await act(async () => {
      await result.current.poll();
    });
    expect(result.current.data).toBe("rows A");
    await act(async () => {
      await result.current.poll();
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.data).toBe("rows B");
  });

  it("tells the fetcher that a request is a tick, and a read somebody waits for is not", async () => {
    const fetcher = vi.fn<Fetcher>(async () => "rows");
    const { result } = setup(fetcher);
    await settle();
    await act(async () => {
      await result.current.reload();
    });
    await act(async () => {
      await result.current.poll();
    });
    expect(fetcher.mock.calls.map((call) => (call as unknown[])[1])).toEqual([undefined, undefined, { poll: true }]);
  });

  it("ticks again once that request has ended, also when it failed (a load that was on its way)", async () => {
    const fetcher = vi.fn<Fetcher>().mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValueOnce("rows A");
    const { result } = setup(fetcher);
    await settle();
    expect(result.current.error).toBeTruthy();

    await act(async () => {
      await result.current.poll();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("ignores a failed tick: the rows stay, nothing is announced and nothing is reported", async () => {
    const onError = vi.fn();
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce("rows A").mockRejectedValueOnce(new ApiError(500, "boom"));
    const { result } = setup(fetcher, { onError });
    await settle();

    await act(async () => {
      await result.current.poll();
    });
    expect(result.current).toMatchObject({ data: "rows A", error: null, refreshError: null, loading: false, refreshing: false });
    expect(onError).not.toHaveBeenCalled();
  });

  it("brings a list that could not be read back by itself: its answer ends the error of a failed load", async () => {
    const fetcher = vi.fn<Fetcher>().mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValueOnce("rows A");
    const { result } = setup(fetcher);
    await settle();
    expect(result.current.error).toBeTruthy();

    await act(async () => {
      await result.current.poll();
    });
    expect(result.current).toMatchObject({ data: "rows A", error: null, loading: false });
    // The list is on screen again: a failing reload now keeps it.
    fetcher.mockRejectedValueOnce(new ApiError(500, "boom"));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toBe("rows A");
    expect(result.current.error).toBeNull();
  });

  it("clears the warning that the rows may be older, since its answer is fresh", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce("rows A").mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValueOnce("rows B");
    const { result } = setup(fetcher);
    await settle();
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.refreshError).toBeTruthy();

    await act(async () => {
      await result.current.poll();
    });
    expect(result.current).toMatchObject({ data: "rows B", refreshError: null });
  });

  it("drops its answer when the query changed while it was on its way", async () => {
    const tick = deferred<string>();
    const queryA = vi.fn<Fetcher>().mockResolvedValueOnce("rows A").mockReturnValueOnce(tick.promise);
    const { result, rerender } = setup(queryA);
    await settle();
    act(() => {
      void result.current.poll();
    });

    const queryB = deferred<string>();
    rerender({ fetcher: () => queryB.promise });
    await settle();
    await act(async () => tick.resolve("stale rows of the old query"));
    expect(result.current.data).toBe("rows A");

    await act(async () => queryB.resolve("rows B"));
    expect(result.current).toMatchObject({ data: "rows B", refreshing: false });
  });

  it("drops its answer when a reload began after it", async () => {
    const tick = deferred<string>();
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce("rows A").mockReturnValueOnce(tick.promise).mockResolvedValueOnce("rows C");
    const { result } = setup(fetcher);
    await settle();
    act(() => {
      void result.current.poll();
    });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toBe("rows C");

    await act(async () => tick.resolve("older rows"));
    expect(result.current.data).toBe("rows C");
  });

  it("does nothing when there is nothing to load for this viewer", async () => {
    const fetcher = vi.fn<Fetcher>(async () => "rows");
    const { result } = setup(fetcher, { enabled: false });
    await act(async () => {
      await result.current.poll();
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("is abandoned like any other request: when the page is left, and after 30 seconds, without an error", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<Fetcher>((signal) => {
      signals.push(signal);
      if (signals.length === 1) return Promise.resolve("rows A");
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    });
    const { result, unmount } = setup(fetcher);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      void result.current.poll();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
    });
    expect(signals[1]?.aborted).toBe(true);
    expect(result.current).toMatchObject({ data: "rows A", error: null });

    act(() => {
      void result.current.poll();
    });
    expect(signals[2]?.aborted).toBe(false);
    unmount();
    expect(signals[2]?.aborted).toBe(true);
  });
});

describe("useListLoad onError", () => {
  it("is called with the error of a first load, a changed query and a reload that failed, but not with one that was abandoned", async () => {
    const onError = vi.fn();
    const first = new ApiError(500, "first");
    const fetcher = vi.fn<Fetcher>().mockRejectedValueOnce(first);
    const { result, rerender } = setup(fetcher, { onError });
    await settle();
    expect(onError).toHaveBeenLastCalledWith(first);

    const second = new ApiError(502, "second");
    rerender({ fetcher: () => Promise.reject(second) });
    await settle();
    expect(onError).toHaveBeenLastCalledWith(second);

    const third = new ApiError(503, "third");
    const queryC = vi.fn<Fetcher>().mockResolvedValueOnce("rows C").mockRejectedValueOnce(third);
    rerender({ fetcher: queryC });
    await settle();
    await act(async () => {
      await result.current.reload();
    });
    expect(onError).toHaveBeenLastCalledWith(third);
    expect(onError).toHaveBeenCalledTimes(3);

    // A request that a newer one took over from reports nothing.
    const older = deferred<string>();
    const newer = deferred<string>();
    rerender({ fetcher: () => older.promise });
    await settle();
    rerender({ fetcher: () => newer.promise });
    await settle();
    await act(async () => older.reject(new ApiError(500, "abandoned")));
    expect(onError).toHaveBeenCalledTimes(3);
  });
});
