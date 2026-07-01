// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEventStream } from "../../src/hooks/useEventStream.js";

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

describe("useEventStream", () => {
  beforeEach(() => {
    instances.length = 0;
    vi.stubGlobal("EventSource", MockEventSource);
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

  it("sets auth_error after repeated failures without ever connecting", () => {
    const { result } = renderHook(() => useEventStream("evt-1", vi.fn()));

    for (let i = 0; i < 3; i++) {
      act(() => {
        instances[i]?.listeners.onerror?.();
        vi.runOnlyPendingTimers();
      });
    }

    expect(result.current.status).toBe("auth_error");
    expect(result.current.connected).toBe(false);
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(() => useEventStream("evt-1", vi.fn()));
    const first = instances[0];
    unmount();
    expect(first?.close).toHaveBeenCalled();
  });
});
