import { describe, expect, it } from "vitest";
import { formatEventDate } from "../src/formatEventDate.js";

describe("formatEventDate", () => {
  it("formats calendar day in the given timezone, not UTC slice", () => {
    // 2026-10-01 00:00 in Europe/Warsaw (CEST, UTC+2)
    const instant = new Date("2026-09-30T22:00:00.000Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(formatEventDate(instant, "Europe/Warsaw")).toBe("2026-10-01");
    expect(formatEventDate(instant, "UTC")).toBe("2026-09-30");
  });

  it("returns YYYY-MM-DD for UTC noon events", () => {
    expect(formatEventDate(new Date("2026-09-01T12:00:00.000Z"), "UTC")).toBe("2026-09-01");
  });
});
