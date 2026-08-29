import { describe, expect, it } from "vitest";
import {
  aggregateWalletPasses,
  bucketForDays,
  buildWalletExportCsvRow,
  classifyPassPlatform,
  confirmedPlatformLabel,
  computeTapDays,
} from "../src/admin/reports-routes.js";

const BOTH_ENABLED = { apple: true, google: true };

function pass(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    issued_at: new Date("2026-01-01T00:00:00.000Z"),
    status: "active",
    apple_active_registrations: 0,
    google_active_registrations: 0,
    registration_checked_at: null,
    attendee: { ticket_type: "General", email_deliveries: [] },
    ...overrides,
  };
}

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

describe("aggregateWalletPasses — enabledPlatforms gating", () => {
  it("counts a pass active on both platforms as both when both are enabled", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 1, google_active_registrations: 1 })],
      BOTH_ENABLED,
    );
    expect(result.both).toBe(1);
    expect(result.appleOnly).toBe(0);
    expect(result.googleOnly).toBe(0);
    expect(result.confirmed).toBe(1);
  });

  it("reclassifies a both-active pass as apple_only when Google is disabled, not as both or google_only", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 1, google_active_registrations: 1 })],
      { apple: true, google: false },
    );
    expect(result.appleOnly).toBe(1);
    expect(result.googleOnly).toBe(0);
    expect(result.both).toBe(0);
    // Still confirmed - the pass DOES have a live Apple registration, which stays a real
    // confirmation even though Google's (also real) registration is no longer counted.
    expect(result.confirmed).toBe(1);
  });

  it("counts a Google-only pass as not confirmed at all when Google is the disabled platform", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 0, google_active_registrations: 1 })],
      { apple: true, google: false },
    );
    expect(result.confirmed).toBe(0);
    expect(result.googleOnly).toBe(0);
    expect(result.appleOnly).toBe(0);
  });

  it("counts nothing as confirmed when neither platform is enabled, regardless of raw registrations", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 1, google_active_registrations: 1 })],
      { apple: false, google: false },
    );
    expect(result.confirmed).toBe(0);
    expect(result.appleOnly).toBe(0);
    expect(result.googleOnly).toBe(0);
    expect(result.both).toBe(0);
  });
});

describe("buildWalletExportCsvRow — enabledPlatforms gating", () => {
  const catalog: never[] = [];
  const operatorMap = {};

  function exportRow(walletOverrides: Partial<Record<string, unknown>>, enabledPlatforms: { apple: boolean; google: boolean }) {
    const row = {
      name: "Jane Doe",
      email: "jane@example.com",
      ticket_type: "General",
      admitted_at: null,
      admitted_by: null,
      email_deliveries: [],
      wallet_pass: {
        status: "active",
        issued_at: new Date("2026-01-01T00:00:00.000Z"),
        voided_at: null,
        apple_active_registrations: 1,
        apple_inactive_registrations: 0,
        google_active_registrations: 1,
        google_inactive_registrations: 0,
        registration_checked_at: new Date("2026-01-02T00:00:00.000Z"),
        ...walletOverrides,
      },
    };
    const csv = buildWalletExportCsvRow(row as never, catalog, "UTC", operatorMap, enabledPlatforms);
    return csv.split(",").map((c) => c.replace(/^"|"$/g, ""));
  }

  // Columns: Name, Email, Ticket type, Wallet pass status, Pass issued at, Apple active,
  // Apple inactive, Google active, Google inactive, Confirmed platform, ...
  it("blanks the Google columns and excludes Google from Confirmed platform when Google is disabled", () => {
    const row = exportRow({}, { apple: true, google: false });
    expect(row[5]).toBe("1"); // Apple active
    expect(row[7]).toBe(""); // Google active - blanked, not "1"
    expect(row[8]).toBe(""); // Google inactive - blanked
    expect(row[9]).toBe("Apple"); // Confirmed platform - Google's registration doesn't count
  });

  it("keeps both platforms' raw columns and the Both label when both are enabled", () => {
    const row = exportRow({}, BOTH_ENABLED);
    expect(row[5]).toBe("1");
    expect(row[7]).toBe("1");
    expect(row[9]).toBe("Both");
  });

  it("still blanks a disabled platform's columns even for a never-synced pass (both reasons for blank stay independent)", () => {
    const row = exportRow({ registration_checked_at: null }, { apple: true, google: false });
    expect(row[5]).toBe(""); // Apple active - blank because unsynced, not because disabled
    expect(row[9]).toBe(""); // Confirmed platform - blank, unsynced
  });
});
