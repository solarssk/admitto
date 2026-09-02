import { describe, expect, it } from "vitest";
import type { TicketTypeInfo } from "@admitto/tickets";
import type { EnabledWalletPlatforms } from "@admitto/shared";
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

const BOTH_ENABLED: EnabledWalletPlatforms = { apple: true, google: true, samsung: false, any: true };
const ALL_ENABLED: EnabledWalletPlatforms = { apple: true, google: true, samsung: true, any: true };
const APPLE_ONLY_ENABLED: EnabledWalletPlatforms = { apple: true, google: false, samsung: false, any: true };
const SAMSUNG_ONLY_ENABLED: EnabledWalletPlatforms = { apple: false, google: false, samsung: true, any: false };
const NEITHER_ENABLED: EnabledWalletPlatforms = { apple: false, google: false, samsung: false, any: false };

function pass(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    issued_at: new Date("2026-01-01T00:00:00.000Z"),
    first_confirmed_at: null,
    status: "active",
    apple_active_registrations: 0,
    google_active_registrations: 0,
    samsung_active_registrations: 0,
    apple_inactive_registrations: 0,
    google_inactive_registrations: 0,
    samsung_inactive_registrations: 0,
    registration_checked_at: null,
    attendee: { ticket_type: "General", email_deliveries: [] },
    ...overrides,
  };
}

describe("classifyPassPlatform", () => {
  it("classifies an apple-only registration", () => {
    expect(classifyPassPlatform(1, 0, 0)).toBe("apple_only");
  });

  it("classifies a google-only registration", () => {
    expect(classifyPassPlatform(0, 1, 0)).toBe("google_only");
  });

  it("classifies a samsung-only registration", () => {
    expect(classifyPassPlatform(0, 0, 1)).toBe("samsung_only");
  });

  it("classifies a pass active on both apple and google as both, not apple_only", () => {
    expect(classifyPassPlatform(1, 1, 0)).toBe("both");
  });

  it("classifies a pass with no active registration on any platform as none", () => {
    expect(classifyPassPlatform(0, 0, 0)).toBe("none");
  });

  it("treats any positive count as active, not just 1", () => {
    expect(classifyPassPlatform(3, 0, 0)).toBe("apple_only");
    expect(classifyPassPlatform(0, 5, 0)).toBe("google_only");
    expect(classifyPassPlatform(0, 0, 2)).toBe("samsung_only");
  });

  // Samsung is checked last and only wins when neither Apple nor Google is active - "both" stays
  // Apple+Google specifically rather than growing into a full 3-way combinatorial set for a state
  // that can't happen yet (see this function's own doc comment).
  it("ignores an active samsung registration when apple is also active - reads as apple_only, not a new combined state", () => {
    expect(classifyPassPlatform(1, 0, 1)).toBe("apple_only");
  });

  it("ignores an active samsung registration when both apple and google are active - still reads as both", () => {
    expect(classifyPassPlatform(1, 1, 1)).toBe("both");
  });
});

