import { describe, expect, it } from "vitest";
import { zonedWallClockToUtcIso } from "../src/zonedWallClock.js";

describe("zonedWallClockToUtcIso", () => {
  it("resolves a plain wall-clock time with no DST involved (UTC)", () => {
    expect(zonedWallClockToUtcIso("2026-06-28", "00:00:00.000", "UTC")).toBe(
      "2026-06-28T00:00:00.000Z",
    );
  });

  it("resolves standard-offset zones with no transition on the date", () => {
    expect(zonedWallClockToUtcIso("2026-06-15", "00:00:00.000", "America/New_York")).toBe(
      "2026-06-15T04:00:00.000Z",
    );
    expect(zonedWallClockToUtcIso("2026-06-15", "00:00:00.000", "Europe/Warsaw")).toBe(
      "2026-06-14T22:00:00.000Z",
    );
    expect(zonedWallClockToUtcIso("2026-01-15", "00:00:00.000", "America/New_York")).toBe(
      "2026-01-15T05:00:00.000Z",
    );
  });

  it("resolves the earliest valid instant when the requested wall-clock time is skipped by a spring-forward transition", () => {
    // Africa/Cairo sprang forward at local midnight on 2023-04-28 - "2023-04-28T00:00:00" never
    // existed locally; the correct resolution is the first instant on/after it, not the naive
    // single-pass guess (which historically landed a full hour into 2023-04-27 instead).
    expect(zonedWallClockToUtcIso("2023-04-28", "00:00:00.000", "Africa/Cairo")).toBe(
      "2023-04-27T22:00:00.000Z",
    );
    expect(zonedWallClockToUtcIso("2023-04-27", "23:59:59.999", "Africa/Cairo")).toBe(
      "2023-04-27T21:59:59.999Z",
    );
  });

  it("resolves both bounds of a same-day range straddling a spring-forward transition to the correct offset on each side", () => {
    // America/New_York springs forward on 2026-03-08: 02:00 EST -> 03:00 EDT (07:00Z). A naive
    // "treat the wall-clock digits as UTC, probe the offset once" approach probes both 01:00 and
    // 03:00 at their own literal UTC-reinterpreted instants (01:00Z, 03:00Z), both before the
    // real 07:00Z transition, and wrongly returns -05:00 for both - this asserts the correct
    // per-bound offset instead (start is pre-transition EST, end is post-transition EDT).
    expect(zonedWallClockToUtcIso("2026-03-08", "01:00:00.000", "America/New_York")).toBe(
      "2026-03-08T06:00:00.000Z",
    );
    expect(zonedWallClockToUtcIso("2026-03-08", "03:00:00.000", "America/New_York")).toBe(
      "2026-03-08T07:00:00.000Z",
    );
  });
});
