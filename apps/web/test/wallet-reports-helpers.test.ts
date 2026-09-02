import { describe, expect, it } from "vitest";
import type { TicketTypeInfo } from "@admitto/tickets";
import {
  aggregateWalletPasses,
  bucketForDays,
  bucketForRegistrationCount,
  buildWalletExportCsvRow,
  buildWalletTicketTypeBreakdown,
  classifyPassLifecycle,
  classifyPassPlatform,
  confirmedPlatformLabel,
  computeTapDays,
  earliestDeliverySuccessAt,
} from "../src/admin/reports-routes.js";

function ticketType(overrides: Partial<TicketTypeInfo> = {}): TicketTypeInfo {
  return { id: "tt-1", key: "general", label: "General", color: "gray", sort_order: 0, ...overrides };
}

const BOTH_ENABLED = { apple: true, google: true };

function pass(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    issued_at: new Date("2026-01-01T00:00:00.000Z"),
    first_confirmed_at: null,
    status: "active",
    apple_active_registrations: 0,
    google_active_registrations: 0,
    apple_inactive_registrations: 0,
    google_inactive_registrations: 0,
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

describe("classifyPassLifecycle", () => {
  it("classifies an apple-active pass as active", () => {
    expect(classifyPassLifecycle(1, 0, 0, 0)).toBe("active");
  });

  it("classifies a google-active pass as active", () => {
    expect(classifyPassLifecycle(0, 1, 0, 0)).toBe("active");
  });

  it("classifies a pass with an inactive registration on apple and nothing active as removed", () => {
    expect(classifyPassLifecycle(0, 0, 1, 0)).toBe("removed");
  });

  it("classifies a pass with an inactive registration on google and nothing active as removed", () => {
    expect(classifyPassLifecycle(0, 0, 0, 1)).toBe("removed");
  });

  it("classifies a pass with inactive registrations on both platforms and nothing active as removed", () => {
    expect(classifyPassLifecycle(0, 0, 1, 1)).toBe("removed");
  });

  it("classifies a pass with no registration of any kind as never_installed", () => {
    expect(classifyPassLifecycle(0, 0, 0, 0)).toBe("never_installed");
  });

  // The one correctness risk this function exists to get right: an attendee can have an active
  // registration on one device and an unrelated inactive registration left over from a different,
  // since-removed device - that pass is still genuinely in use, not "removed".
  it("classifies a pass active on apple with an inactive registration on the SAME platform (a second, removed device) as active, not removed", () => {
    expect(classifyPassLifecycle(1, 0, 1, 0)).toBe("active");
  });

  it("classifies a pass active on apple with an inactive registration on the OTHER platform (google) as active, not removed", () => {
    expect(classifyPassLifecycle(1, 0, 0, 1)).toBe("active");
  });

  it("classifies a pass active on google with an inactive registration on apple as active, not removed", () => {
    expect(classifyPassLifecycle(0, 1, 1, 0)).toBe("active");
  });

  it("classifies a pass active on both platforms with inactive registrations on both as active, not removed", () => {
    expect(classifyPassLifecycle(1, 1, 1, 1)).toBe("active");
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

describe("earliestDeliverySuccessAt", () => {
  const accepted = new Date("2026-01-01T00:00:00.000Z");
  const sent = new Date("2026-01-02T00:00:00.000Z");
  const delivered = new Date("2026-01-03T00:00:00.000Z");

  it("returns null with no deliveries", () => {
    expect(earliestDeliverySuccessAt([])).toBeNull();
  });

  it("reads accepted_at ahead of sent_at/delivered_at - the only timestamp any configured mailer adapter actually sets", () => {
    expect(earliestDeliverySuccessAt([{ accepted_at: accepted, sent_at: sent, delivered_at: delivered }])).toEqual(
      accepted,
    );
  });

  it("falls back to sent_at when accepted_at is missing on that delivery", () => {
    expect(earliestDeliverySuccessAt([{ accepted_at: null, sent_at: sent, delivered_at: delivered }])).toEqual(sent);
  });

  it("falls back to delivered_at when neither accepted_at nor sent_at is set", () => {
    expect(earliestDeliverySuccessAt([{ accepted_at: null, sent_at: null, delivered_at: delivered }])).toEqual(
      delivered,
    );
  });

  it("returns null when a delivery has no timestamp at all", () => {
    expect(earliestDeliverySuccessAt([{ accepted_at: null, sent_at: null, delivered_at: null }])).toBeNull();
  });

  it("takes the minimum across multiple deliveries (initial + resend), not just the first array entry", () => {
    const laterResend = { accepted_at: new Date("2026-01-10T00:00:00.000Z"), sent_at: null, delivered_at: null };
    const earlierInitial = { accepted_at: accepted, sent_at: null, delivered_at: null };
    expect(earliestDeliverySuccessAt([laterResend, earlierInitial])).toEqual(accepted);
  });
});

describe("buildWalletTicketTypeBreakdown", () => {
  it("falls back to 0 confirmed for a catalog type with no confirmed installs, distinct from its issued (got_pass) count", () => {
    const catalog = [ticketType({ key: "vip", label: "VIP" })];
    const totalByType = new Map([["vip", 5]]);
    const gotPassByType = new Map([["vip", 4]]); // issued, but...
    const confirmedByType = new Map<string | null, number>(); // ...none of those 4 ever installed
    const [row] = buildWalletTicketTypeBreakdown(catalog, totalByType, gotPassByType, confirmedByType);
    expect(row).toMatchObject({ key: "vip", total: 5, got_pass: 4, confirmed: 0, confirmed_pct: 0 });
  });

  it("falls back to 0 confirmed for the (none) bucket when no untyped attendee has installed", () => {
    const totalByType = new Map<string | null, number>([[null, 3]]);
    const gotPassByType = new Map<string | null, number>([[null, 2]]);
    const confirmedByType = new Map<string | null, number>(); // no untyped attendee installed
    const rows = buildWalletTicketTypeBreakdown([], totalByType, gotPassByType, confirmedByType);
    expect(rows).toContainEqual(
      expect.objectContaining({ key: null, type: "(none)", total: 3, got_pass: 2, confirmed: 0, confirmed_pct: 0 }),
    );
  });

  it("falls back to 0 confirmed for a (not in catalog) key when no attendee of that stale type has installed", () => {
    const totalByType = new Map<string | null, number>([["retired", 2]]);
    const gotPassByType = new Map<string | null, number>([["retired", 1]]);
    const confirmedByType = new Map<string | null, number>(); // none of the "retired"-type attendees installed
    const rows = buildWalletTicketTypeBreakdown([], totalByType, gotPassByType, confirmedByType);
    expect(rows).toContainEqual(
      expect.objectContaining({
        key: "retired",
        type: "(not in catalog)",
        total: 2,
        got_pass: 1,
        confirmed: 0,
        confirmed_pct: 0,
      }),
    );
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

describe("bucketForRegistrationCount", () => {
  it("buckets 1 (and, defensively, 0) as \"1\"", () => {
    expect(bucketForRegistrationCount(1)).toBe("1");
    expect(bucketForRegistrationCount(0)).toBe("1");
  });

  it("buckets 2 as \"2\"", () => {
    expect(bucketForRegistrationCount(2)).toBe("2");
  });

  it("buckets 3 as \"3\"", () => {
    expect(bucketForRegistrationCount(3)).toBe("3");
  });

  it("buckets anything over 3 as 4_plus", () => {
    expect(bucketForRegistrationCount(4)).toBe("4_plus");
    expect(bucketForRegistrationCount(10)).toBe("4_plus");
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

describe("aggregateWalletPasses — registrationCountBuckets", () => {
  it("sums apple + google active registrations per pass into the right bucket", () => {
    const result = aggregateWalletPasses(
      [
        pass({ apple_active_registrations: 1, google_active_registrations: 0 }), // 1
        pass({ apple_active_registrations: 2, google_active_registrations: 1 }), // 3
        pass({ apple_active_registrations: 0, google_active_registrations: 2 }), // 2
        pass({ apple_active_registrations: 3, google_active_registrations: 3 }), // 6 -> 4_plus
      ],
      BOTH_ENABLED,
    );
    expect(result.registrationCountBuckets).toEqual({ "1": 1, "2": 1, "3": 1, "4_plus": 1 });
  });

  it("excludes a not-confirmed pass (no active registration on either platform) from every bucket", () => {
    const result = aggregateWalletPasses([pass({ apple_active_registrations: 0, google_active_registrations: 0 })], BOTH_ENABLED);
    expect(result.registrationCountBuckets).toEqual({ "1": 0, "2": 0, "3": 0, "4_plus": 0 });
  });

  it("only counts the enabled platform's own registrations, same gating as confirmed/appleOnly above", () => {
    // apple=2, google=1 raw, but Google disabled - bucket must reflect 2 (apple only), not 3.
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 2, google_active_registrations: 1 })],
      { apple: true, google: false },
    );
    expect(result.registrationCountBuckets).toEqual({ "1": 0, "2": 1, "3": 0, "4_plus": 0 });
  });
});

describe("aggregateWalletPasses — lifecycleCounts", () => {
  it("splits a mixed batch into active/removed/never_installed, summing to the pass count", () => {
    const result = aggregateWalletPasses(
      [
        pass({ apple_active_registrations: 1 }), // active
        pass({ apple_inactive_registrations: 1 }), // removed
        pass({}), // never_installed
        // The one correctness risk: active on apple, but has a since-removed device's leftover
        // inactive registration on google - still active overall, not removed.
        pass({ apple_active_registrations: 1, google_inactive_registrations: 1 }),
      ],
      BOTH_ENABLED,
    );
    expect(result.lifecycleCounts).toEqual({ active: 2, removed: 1, never_installed: 1 });
  });

  it("zeroes a disabled platform's inactive registrations too, not just its active ones - a pass whose only history is on the disabled platform reads as never_installed, not removed", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 0, google_active_registrations: 0, google_inactive_registrations: 1 })],
      { apple: true, google: false },
    );
    expect(result.lifecycleCounts).toEqual({ active: 0, removed: 0, never_installed: 1 });
  });

  it("still counts a disabled platform's inactive registration as removed once it's re-evaluated on the enabled platform alone", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 0, apple_inactive_registrations: 1, google_active_registrations: 0, google_inactive_registrations: 1 })],
      { apple: true, google: false },
    );
    expect(result.lifecycleCounts).toEqual({ active: 0, removed: 1, never_installed: 0 });
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