describe("classifyPassLifecycle", () => {
  it("classifies an apple-active pass as active", () => {
    expect(classifyPassLifecycle(1, 0, 0, 0, 0, 0, false)).toBe("active");
  });

  it("classifies a google-active pass as active", () => {
    expect(classifyPassLifecycle(0, 1, 0, 0, 0, 0, false)).toBe("active");
  });

  it("classifies a samsung-active pass as active", () => {
    expect(classifyPassLifecycle(0, 0, 1, 0, 0, 0, false)).toBe("active");
  });

  it("classifies a pass with an inactive registration on apple and nothing active as removed", () => {
    expect(classifyPassLifecycle(0, 0, 0, 1, 0, 0, false)).toBe("removed");
  });

  it("classifies a pass with an inactive registration on google and nothing active as removed", () => {
    expect(classifyPassLifecycle(0, 0, 0, 0, 1, 0, false)).toBe("removed");
  });

  it("classifies a pass with an inactive registration on samsung and nothing active as removed", () => {
    expect(classifyPassLifecycle(0, 0, 0, 0, 0, 1, false)).toBe("removed");
  });

  it("classifies a pass with inactive registrations on all three platforms and nothing active as removed", () => {
    expect(classifyPassLifecycle(0, 0, 0, 1, 1, 1, false)).toBe("removed");
  });

  it("classifies a pass with no registration of any kind and no installation history as never_installed", () => {
    expect(classifyPassLifecycle(0, 0, 0, 0, 0, 0, false)).toBe("never_installed");
  });

  // The one correctness risk this function exists to get right: an attendee can have an active
  // registration on one device and an unrelated inactive registration left over from a different,
  // since-removed device - that pass is still genuinely in use, not "removed".
  it("classifies a pass active on apple with an inactive registration on the SAME platform (a second, removed device) as active, not removed", () => {
    expect(classifyPassLifecycle(1, 0, 0, 1, 0, 0, false)).toBe("active");
  });

  it("classifies a pass active on apple with an inactive registration on another platform (google) as active, not removed", () => {
    expect(classifyPassLifecycle(1, 0, 0, 0, 1, 0, false)).toBe("active");
  });

  it("classifies a pass active on google with an inactive registration on apple as active, not removed", () => {
    expect(classifyPassLifecycle(0, 1, 0, 1, 0, 0, false)).toBe("active");
  });

  it("classifies a pass active on samsung with an inactive registration on apple as active, not removed", () => {
    expect(classifyPassLifecycle(0, 0, 1, 1, 0, 0, false)).toBe("active");
  });

  it("classifies a pass active on all three platforms with inactive registrations on all three as active, not removed", () => {
    expect(classifyPassLifecycle(1, 1, 1, 1, 1, 1, false)).toBe("active");
  });

  // `everInstalled` is the caller-computed "was this pass ever on a device, on any platform,
  // ever" - unlike the gated active/inactive counts above, the caller derives it from raw,
  // ungated data (a disabled platform's own real history, or a first_confirmed_at surviving a
  // no-match registration sync) so a real installation history can't be forgotten just because
  // the event's current settings, or a stale sync, no longer show it (CodeRabbit review).
  it("classifies a pass with zero registrations everywhere but everInstalled true as removed, not never_installed", () => {
    expect(classifyPassLifecycle(0, 0, 0, 0, 0, 0, true)).toBe("removed");
  });

  it("still classifies an active pass as active even when everInstalled is true too", () => {
    expect(classifyPassLifecycle(1, 0, 0, 0, 0, 0, true)).toBe("active");
  });
});

