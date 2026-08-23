import { describe, expect, it } from "vitest";
import {
  countDeliveryOutcomes,
  deliveryHistoryIcon,
  formatDeliveryHistoryTime,
  formatDeliveryHistoryTimeParts,
  rowTimestamp,
} from "../../src/communication/delivery-format.js";
import { formatEventDate, formatEventDateTime, formatEventTime } from "../../src/utils/event-dates.js";

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

describe("formatDeliveryHistoryTimeParts", () => {
  const iso = "2026-01-05T09:31:05.000Z";

  it("returns null when the timestamp is absent", () => {
    expect(formatDeliveryHistoryTimeParts(null, "Europe/Warsaw", "Europe/Warsaw")).toBeNull();
  });

  it("prefers the actor client timezone over the event timezone", () => {
    expect(formatDeliveryHistoryTimeParts(iso, "Asia/Kolkata", "Europe/Warsaw")).toEqual({
      date: formatEventDate(iso, "Asia/Kolkata"),
      time: formatEventTime(iso, "Asia/Kolkata"),
    });
  });

  it("falls back to the event timezone when client_timezone is missing", () => {
    expect(formatDeliveryHistoryTimeParts(iso, null, "Europe/Warsaw")).toEqual({
      date: formatEventDate(iso, "Europe/Warsaw"),
      time: formatEventTime(iso, "Europe/Warsaw"),
    });
  });
});

describe("deliveryHistoryIcon", () => {
  it("uses a ticket for the initial send and mail-forward for resends", () => {
    expect(deliveryHistoryIcon("initial")).toBe("ticket");
    expect(deliveryHistoryIcon("resend")).toBe("mail-forward");
    expect(deliveryHistoryIcon("anything-else")).toBe("ticket");
  });

  it("uses mail-exclamation for bounced, failed, and rejected regardless of purpose", () => {
    expect(deliveryHistoryIcon("initial", "bounced")).toBe("mail-exclamation");
    expect(deliveryHistoryIcon("resend", "failed")).toBe("mail-exclamation");
    expect(deliveryHistoryIcon("resend", "rejected")).toBe("mail-exclamation");
    expect(deliveryHistoryIcon("resend", "sent")).toBe("mail-forward");
  });
});

describe("countDeliveryOutcomes", () => {
  it("counts accepted/sent/delivered as sent and bounced separately", () => {
    expect(
      countDeliveryOutcomes([
        { status: "sent" },
        { status: "accepted" },
        { status: "delivered" },
        { status: "bounced" },
        { status: "failed" },
        { status: "queued" },
      ]),
    ).toEqual({ sent: 3, bounced: 1 });
  });

  it("returns zeros for an empty list", () => {
    expect(countDeliveryOutcomes([])).toEqual({ sent: 0, bounced: 0 });
  });
});
