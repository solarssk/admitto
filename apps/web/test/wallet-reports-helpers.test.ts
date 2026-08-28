import { describe, expect, it } from "vitest";
import {
  bucketForDays,
  classifyPassPlatform,
  confirmedPlatformLabel,
  computeTapDays,
} from "../src/admin/reports-routes.js";

describe("classifyPassPlatform", () => {
  it("classifies an apple-only registration", () => {
    expect(classifyPassPlatform(1, 0)).toBe("apple_only");
  });

  it("classifies a google-only registration", () => {
    expect(classifyPassPlatform(0, 1)).toBe("google_only");
  });

  it("classifies a pass active on both platforms as both, not apple_only", () => {
    expect(classifyPassPlatform(1, 1)).toBe("both");
  });

  it("classifies a pass with no active registration on either platform as none", () => {
    expect(classifyPassPlatform(0, 0)).toBe("none");
  });

  it("treats any positive count as active, not just 1", () => {
    expect(classifyPassPlatform(3, 0)).toBe("apple_only");
    expect(classifyPassPlatform(0, 5)).toBe("google_only");
  });
});

describe("confirmedPlatformLabel", () => {
  it("mirrors classifyPassPlatform's four cases with their display labels", () => {
    expect(confirmedPlatformLabel(1, 0)).toBe("Apple");
    expect(confirmedPlatformLabel(0, 1)).toBe("Google");
    expect(confirmedPlatformLabel(1, 1)).toBe("Both");
    expect(confirmedPlatformLabel(0, 0)).toBe("None");
  });
});

describe("computeTapDays", () => {
  const sentAt = new Date("2026-01-01T00:00:00.000Z");

  it("returns null when the email was never sent", () => {
    expect(computeTapDays(null, new Date("2026-01-02T00:00:00.000Z"))).toBeNull();
    expect(computeTapDays(undefined, new Date("2026-01-02T00:00:00.000Z"))).toBeNull();
  });

  it("returns null when the pass was never issued", () => {
    expect(computeTapDays(sentAt, null)).toBeNull();
  });

  it("returns 0 for a tap at the exact moment the email was sent", () => {
    expect(computeTapDays(sentAt, sentAt)).toBe(0);
  });

  it("returns a fractional day count for a same-day tap, not rounded to a whole day", () => {
    expect(computeTapDays(sentAt, new Date("2026-01-01T18:00:00.000Z"))).toBeCloseTo(0.75);
  });

  it("returns the day count for a later tap", () => {
    expect(computeTapDays(sentAt, new Date("2026-01-04T00:00:00.000Z"))).toBe(3);
  });

  it("returns null instead of a negative value when the pass predates the email (clock skew or bad data)", () => {
    expect(computeTapDays(sentAt, new Date("2025-12-31T00:00:00.000Z"))).toBeNull();
  });
});

describe("bucketForDays", () => {
  it("buckets same-day (under 1 day) taps", () => {
    expect(bucketForDays(0)).toBe("same_day");
    expect(bucketForDays(0.99)).toBe("same_day");
  });

  it("buckets 1-3 day taps", () => {
    expect(bucketForDays(1)).toBe("1_3");
    expect(bucketForDays(3)).toBe("1_3");
  });

  it("buckets 4-7 day taps", () => {
    expect(bucketForDays(4)).toBe("4_7");
    expect(bucketForDays(7)).toBe("4_7");
  });

  it("buckets anything over 7 days as 8_plus", () => {
    expect(bucketForDays(8)).toBe("8_plus");
    expect(bucketForDays(30)).toBe("8_plus");
  });
});