describe("confirmedPlatformLabel", () => {
  it("mirrors classifyPassPlatform's cases with their display labels", () => {
    expect(confirmedPlatformLabel(1, 0, 0)).toBe("Apple");
    expect(confirmedPlatformLabel(0, 1, 0)).toBe("Google");
    expect(confirmedPlatformLabel(0, 0, 1)).toBe("Samsung");
    expect(confirmedPlatformLabel(1, 1, 0)).toBe("Both");
    expect(confirmedPlatformLabel(0, 0, 0)).toBe("None");
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
    expect(result.samsungOnly).toBe(0);
    expect(result.confirmed).toBe(1);
  });

  it("reclassifies a both-active pass as apple_only when Google is disabled, not as both or google_only", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 1, google_active_registrations: 1 })],
      APPLE_ONLY_ENABLED,
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
      APPLE_ONLY_ENABLED,
    );
    expect(result.confirmed).toBe(0);
    expect(result.googleOnly).toBe(0);
    expect(result.appleOnly).toBe(0);
  });

  it("counts nothing as confirmed when no platform is enabled, regardless of raw registrations", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 1, google_active_registrations: 1, samsung_active_registrations: 1 })],
      NEITHER_ENABLED,
    );
    expect(result.confirmed).toBe(0);
    expect(result.appleOnly).toBe(0);
    expect(result.googleOnly).toBe(0);
    expect(result.samsungOnly).toBe(0);
    expect(result.both).toBe(0);
  });

  // Regression: a pass registered only on Samsung must still count as confirmed once Samsung is
  // enabled - the underlying bug this whole follow-up exists to fix (the Reports pipeline was
  // never wired to the samsung_active_registrations column at all).
  it("counts a Samsung-only pass as confirmed and samsungOnly when Samsung is enabled", () => {
    const result = aggregateWalletPasses(
      [pass({ samsung_active_registrations: 1 })],
      SAMSUNG_ONLY_ENABLED,
    );
    expect(result.samsungOnly).toBe(1);
    expect(result.confirmed).toBe(1);
    expect(result.appleOnly).toBe(0);
    expect(result.googleOnly).toBe(0);
    expect(result.both).toBe(0);
  });

  it("counts a Samsung-only registration as not confirmed at all when Samsung is the disabled platform", () => {
    const result = aggregateWalletPasses([pass({ samsung_active_registrations: 1 })], APPLE_ONLY_ENABLED);
    expect(result.confirmed).toBe(0);
    expect(result.samsungOnly).toBe(0);
  });

  it("ignores a samsung registration alongside an apple one - counts as apple_only, not samsungOnly, matching classifyPassPlatform", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 1, samsung_active_registrations: 1 })],
      ALL_ENABLED,
    );
    expect(result.appleOnly).toBe(1);
    expect(result.samsungOnly).toBe(0);
    expect(result.confirmed).toBe(1);
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

  it("excludes a not-confirmed pass (no active registration on any platform) from every bucket", () => {
    const result = aggregateWalletPasses([pass({ apple_active_registrations: 0, google_active_registrations: 0 })], BOTH_ENABLED);
    expect(result.registrationCountBuckets).toEqual({ "1": 0, "2": 0, "3": 0, "4_plus": 0 });
  });

  it("only counts the enabled platform's own registrations, same gating as confirmed/appleOnly above", () => {
    // apple=2, google=1 raw, but Google disabled - bucket must reflect 2 (apple only), not 3.
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 2, google_active_registrations: 1 })],
      APPLE_ONLY_ENABLED,
    );
    expect(result.registrationCountBuckets).toEqual({ "1": 0, "2": 1, "3": 0, "4_plus": 0 });
  });

  it("includes samsung's own active registrations in the sum when Samsung is enabled", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 1, samsung_active_registrations: 2 })], // 3
      ALL_ENABLED,
    );
    expect(result.registrationCountBuckets).toEqual({ "1": 0, "2": 0, "3": 1, "4_plus": 0 });
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

  it("still counts a disabled platform's own inactive registration as removed, not never_installed - unlike `active`, this history isn't re-evaluated against current platform toggles", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 0, google_active_registrations: 0, google_inactive_registrations: 1 })],
      APPLE_ONLY_ENABLED,
    );
    expect(result.lifecycleCounts).toEqual({ active: 0, removed: 1, never_installed: 0 });
  });

  it("still counts a pass live only on a since-disabled platform as removed (the closest honest bucket once it's excluded from active), not never_installed", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 0, google_active_registrations: 1 })],
      APPLE_ONLY_ENABLED,
    );
    expect(result.lifecycleCounts).toEqual({ active: 0, removed: 1, never_installed: 0 });
  });

  it("still counts a disabled platform's inactive registration as removed once it's re-evaluated on the enabled platform alone", () => {
    const result = aggregateWalletPasses(
      [pass({ apple_active_registrations: 0, apple_inactive_registrations: 1, google_active_registrations: 0, google_inactive_registrations: 1 })],
      APPLE_ONLY_ENABLED,
    );
    expect(result.lifecycleCounts).toEqual({ active: 0, removed: 1, never_installed: 0 });
  });

  it("counts a pass as removed, not never_installed, when a no-match registration sync nulled every count but first_confirmed_at is still set", () => {
    const result = aggregateWalletPasses(
      [
        pass({
          first_confirmed_at: new Date("2026-01-01T00:00:00.000Z"),
          apple_active_registrations: null,
          google_active_registrations: null,
          samsung_active_registrations: null,
          apple_inactive_registrations: null,
          google_inactive_registrations: null,
          samsung_inactive_registrations: null,
        }),
      ],
      BOTH_ENABLED,
    );
    expect(result.lifecycleCounts).toEqual({ active: 0, removed: 1, never_installed: 0 });
  });

  it("counts a samsung-active pass as active, and a samsung-inactive-only pass as removed", () => {
    const result = aggregateWalletPasses(
      [pass({ samsung_active_registrations: 1 }), pass({ samsung_inactive_registrations: 1 })],
      ALL_ENABLED,
    );
    expect(result.lifecycleCounts).toEqual({ active: 1, removed: 1, never_installed: 0 });
  });

  it("still counts a disabled Samsung platform's own inactive registration as removed, not never_installed", () => {
    const result = aggregateWalletPasses([pass({ samsung_inactive_registrations: 1 })], APPLE_ONLY_ENABLED);
    expect(result.lifecycleCounts).toEqual({ active: 0, removed: 1, never_installed: 0 });
  });
});

