// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEventOptions } from "../../src/hooks/useEventOptions.js";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS } from "../../src/utils/loading-timing.js";
import { deferred } from "../test-utils.js";

const fetchAdminEvents = vi.fn();
vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchAdminEvents: (...args: unknown[]) => fetchAdminEvents(...args),
}));

afterEach(() => {
  vi.useRealTimers();
  fetchAdminEvents.mockReset();
});

const settle = () => act(async () => {});
const event = (id: string) => ({ id, title: `Event ${id}` });

describe("useEventOptions", () => {
  it("offers the events, archived ones too", async () => {
    fetchAdminEvents.mockResolvedValue([event("a")]);
    const { result } = renderHook(() => useEventOptions());
    await settle();
    expect(result.current.events).toEqual([event("a")]);
    expect(result.current.error).toBeNull();
    expect(fetchAdminEvents).toHaveBeenCalledWith(expect.objectContaining({ includeArchived: true }));
  });

  it("says it failed instead of offering an empty list, and a Retry reruns only that request", async () => {
    fetchAdminEvents.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce([event("a")]);
    const { result } = renderHook(() => useEventOptions());
    await settle();
    expect(result.current.error).toBe("Could not load events.");
    expect(result.current.events).toEqual([]);

    act(() => result.current.retry());
    // The error stays on screen, with its Retry busy, until the answer is in.
    expect(result.current.error).toBe("Could not load events.");
    expect(result.current.retrying).toBe(true);
    await settle();
    expect(result.current.error).toBeNull();
    expect(result.current.events).toEqual([event("a")]);
    expect(fetchAdminEvents).toHaveBeenCalledTimes(2);
  });

  it("hands the browser to the login page for a 401 when asked to, and keeps it an error with a Retry otherwise", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchAdminEvents.mockRejectedValue(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", { configurable: true, value: { pathname: "/admin/x", assign: assignSpy } });
    try {
      const plain = renderHook(() => useEventOptions());
      await settle();
      expect(plain.result.current.error).toBe("Your session has expired. Sign in again.");
      expect(assignSpy).not.toHaveBeenCalled();

      const redirecting = renderHook(() => useEventOptions({ redirectOnUnauthorized: true }));
      await settle();
      expect(assignSpy).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fx");
      expect(redirecting.result.current.error).toBeNull();
      expect(redirecting.result.current.loading).toBe(true);
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("gives up after the time limit and says so in its words", async () => {
    vi.useFakeTimers();
    fetchAdminEvents.mockImplementation(
      (options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        }),
    );
    const { result } = renderHook(() => useEventOptions());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
    });
    expect(result.current.error).toBe(`Could not load events. ${LOAD_TIMEOUT_MESSAGE}`);
  });

  it("drops the answer of a request that a Retry has replaced, and keeps the Retry busy until its own answer is in", async () => {
    vi.useFakeTimers();
    const first = deferred<ReturnType<typeof event>[]>();
    const second = deferred<ReturnType<typeof event>[]>();
    fetchAdminEvents.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useEventOptions());
    act(() => result.current.retry());
    // Past the 400ms a busy Retry is kept for anyway: only the request's own answer can end it now.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.retrying).toBe(true);

    await act(async () => first.resolve([event("old")]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.events).toEqual([]);
    expect(result.current.retrying).toBe(true);

    await act(async () => second.resolve([event("b")]));
    expect(result.current.events).toEqual([event("b")]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.retrying).toBe(false);
  });

  it("drops the failure of a request that a Retry has replaced", async () => {
    const first = deferred<ReturnType<typeof event>[]>();
    const second = deferred<ReturnType<typeof event>[]>();
    fetchAdminEvents.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useEventOptions());
    act(() => result.current.retry());
    await act(async () => first.reject(new Error("late failure")));
    expect(result.current.error).toBeNull();

    await act(async () => second.resolve([event("b")]));
    expect(result.current.events).toEqual([event("b")]);
  });
});
