// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  probeStreamAuth,
  STREAM_BACKOFF_MS,
  useEventStream,
} from "../../src/hooks/useEventStream.js";

type ListenerMap = {
  onopen: (() => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: (() => void) | null;
};

const instances: Array<{ url: string; listeners: ListenerMap; close: ReturnType<typeof vi.fn> }> = [];

class MockEventSource {
  listeners: ListenerMap = { onopen: null, onmessage: null, onerror: null };
  close = vi.fn();

  constructor(public url: string) {
    instances.push({ url, listeners: this.listeners, close: this.close });
  }

  set onopen(fn: (() => void) | null) {
    this.listeners.onopen = fn;
  }

  set onmessage(fn: ((event: MessageEvent) => void) | null) {
    this.listeners.onmessage = fn;
  }

  set onerror(fn: (() => void) | null) {
    this.listeners.onerror = fn;
  }
}

async function flushErrorHandler() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("probeStreamAuth", () => {
  it("returns denied for 401/403", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ status: 403 });
    expect(await probeStreamAuth("evt-1", fetchFn)).toBe("denied");
    expect(await probeStreamAuth("evt-1", fetchFn)).toBe("denied");
  });

  it("returns ok for other statuses", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 503 });
    expect(await probeStreamAuth("evt-1", fetchFn)).toBe("ok");
  });

  it("aborts probe and cancels body after reading status", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve({ status: 200, body: { cancel } });
    });

    await probeStreamAuth("evt-1", fetchFn);

    expect(cancel).toHaveBeenCalled();
    const signal = fetchFn.mock.calls[0]?.[1]?.signal as AbortSignal | undefined;
    expect(signal?.aborted).toBe(true);
  });
});

describe("useEventStream", () => {
  beforeEach(() => {
    instances.length = 0;
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects to the checkin stream URL", () => {
    renderHook(() => useEventStream("evt-1", vi.fn()));
    expect(instances[0]?.url).toBe("/api/checkin/events/evt-1/stream");
  });

  it("dispatches checkin events and ignores ping", () => {
    const onCheckin = vi.fn();
    renderHook(() => useEventStream("evt-1", onCheckin));

    act(() => {
      instances[0]?.listeners.onopen?.();
      instances[0]?.listeners.onmessage?.({
        data: JSON.stringify({ type: "ping" }),
      } as MessageEvent);
      instances[0]?.listeners.onmessage?.({
        data: JSON.stringify({
          type: "checkin",
          attendeeId: "att-1",
          attendeeName: "Alex",
          ticketType: null,
          admittedAt: "2026-01-01T12:00:00.000Z",
          operatorId: null,
          deviceLabel: null,
        }),
      } as MessageEvent);
    });

    expect(onCheckin).toHaveBeenCalledTimes(1);
    expect(onCheckin.mock.calls[0]?.[0]).toMatchObject({ attendeeId: "att-1" });
  });

  it("ignores activity_changed when no onActivityChanged callback was given", () => {
    const onCheckin = vi.fn();
    expect(() => {
      renderHook(() => useEventStream("evt-1", onCheckin));
      act(() => {
        instances[0]?.listeners.onopen?.();
        instances[0]?.listeners.onmessage?.({
          data: JSON.stringify({ type: "activity_changed" }),
        } as MessageEvent);
      });
    }).not.toThrow();
    expect(onCheckin).not.toHaveBeenCalled();
  });

  it("dispatches activity_changed to onActivityChanged, not onCheckin", () => {
    const onCheckin = vi.fn();
    const onActivityChanged = vi.fn();
    renderHook(() => useEventStream("evt-1", onCheckin, onActivityChanged));

    act(() => {
      instances[0]?.listeners.onopen?.();
      instances[0]?.listeners.onmessage?.({
        data: JSON.stringify({ type: "activity_changed" }),
      } as MessageEvent);
    });

    expect(onActivityChanged).toHaveBeenCalledTimes(1);
    expect(onCheckin).not.toHaveBeenCalled();
  });

  it("sets auth_error only when the stream probe returns denied", async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 403 } as Response);
    const { result } = renderHook(() => useEventStream("evt-1", vi.fn()));

    for (let i = 0; i < 3; i++) {
      act(() => {
        instances[i]?.listeners.onerror?.();
      });
      await flushErrorHandler();
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }

    expect(result.current.status).toBe("auth_error");
    expect(result.current.connected).toBe(false);
  });

  it("keeps retrying when initial failures are not auth", async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 503 } as Response);
    const { result } = renderHook(() => useEventStream("evt-1", vi.fn()));

    for (let i = 0; i < 3; i++) {
      act(() => {
        instances[i]?.listeners.onerror?.();
      });
      await flushErrorHandler();
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }

    expect(result.current.status).not.toBe("auth_error");
    expect(instances.length).toBeGreaterThan(3);
  });

  it("backs off reconnect delays after a successful open", async () => {
    renderHook(() => useEventStream("evt-1", vi.fn()));

    act(() => {
      instances[0]?.listeners.onopen?.();
    });

    act(() => {
      instances[0]?.listeners.onerror?.();
    });
    await flushErrorHandler();
    act(() => {
      vi.advanceTimersByTime(STREAM_BACKOFF_MS[0]);
    });
    expect(instances).toHaveLength(2);

    act(() => {
      instances[1]?.listeners.onerror?.();
    });
    await flushErrorHandler();

    act(() => {
      vi.advanceTimersByTime(STREAM_BACKOFF_MS[0]);
    });
    expect(instances).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(STREAM_BACKOFF_MS[1] - STREAM_BACKOFF_MS[0]);
    });
    expect(instances).toHaveLength(3);
  });

  it("resets reconnect backoff after a later successful open", async () => {
    renderHook(() => useEventStream("evt-1", vi.fn()));

    act(() => {
      instances[0]?.listeners.onopen?.();
    });

    act(() => {
      instances[0]?.listeners.onerror?.();
    });
    await flushErrorHandler();
    act(() => {
      vi.advanceTimersByTime(STREAM_BACKOFF_MS[0]);
    });
    expect(instances).toHaveLength(2);

    act(() => {
      instances[1]?.listeners.onopen?.();
    });

    act(() => {
      instances[1]?.listeners.onerror?.();
    });
    await flushErrorHandler();

    act(() => {
      vi.advanceTimersByTime(STREAM_BACKOFF_MS[0] - 1);
    });
    expect(instances).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(instances).toHaveLength(3);
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(() => useEventStream("evt-1", vi.fn()));
    const first = instances[0];
    unmount();
    expect(first?.close).toHaveBeenCalled();
  });
});