describe("buildWalletExportCsvRow — enabledPlatforms gating", () => {
  const catalog: never[] = [];
  const operatorMap = {};

  function exportRow(walletOverrides: Partial<Record<string, unknown>>, enabledPlatforms: EnabledWalletPlatforms) {
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
        samsung_active_registrations: 0,
        samsung_inactive_registrations: 0,
        registration_checked_at: new Date("2026-01-02T00:00:00.000Z"),
        ...walletOverrides,
      },
    };
    const csv = buildWalletExportCsvRow(row as never, catalog, "UTC", operatorMap, enabledPlatforms);
    return csv.split(",").map((c) => c.replace(/^"|"$/g, ""));
  }

  // Columns: Name, Email, Ticket type, Wallet pass status, Pass issued at, Apple active,
  // Apple inactive, Google active, Google inactive, Samsung active, Samsung inactive,
  // Confirmed platform, ...
  it("blanks the Google columns and excludes Google from Confirmed platform when Google is disabled", () => {
    const row = exportRow({}, APPLE_ONLY_ENABLED);
    expect(row[5]).toBe("1"); // Apple active
    expect(row[7]).toBe(""); // Google active - blanked, not "1"
    expect(row[8]).toBe(""); // Google inactive - blanked
    expect(row[11]).toBe("Apple"); // Confirmed platform - Google's registration doesn't count
  });

  it("keeps every enabled platform's raw columns and the Both label when apple and google are both enabled", () => {
    const row = exportRow({}, BOTH_ENABLED);
    expect(row[5]).toBe("1");
    expect(row[7]).toBe("1");
    expect(row[11]).toBe("Both");
  });

  it("still blanks a disabled platform's columns even for a never-synced pass (both reasons for blank stay independent)", () => {
    const row = exportRow({ registration_checked_at: null }, APPLE_ONLY_ENABLED);
    expect(row[5]).toBe(""); // Apple active - blank because unsynced, not because disabled
    expect(row[11]).toBe(""); // Confirmed platform - blank, unsynced
  });

  it("exposes Samsung's own active/inactive columns and Confirmed platform when Samsung is enabled", () => {
    const row = exportRow(
      { apple_active_registrations: 0, google_active_registrations: 0, samsung_active_registrations: 1, samsung_inactive_registrations: 2 },
      ALL_ENABLED,
    );
    expect(row[9]).toBe("1"); // Samsung active
    expect(row[10]).toBe("2"); // Samsung inactive
    expect(row[11]).toBe("Samsung");
  });

  it("blanks the Samsung columns and excludes Samsung from Confirmed platform when Samsung is disabled", () => {
    const row = exportRow(
      { apple_active_registrations: 0, google_active_registrations: 0, samsung_active_registrations: 1 },
      BOTH_ENABLED,
    );
    expect(row[9]).toBe(""); // Samsung active - blanked, not "1"
    expect(row[10]).toBe(""); // Samsung inactive - blanked
    expect(row[11]).toBe("None"); // Samsung's registration doesn't count with it disabled
  });
});
