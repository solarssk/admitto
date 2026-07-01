import { afterEach, describe, expect, it, vi } from "vitest";
import { publish, resetSseChannelsForTests, subscribe, subscriberCount } from "../src/admin/sse-channel.js";

describe("sse-channel", () => {
  afterEach(() => {
    resetSseChannelsForTests();
  });

  it("delivers published events to subscribers", () => {
    const cb = vi.fn();
    subscribe("evt-1", cb);

    publish("evt-1", {
      type: "checkin",
      attendeeId: "att-1",
      attendeeName: "Ada Lovelace",
      ticketType: "VIP",
      admittedAt: "2026-07-01T12:00:00.000Z",
      operatorId: "user-1",
      deviceLabel: "Gate A",
    });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toMatchObject({ type: "checkin", attendeeId: "att-1" });
  });

  it("does not call callback after unsubscribe", () => {
    const cb = vi.fn();
    const unsub = subscribe("evt-1", cb);
    unsub();

    publish("evt-1", { type: "ping" });
    expect(cb).not.toHaveBeenCalled();
  });

  it("removes channel map entry when last subscriber unsubscribes", () => {
    const unsub = subscribe("evt-1", vi.fn());
    expect(subscriberCount("evt-1")).toBe(1);
    unsub();
    expect(subscriberCount("evt-1")).toBe(0);
  });
});
