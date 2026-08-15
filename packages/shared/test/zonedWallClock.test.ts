import { afterEach, describe, expect, it, vi } from "vitest";
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

  describe("ICU data variance", () => {
    afterEach(() => vi.restoreAllMocks());

    it("treats an ICU build reporting midnight as hour '24' the same as '00'", () => {
      // Some ICU builds render local midnight as "24:00" instead of "00:00" for hour12:false -
      // readZonedWallClockAsUtcMillis normalizes that back to hour 0 (same day), not hour 24
      // (which Date.UTC would silently roll into the next day).
      const real = Intl.DateTimeFormat.prototype.formatToParts;
      vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (
        this: Intl.DateTimeFormat,
        ...args
      ) {
        const parts = real.apply(this, args);
        return parts.map((p) => (p.type === "hour" && p.value === "00" ? { ...p, value: "24" } : p));
      });
      expect(zonedWallClockToUtcIso("2026-06-28", "00:00:00.000", "UTC")).toBe(
        "2026-06-28T00:00:00.000Z",
      );
    });

    it("defaults a missing formatToParts field to 0 rather than throwing", () => {
      // Defensive fallback for an ICU build that omits a requested part entirely - shouldn't be
      // reachable with real Intl data, but must degrade to a value instead of NaN/undefined.
      const real = Intl.DateTimeFormat.prototype.formatToParts;
      vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (
        this: Intl.DateTimeFormat,
        ...args
      ) {
        return real.apply(this, args).filter((p) => p.type !== "second");
      });
      expect(zonedWallClockToUtcIso("2026-06-28", "12:30:00.000", "UTC")).toBe(
        "2026-06-28T12:30:00.000Z",
      );
    });

    it("falls back to the best-available candidate when neither correction pass converges", () => {
      // A frozen/broken formatToParts (always reports the same wall-clock reading regardless of
      // the instant queried) never lets the iterative correction converge - both the last
      // candidate and its "other" sibling read back below target, so the `.find(...)` in the
      // fallback branch finds nothing and must fall through to `options.at(-1)!` rather than
      // throwing on an empty result.
      vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([
        { type: "year", value: "2020" },
        { type: "month", value: "01" },
        { type: "day", value: "01" },
        { type: "hour", value: "00" },
        { type: "minute", value: "00" },
        { type: "second", value: "00" },
      ]);
      const result = zonedWallClockToUtcIso("2026-06-28", "12:30:00.000", "UTC");
      expect(() => new Date(result)).not.toThrow();
      expect(Number.isNaN(new Date(result).getTime())).toBe(false);
    });
  });
});
