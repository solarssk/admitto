import { afterEach, describe, expect, it, vi } from "vitest";
import { computeLabel } from "../../src/utils/event-countdown.js";

describe("computeLabel", () => {
  const TZ = "Europe/Warsaw";

  afterEach(() => vi.useRealTimers());

  it('returns "—" for null input', () => {
    expect(computeLabel(null, TZ)).toBe("—");
  });

  it('returns "Starting soon" when event is on the same calendar day', () => {
    vi.setSystemTime(new Date("2026-07-01T11:30:00Z"));
    const iso = "2026-07-01T12:00:00.000Z";
    expect(computeLabel(iso, TZ)).toBe("Starting soon");
  });

  it('returns "Today in Xh" on the same calendar day', () => {
    vi.setSystemTime(new Date("2026-07-01T07:00:00Z")); // 09:00 CEST
    const iso = "2026-07-01T12:00:00.000Z";
    expect(computeLabel(iso, TZ)).toBe("Today in 5h");
  });

  it('returns "Tomorrow" at midnight boundary (calendar day, not 24h bucket)', () => {
    vi.setSystemTime(new Date("2026-07-01T21:30:00Z")); // 23:30 CEST on July 1
    const iso = "2026-07-02T12:00:00.000Z"; // July 2 event (UTC noon storage)
    expect(computeLabel(iso, TZ)).toBe("Tomorrow");
  });

  it('returns "Ended yesterday" across midnight boundary', () => {
    vi.setSystemTime(new Date("2026-07-02T22:30:00Z")); // 00:30 CEST on July 3
    const iso = "2026-07-02T12:00:00.000Z"; // July 2 event
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
