import { describe, expect, it } from "vitest";
import { parseOffsetInstant } from "../src/offset-instant.js";

describe("parseOffsetInstant", () => {
  it.each([
    ["2026-09-25T12:00:00Z", "2026-09-25T12:00:00.000Z"],
    ["2026-09-25T12:00:00+02:00", "2026-09-25T10:00:00.000Z"],
    ["2026-09-25T12:00:00-05:00", "2026-09-25T17:00:00.000Z"],
    ["2026-09-25T12:00:00+0530", "2026-09-25T06:30:00.000Z"],
    ["2026-09-25T12:00:00+02", "2026-09-25T10:00:00.000Z"],
    ["2026-09-25T12:00+02:00", "2026-09-25T10:00:00.000Z"],
    ["2026-09-25 12:00:00+02:00", "2026-09-25T10:00:00.000Z"],
    ["2026-09-25T00:30:00+14:00", "2026-09-24T10:30:00.000Z"],
    ["  2026-09-25T12:00:00Z  ", "2026-09-25T12:00:00.000Z"],
  ])("reads %s as the instant %s", (raw, iso) => {
    expect(parseOffsetInstant(raw)?.toISOString()).toBe(iso);
  });

  it("keeps fractional seconds to the millisecond, however they are written", () => {
    expect(parseOffsetInstant("2026-09-25T12:00:00.5Z")?.toISOString()).toBe("2026-09-25T12:00:00.500Z");
    expect(parseOffsetInstant("2026-09-25T12:00:00.05Z")?.toISOString()).toBe("2026-09-25T12:00:00.050Z");
    expect(parseOffsetInstant("2026-09-25T12:00:00.123456Z")?.toISOString()).toBe("2026-09-25T12:00:00.123Z");
  });

  it("accepts a real leap day", () => {
    expect(parseOffsetInstant("2028-02-29T12:00:00Z")?.toISOString()).toBe("2028-02-29T12:00:00.000Z");
  });

  it.each([
    "2026-09-25 23:59",
    "2026-09-25 23:59:00",
    "2026-09-25T23:59:00",
    "2026-09-25",
  ])("never guesses a timezone for the naive value %s", (raw) => {
    expect(parseOffsetInstant(raw)).toBeNull();
  });

  it.each([
    ["Feb 30, which JavaScript would roll into March", "2026-02-30T10:00:00Z"],
    ["Feb 29 in a non-leap year", "2026-02-29T10:00:00Z"],
    ["month 13", "2026-13-01T10:00:00Z"],
    ["day 0", "2026-09-00T10:00:00Z"],
    ["hour 24, which JavaScript would roll into the next day", "2026-09-25T24:00:00Z"],
    ["minute 60", "2026-09-25T23:60:00Z"],
    ["second 60", "2026-09-25T23:59:60Z"],
    ["an offset beyond +18:00", "2026-09-25T12:00:00+19:00"],
    ["offset minutes 60", "2026-09-25T12:00:00+02:60"],
    ["a two-digit year", "0050-09-25T12:00:00Z"],
    ["a fraction without seconds", "2026-09-25T12:00.5Z"],
    ["a bare dot with no fraction digits", "2026-09-25T12:00:00.Z"],
    ["one-digit seconds", "2026-09-25T12:00:5Z"],
    ["a string longer than any real timestamp", `2026-09-25T12:00:00.${"1".repeat(80)}Z`],
    ["trailing text after the offset", "2026-09-25T12:00:00Z extra"],
  ])("rejects %s", (_label, raw) => {
    expect(parseOffsetInstant(raw)).toBeNull();
  });

  it.each(["", "tomorrow", "2026-09-25T12:00:00 UTC", "25/09/2026 12:00 +02:00"])(
    "returns null for something that is not a date-time at all: %j",
    (raw) => {
      expect(parseOffsetInstant(raw)).toBeNull();
    },
  );
});
