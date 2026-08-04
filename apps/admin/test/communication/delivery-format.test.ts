import { describe, expect, it } from "vitest";
import { deliveryHistoryIcon, formatDeliveryHistoryTime, rowTimestamp } from "../../src/communication/delivery-format.js";
import { formatEventDateTime } from "../../src/utils/event-dates.js";

describe("rowTimestamp", () => {
  it("falls all the way back to queued_at when nothing later ever happened", () => {
    expect(
      rowTimestamp({
        sent_at: null,
        accepted_at: null,
        failed_at: null,
        queued_at: "2026-09-01T11:55:00.000Z",
      }),
    ).toBe("2026-09-01T11:55:00.000Z");
  });

  it("prefers sent_at over every earlier stage", () => {
    expect(
      rowTimestamp({
        sent_at: "2026-09-01T12:10:00.000Z",
        accepted_at: "2026-09-01T12:05:00.000Z",
        failed_at: null,
        queued_at: "2026-09-01T11:55:00.000Z",
      }),
    ).toBe("2026-09-01T12:10:00.000Z");
  });
});

describe("formatDeliveryHistoryTime", () => {
  const iso = "2026-01-05T09:31:05.000Z";

  it("returns '-' when the timestamp is absent", () => {
    expect(formatDeliveryHistoryTime(null, "Europe/Warsaw", "Europe/Warsaw")).toBe("-");
  });

  it("prefers the actor client timezone over the event timezone", () => {
    expect(formatDeliveryHistoryTime(iso, "Asia/Kolkata", "Europe/Warsaw")).toBe(
      formatEventDateTime(iso, "Asia/Kolkata"),
    );
  });

  it("falls back to the event timezone when client_timezone is missing", () => {
    expect(formatDeliveryHistoryTime(iso, null, "Europe/Warsaw")).toBe(
      formatEventDateTime(iso, "Europe/Warsaw"),
    );
    expect(formatDeliveryHistoryTime(iso, null, "Europe/Warsaw")).toMatch(/UTC\+1/);
    expect(formatDeliveryHistoryTime(iso, null, "Europe/Warsaw")).not.toMatch(/ UTC$/);
  });
});

describe("deliveryHistoryIcon", () => {
  it("uses a ticket for the initial send and mail-forward for resends", () => {
    expect(deliveryHistoryIcon("initial")).toBe("ticket");
    expect(deliveryHistoryIcon("resend")).toBe("mail-forward");
    expect(deliveryHistoryIcon("anything-else")).toBe("ticket");
  });
});
