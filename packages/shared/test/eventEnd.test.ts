import { describe, expect, it } from "vitest";
import { eventEndsAtUtc, isWalletAddClosed } from "../src/eventEnd.js";

// `date` is the display-only sentinel anchored at noon UTC.
const day = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T12:00:00.000Z`);

describe("eventEndsAtUtc", () => {
  it("ends at eventHoursEnd on the event's day, in the event's own timezone", () => {
    // Warsaw is UTC+2 in September: 18:00 local is 16:00Z.
    expect(
      eventEndsAtUtc({ date: day("2026-09-01"), eventHoursStart: "10:00", eventHoursEnd: "18:00", timezone: "Europe/Warsaw" }).toISOString(),
    ).toBe("2026-09-01T16:00:00.000Z");
  });

  it("ends at the next local midnight when there is no end time", () => {
    expect(
      eventEndsAtUtc({ date: day("2026-09-01"), eventHoursStart: null, eventHoursEnd: null, timezone: "Europe/Warsaw" }).toISOString(),
    ).toBe("2026-09-01T22:00:00.000Z");
    expect(
      eventEndsAtUtc({ date: day("2026-09-01"), eventHoursStart: "10:00", eventHoursEnd: null, timezone: "UTC" }).toISOString(),
    ).toBe("2026-09-02T00:00:00.000Z");
  });

  it("ends on the day after `date` when the end is earlier than the start (overnight event)", () => {
    expect(
      eventEndsAtUtc({ date: day("2026-09-01"), eventHoursStart: "20:00", eventHoursEnd: "02:00", timezone: "UTC" }).toISOString(),
    ).toBe("2026-09-02T02:00:00.000Z");
  });

  it("keeps the same day when there is an end time but no start time", () => {
    expect(
      eventEndsAtUtc({ date: day("2026-09-01"), eventHoursStart: null, eventHoursEnd: "02:00", timezone: "UTC" }).toISOString(),
    ).toBe("2026-09-01T02:00:00.000Z");
  });

  it("treats an equal start and end as the same day", () => {
    expect(
      eventEndsAtUtc({ date: day("2026-09-01"), eventHoursStart: "10:00", eventHoursEnd: "10:00", timezone: "UTC" }).toISOString(),
    ).toBe("2026-09-01T10:00:00.000Z");
  });

  it("ignores an end time that is not HH:mm and falls back to the end of the day", () => {
    expect(
      eventEndsAtUtc({ date: day("2026-09-01"), eventHoursStart: "10:00", eventHoursEnd: "6pm", timezone: "UTC" }).toISOString(),
    ).toBe("2026-09-02T00:00:00.000Z");
  });

  it("ignores a start time that is not HH:mm when deciding whether the event is overnight", () => {
    expect(
      eventEndsAtUtc({ date: day("2026-09-01"), eventHoursStart: "late", eventHoursEnd: "02:00", timezone: "UTC" }).toISOString(),
    ).toBe("2026-09-01T02:00:00.000Z");
  });

  it("uses the offset in force on that day (DST): the same wall clock is an hour apart in winter", () => {
    expect(
      eventEndsAtUtc({ date: day("2026-01-15"), eventHoursStart: null, eventHoursEnd: "18:00", timezone: "Europe/Warsaw" }).toISOString(),
    ).toBe("2026-01-15T17:00:00.000Z");
  });

  it("does not throw for an unknown timezone and reads it as UTC", () => {
    expect(
      eventEndsAtUtc({ date: day("2026-09-01"), eventHoursStart: null, eventHoursEnd: "18:00", timezone: "Not/AZone" }).toISOString(),
    ).toBe("2026-09-01T18:00:00.000Z");
  });

  it("has no end for an unreadable date, instead of throwing", () => {
    expect(
      Number.isNaN(eventEndsAtUtc({ date: new Date("nope"), eventHoursStart: null, eventHoursEnd: "18:00", timezone: "UTC" }).getTime()),
    ).toBe(true);
  });

  it("rolls across a month boundary for an overnight event", () => {
    expect(
      eventEndsAtUtc({ date: day("2026-09-30"), eventHoursStart: "22:00", eventHoursEnd: "01:00", timezone: "UTC" }).toISOString(),
    ).toBe("2026-10-01T01:00:00.000Z");
  });
});

describe("isWalletAddClosed", () => {
  const event = { date: day("2026-09-01"), eventHoursStart: "10:00", eventHoursEnd: "18:00", timezone: "UTC", archivedAt: null };

  it("is open before the event ends and closed from that very instant on", () => {
    expect(isWalletAddClosed(event, new Date("2026-09-01T17:59:59.999Z"))).toBe(false);
    expect(isWalletAddClosed(event, new Date("2026-09-01T18:00:00.000Z"))).toBe(true);
  });

  it("is open well before the event", () => {
    expect(isWalletAddClosed(event, new Date("2026-08-01T00:00:00.000Z"))).toBe(false);
  });

  it("is closed for an archived event even if it has not ended", () => {
    expect(isWalletAddClosed({ ...event, archivedAt: new Date("2026-08-01T00:00:00.000Z") }, new Date("2026-08-15T00:00:00.000Z"))).toBe(true);
  });

  it("never counts an unreadable date as over", () => {
    expect(isWalletAddClosed({ ...event, date: new Date("nope") }, new Date("2999-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("does not read a missing archived_at (undefined) as archived", () => {
    const withoutColumn = { ...event, archivedAt: undefined } as unknown as typeof event;
    expect(isWalletAddClosed(withoutColumn, new Date("2026-08-01T00:00:00.000Z"))).toBe(false);
  });

  it("defaults `now` to the current time", () => {
    expect(isWalletAddClosed({ ...event, date: day("2000-01-01") })).toBe(true);
    expect(isWalletAddClosed({ ...event, date: day("2999-01-01") })).toBe(false);
  });
});
