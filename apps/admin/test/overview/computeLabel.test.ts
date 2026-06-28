import { afterEach, describe, expect, it, vi } from "vitest";
import { computeLabel } from "../../src/utils/event-countdown.js";

describe("computeLabel", () => {
  const TZ = "Europe/Warsaw";

  afterEach(() => vi.useRealTimers());

  it('returns "—" for null input', () => {
    expect(computeLabel(null, TZ)).toBe("—");
  });

  it('returns "Starting soon" when event is within the hour on the same calendar day', () => {
    vi.setSystemTime(new Date("2026-07-01T07:00:00Z")); // 09:00 CEST
    const iso = "2026-07-01T07:05:00.000Z"; // 09:05 CEST
    expect(computeLabel(iso, TZ)).toBe("Starting soon");
  });

  it('returns "Today in Xh" on the same calendar day', () => {
    vi.setSystemTime(new Date("2026-07-01T07:00:00Z")); // 09:00 CEST
    const iso = "2026-07-01T14:00:00.000Z"; // 16:00 CEST
    expect(computeLabel(iso, TZ)).toBe("Today in 7h");
  });

  it('returns "Tomorrow" at midnight boundary (not 24h bucket)', () => {
    vi.setSystemTime(new Date("2026-07-01T21:30:00Z")); // 23:30 CEST
    const iso = "2026-07-01T23:00:00.000Z"; // 01:00 CEST next day
    expect(computeLabel(iso, TZ)).toBe("Tomorrow");
  });

  it('returns "Ended yesterday" across midnight boundary', () => {
    vi.setSystemTime(new Date("2026-07-02T22:30:00Z")); // 00:30 CEST on Jul 3
    const iso = "2026-07-02T21:00:00.000Z"; // 23:00 CEST on Jul 2
    expect(computeLabel(iso, TZ)).toBe("Ended yesterday");
  });

  it('returns "In N days" within a week', () => {
    vi.setSystemTime(new Date("2026-07-01T07:00:00Z"));
    const iso = "2026-07-05T12:00:00.000Z";
    expect(computeLabel(iso, TZ)).toBe("In 4 days");
  });

  it("returns formatted date when more than 7 days away", () => {
    vi.setSystemTime(new Date("2026-07-01T07:00:00Z"));
    const iso = "2026-07-15T12:00:00.000Z";
    expect(computeLabel(iso, TZ)).toMatch(/15 Jul 2026|Jul 15, 2026/);
  });
});
